//! Kokoro's model as DirectML runs it (#530). DirectML refuses a grouped (depthwise)
//! `ConvTranspose`, which Kokoro upsamples with three times: every run on the GPU fails there
//! with E_INVALIDARG, whatever the GPU, and whatever build of the model (fp32, fp16, int8). Each
//! is rewritten here as what it computes, in operators DirectML runs: the input stretched by
//! zeros between its samples, then a depthwise `Conv` with the kernel reversed. The output is the
//! same (`live_directml_patch_changes_nothing_heard`).
//!
//! The model is an ONNX protobuf; only what this needs of the wire format is read and written,
//! and every other byte is copied as it was.

/// A field of a protobuf message: its number, and its value (a varint, or the bytes of a
/// length-delimited one); `raw` is the whole field as it was written.
struct Field<'a> {
    number: u64,
    value: Value<'a>,
    raw: &'a [u8],
}

enum Value<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Fixed,
}

fn varint(buf: &[u8], at: &mut usize) -> Result<u64, String> {
    let mut v = 0u64;
    for shift in (0..64).step_by(7) {
        let b = *buf.get(*at).ok_or("the model ends inside a varint")?;
        *at += 1;
        v |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Ok(v);
        }
    }
    Err("a varint longer than 64 bits".into())
}

fn fields(buf: &[u8]) -> Result<Vec<Field<'_>>, String> {
    let mut out = vec![];
    let mut at = 0;
    while at < buf.len() {
        let start = at;
        let key = varint(buf, &mut at)?;
        let value = match key & 7 {
            0 => Value::Varint(varint(buf, &mut at)?),
            1 => {
                at += 8;
                Value::Fixed
            }
            2 => {
                let len = varint(buf, &mut at)? as usize;
                let end = at.checked_add(len).filter(|&e| e <= buf.len()).ok_or("a field longer than the model")?;
                let bytes = &buf[at..end];
                at = end;
                Value::Bytes(bytes)
            }
            5 => {
                at += 4;
                Value::Fixed
            }
            w => return Err(format!("wire type {w}, which ONNX does not use")),
        };
        if at > buf.len() {
            return Err("the model ends inside a field".into());
        }
        out.push(Field { number: key >> 3, value, raw: &buf[start..at] });
    }
    Ok(out)
}

fn put_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn put_bytes(out: &mut Vec<u8>, number: u64, bytes: &[u8]) {
    put_varint(out, number << 3 | 2);
    put_varint(out, bytes.len() as u64);
    out.extend_from_slice(bytes);
}

fn put_int(out: &mut Vec<u8>, number: u64, v: i64) {
    put_varint(out, number << 3);
    put_varint(out, v as u64);
}

// ONNX's field numbers (onnx.proto).
const MODEL_GRAPH: u64 = 7;
const GRAPH_NODE: u64 = 1;
const GRAPH_INITIALIZER: u64 = 5;
const NODE_INPUT: u64 = 1;
const NODE_OUTPUT: u64 = 2;
const NODE_NAME: u64 = 3;
const NODE_OP_TYPE: u64 = 4;
const NODE_ATTRIBUTE: u64 = 5;
const ATTR_NAME: u64 = 1;
const ATTR_I: u64 = 3;
const ATTR_INTS: u64 = 8;
const ATTR_TYPE: u64 = 20;
const ATTR_INT: i64 = 2;
const ATTR_INTS_TYPE: i64 = 7;
const TENSOR_DIMS: u64 = 1;
const TENSOR_DATA_TYPE: u64 = 2;
const TENSOR_NAME: u64 = 8;
const TENSOR_RAW_DATA: u64 = 9;
const INT64: i64 = 7;

/// A node, as far as it is read here.
#[derive(Debug, Default, PartialEq)]
pub struct Node {
    pub name: String,
    pub op_type: String,
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
    /// Integer attributes, each as its list (a single `i` is a list of one).
    pub ints: Vec<(String, Vec<i64>)>,
    /// Some attribute that is not an integer or a list of them.
    pub other_attributes: bool,
}

impl Node {
    fn attr(&self, name: &str) -> Option<&[i64]> {
        self.ints.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_slice())
    }
}

fn text(b: &[u8]) -> Result<String, String> {
    String::from_utf8(b.to_vec()).map_err(|_| "a name that is not UTF-8".to_string())
}

pub fn read_node(buf: &[u8]) -> Result<Node, String> {
    let mut n = Node::default();
    for f in fields(buf)? {
        match (f.number, f.value) {
            (NODE_INPUT, Value::Bytes(b)) => n.inputs.push(text(b)?),
            (NODE_OUTPUT, Value::Bytes(b)) => n.outputs.push(text(b)?),
            (NODE_NAME, Value::Bytes(b)) => n.name = text(b)?,
            (NODE_OP_TYPE, Value::Bytes(b)) => n.op_type = text(b)?,
            (NODE_ATTRIBUTE, Value::Bytes(b)) => {
                let (mut name, mut ints, mut other) = (String::new(), vec![], false);
                for a in fields(b)? {
                    match (a.number, a.value) {
                        (ATTR_NAME, Value::Bytes(b)) => name = text(b)?,
                        (ATTR_I, Value::Varint(v)) | (ATTR_INTS, Value::Varint(v)) => ints.push(v as i64),
                        // Packed.
                        (ATTR_INTS, Value::Bytes(b)) => {
                            let mut at = 0;
                            while at < b.len() {
                                ints.push(varint(b, &mut at)? as i64);
                            }
                        }
                        (ATTR_TYPE, Value::Varint(t)) => other = t as i64 != ATTR_INT && t as i64 != ATTR_INTS_TYPE,
                        _ => {}
                    }
                }
                if other {
                    n.other_attributes = true;
                } else {
                    n.ints.push((name, ints));
                }
            }
            _ => {}
        }
    }
    Ok(n)
}

pub fn write_node(n: &Node) -> Vec<u8> {
    let mut out = vec![];
    for i in &n.inputs {
        put_bytes(&mut out, NODE_INPUT, i.as_bytes());
    }
    for o in &n.outputs {
        put_bytes(&mut out, NODE_OUTPUT, o.as_bytes());
    }
    put_bytes(&mut out, NODE_NAME, n.name.as_bytes());
    put_bytes(&mut out, NODE_OP_TYPE, n.op_type.as_bytes());
    for (name, v) in &n.ints {
        let mut a = vec![];
        put_bytes(&mut a, ATTR_NAME, name.as_bytes());
        // `axis` and `group` are single integers; the rest are lists.
        if matches!(name.as_str(), "axis" | "group") {
            put_int(&mut a, ATTR_I, v[0]);
            put_int(&mut a, ATTR_TYPE, ATTR_INT);
        } else {
            for &x in v {
                put_int(&mut a, ATTR_INTS, x);
            }
            put_int(&mut a, ATTR_TYPE, ATTR_INTS_TYPE);
        }
        put_bytes(&mut out, NODE_ATTRIBUTE, &a);
    }
    out
}

fn int64_tensor(name: &str, values: &[i64]) -> Vec<u8> {
    let mut t = vec![];
    put_int(&mut t, TENSOR_DIMS, values.len() as i64);
    put_int(&mut t, TENSOR_DATA_TYPE, INT64);
    put_bytes(&mut t, TENSOR_NAME, name.as_bytes());
    let raw: Vec<u8> = values.iter().flat_map(|v| v.to_le_bytes()).collect();
    put_bytes(&mut t, TENSOR_RAW_DATA, &raw);
    t
}

/// What `ConvTranspose` computes, in nodes DirectML runs, when it is a 1-D depthwise one: none
/// when it is anything else.
pub fn rewrite(n: &Node) -> Option<(Vec<Node>, Vec<(String, Vec<i64>)>)> {
    if n.op_type != "ConvTranspose" || n.other_attributes || n.inputs.len() < 2 {
        return None;
    }
    let one = |name: &str, default: i64| -> Option<i64> {
        match n.attr(name) {
            None => Some(default),
            Some([v]) => Some(*v),
            Some(_) => None,
        }
    };
    let group = one("group", 1)?;
    let [k] = *n.attr("kernel_shape")? else { return None };
    let s = one("strides", 1)?;
    let dilation = one("dilations", 1)?;
    let output_padding = one("output_padding", 0)?;
    let &[begin, end] = n.attr("pads").unwrap_or(&[0, 0]) else { return None };
    if group <= 1 || dilation != 1 || n.attr("output_shape").is_some() || s < 1 {
        return None;
    }
    // y[o] = Σ x[i]·w[j] over o = i·s + j - begin. With u = x and s - 1 zeros after each sample
    // (length T·s), that is Σ u[m]·w[j] over m = o + begin - j: a correlation with w reversed,
    // padded k - 1 - begin before, and after k - 1 - end + output_padding less the s - 1 zeros u
    // already ends with.
    let left = k - 1 - begin;
    let right = k - 1 - end + output_padding - (s - 1);
    if left < 0 || right < 0 {
        return None;
    }
    let p = &n.name;
    let c = |what: &str| format!("jarvis_directml/{what}/k{k}s{s}");
    let consts = vec![
        (c("axis"), vec![3]),
        (c("zeros"), vec![0, 0, 0, 0, 0, 0, 0, s - 1]),
        (c("shape"), vec![0, 0, -1]),
        (c("reversed"), (0..k).rev().collect()),
    ];
    let node = |op: &str, inputs: Vec<String>, output: String, ints: Vec<(&str, Vec<i64>)>| Node {
        name: format!("{p}/{op}"),
        op_type: op.to_string(),
        inputs,
        outputs: vec![output],
        ints: ints.into_iter().map(|(n, v)| (n.to_string(), v)).collect(),
        other_attributes: false,
    };
    let mut conv_inputs = vec![format!("{p}/stretched"), format!("{p}/reversed")];
    conv_inputs.extend(n.inputs.get(2).cloned());
    let conv = node(
        "Conv",
        conv_inputs,
        n.outputs.first()?.clone(),
        vec![("group", vec![group]), ("kernel_shape", vec![k]), ("pads", vec![left, right]), ("strides", vec![1]), ("dilations", vec![1])],
    );
    let nodes = vec![
        node("Unsqueeze", vec![n.inputs[0].clone(), c("axis")], format!("{p}/columns"), vec![]),
        node("Pad", vec![format!("{p}/columns"), c("zeros")], format!("{p}/padded"), vec![]),
        node("Reshape", vec![format!("{p}/padded"), c("shape")], format!("{p}/stretched"), vec![]),
        node("Gather", vec![n.inputs[1].clone(), c("reversed")], format!("{p}/reversed"), vec![("axis", vec![2])]),
        conv,
    ];
    Some((nodes, consts))
}

/// `model` with each grouped `ConvTranspose` rewritten (`rewrite`), and how many were.
pub fn for_directml(model: &[u8]) -> Result<(Vec<u8>, usize), String> {
    let mut out = Vec::with_capacity(model.len() + 4096);
    let mut rewritten = 0;
    for f in fields(model)? {
        let (MODEL_GRAPH, Value::Bytes(graph)) = (f.number, &f.value) else {
            out.extend_from_slice(f.raw);
            continue;
        };
        let mut g = Vec::with_capacity(graph.len() + 4096);
        let mut consts: Vec<(String, Vec<i64>)> = vec![];
        for gf in fields(graph)? {
            if let (GRAPH_NODE, Value::Bytes(node)) = (gf.number, &gf.value) {
                if let Some((nodes, cs)) = rewrite(&read_node(node)?) {
                    for n in nodes {
                        put_bytes(&mut g, GRAPH_NODE, &write_node(&n));
                    }
                    for c in cs {
                        if !consts.iter().any(|(n, _)| *n == c.0) {
                            consts.push(c);
                        }
                    }
                    rewritten += 1;
                    continue;
                }
            }
            g.extend_from_slice(gf.raw);
        }
        for (name, values) in &consts {
            put_bytes(&mut g, GRAPH_INITIALIZER, &int64_tensor(name, values));
        }
        put_bytes(&mut out, MODEL_GRAPH, &g);
    }
    Ok((out, rewritten))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conv_transpose(name: &str, group: i64) -> Node {
        Node {
            name: name.into(),
            op_type: "ConvTranspose".into(),
            inputs: vec!["x".into(), "w".into(), "b".into()],
            outputs: vec!["y".into()],
            ints: vec![
                ("dilations".into(), vec![1]),
                ("group".into(), vec![group]),
                ("kernel_shape".into(), vec![3]),
                ("output_padding".into(), vec![1]),
                ("pads".into(), vec![1, 1]),
                ("strides".into(), vec![2]),
            ],
            other_attributes: false,
        }
    }

    /// A model of one graph: a node before, the `ConvTranspose`, a node after, and an
    /// initializer, with an opset field around it, as Kokoro's is laid out.
    fn model(group: i64) -> Vec<u8> {
        let relu = Node { name: "r".into(), op_type: "Relu".into(), inputs: vec!["in".into()], outputs: vec!["x".into()], ..Default::default() };
        let tanh = Node { name: "t".into(), op_type: "Tanh".into(), inputs: vec!["y".into()], outputs: vec!["out".into()], ..Default::default() };
        let mut g = vec![];
        for n in [relu, conv_transpose("/pool/ConvTranspose", group), tanh] {
            put_bytes(&mut g, GRAPH_NODE, &write_node(&n));
        }
        put_bytes(&mut g, GRAPH_INITIALIZER, &int64_tensor("w_shape", &[512, 1, 3]));
        let mut m = vec![];
        put_int(&mut m, 1, 8); // ir_version
        put_bytes(&mut m, MODEL_GRAPH, &g);
        put_bytes(&mut m, 8, b"\x08\x14"); // opset_import, version 20
        m
    }

    fn graph_of(m: &[u8]) -> (Vec<Node>, usize) {
        let fs = fields(m).unwrap();
        let Value::Bytes(g) = fs.iter().find(|f| f.number == MODEL_GRAPH).unwrap().value else { panic!() };
        let gf = fields(g).unwrap();
        let nodes = gf.iter().filter(|f| f.number == GRAPH_NODE).map(|f| match f.value {
            Value::Bytes(b) => read_node(b).unwrap(),
            _ => panic!(),
        });
        (nodes.collect(), gf.iter().filter(|f| f.number == GRAPH_INITIALIZER).count())
    }

    #[test]
    fn a_depthwise_conv_transpose_becomes_a_stretch_and_a_reversed_conv() {
        let (patched, n) = for_directml(&model(512)).unwrap();
        assert_eq!(n, 1);
        let (nodes, initializers) = graph_of(&patched);
        let ops: Vec<&str> = nodes.iter().map(|n| n.op_type.as_str()).collect();
        assert_eq!(ops, ["Relu", "Unsqueeze", "Pad", "Reshape", "Gather", "Conv", "Tanh"]);
        assert_eq!(initializers, 1 + 4);
        let conv = &nodes[5];
        assert_eq!(conv.inputs, ["/pool/ConvTranspose/stretched", "/pool/ConvTranspose/reversed", "b"]);
        assert_eq!(conv.outputs, ["y"], "what follows reads the same output");
        assert_eq!(conv.attr("group"), Some(&[512][..]));
        // k 3, stride 2, pads 1 and 1, output padding 1: one before, one after.
        assert_eq!(conv.attr("pads"), Some(&[1, 1][..]));
        assert_eq!(nodes[4].attr("axis"), Some(&[2][..]));
        assert_eq!(nodes[1].inputs[0], "x");
        // The rest of the model is as it was.
        let fs = fields(&patched).unwrap();
        assert_eq!(fs.first().unwrap().raw, &[0x08, 8]);
        assert_eq!(fs.last().unwrap().raw, &[0x42, 2, 0x08, 0x14]);
    }

    #[test]
    fn a_conv_transpose_that_is_not_depthwise_is_left_as_it_is() {
        let m = model(1);
        let (patched, n) = for_directml(&m).unwrap();
        assert_eq!(n, 0);
        assert_eq!(patched, m);
    }

    #[test]
    fn the_rewrite_computes_what_conv_transpose_does() {
        // Both, by hand, over one channel: x of 4, k 3, stride 2, pads 1 and 1, output padding 1.
        let (x, w, bias) = ([1.0f32, -2.0, 3.0, 0.5], [0.25f32, 1.5, -1.0], 0.1f32);
        let (k, s, begin, out_len) = (3usize, 2usize, 1usize, 8usize);
        let mut want = vec![bias; out_len];
        for (i, xi) in x.iter().enumerate() {
            for (j, wj) in w.iter().enumerate() {
                let o = (i * s + j) as isize - begin as isize;
                if (0..out_len as isize).contains(&o) {
                    want[o as usize] += xi * wj;
                }
            }
        }
        let (nodes, _) = rewrite(&conv_transpose("c", 4)).unwrap();
        let [left, right] = nodes[4].attr("pads").unwrap() else { panic!() };
        let mut stretched = vec![0.0f32; *left as usize];
        for xi in x {
            stretched.push(xi);
            stretched.extend(vec![0.0; s - 1]);
        }
        stretched.extend(vec![0.0; *right as usize]);
        let reversed: Vec<f32> = w.iter().rev().copied().collect();
        let got: Vec<f32> = (0..stretched.len() + 1 - k).map(|o| bias + (0..k).map(|j| stretched[o + j] * reversed[j]).sum::<f32>()).collect();
        assert_eq!(got, want);
    }
}

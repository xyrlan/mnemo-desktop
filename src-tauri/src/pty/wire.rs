//! What the app and its terminal daemon (`src/bin/mnemo-desktop-ptyd.rs`) say to each other
//! over `ptyd.sock`, and the words both sides of `host.rs` use.
//!
//! A frame is a big-endian `u32` length of the rest, a big-endian `u32` length of the header,
//! the header (JSON) and a payload of raw bytes: what a terminal printed, what is typed into it,
//! a screen to draw again. The frame, `Hello` and `Shutdown` never change: they are how an app
//! meets a daemon of another version and replaces it.
//!
//! Shared by the app and the daemon binary, which includes this file by path: it names nothing
//! outside `std` and its crates.

use serde::{Deserialize, Serialize};
use std::io::{self, Read};

/// Bumped whenever a request or a reply changes; an app replaces a daemon that says otherwise.
pub const VERSION: u32 = 1;

/// No frame is larger: a snapshot of a full scrollback is a few MB.
pub const MAX_FRAME: usize = 64 << 20;

/// A terminal, the same number in the app, the daemon and the front's pane.
pub type PaneId = u32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Output(Vec<u8>),
    Exit(Option<i32>),
}

/// A terminal the host keeps: its folder (the one it last reported, else the one it started
/// in), the pid of the program it runs, and whether that program is still running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PtyInfo {
    pub id: PaneId,
    pub cwd: String,
    pub pid: u32,
    pub alive: bool,
}

/// What to run, as the app built it: the whole environment travels, so a shell the daemon
/// starts is the shell the app would have started.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Spec {
    pub argv: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<String>,
    pub rows: u16,
    pub cols: u16,
}

/// App → daemon. `Write` carries its bytes as the payload and gets no reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// Reply: `{"version", "pid"}`.
    Hello { version: u32 },
    /// Starts `spec` and sends what it prints to this connection. Reply: `{"id"}`, before any
    /// of its output.
    Spawn { spec: Spec },
    /// Sends what `id` prints to this connection from now on, and to no other. Reply: its
    /// snapshot as the payload, before any of its output.
    Attach { id: PaneId },
    Write { id: PaneId },
    Resize { id: PaneId, cols: u16, rows: u16 },
    Kill { id: PaneId },
    /// Reply: `[PtyInfo]`.
    List,
    /// Kills every terminal and ends the daemon.
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Request {
    pub req: u64,
    #[serde(flatten)]
    pub op: Op,
}

/// Daemon → app.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "ev", rename_all = "snake_case")]
pub enum Message {
    /// `err` set: the request failed; else `ok` is its answer (`null` when it has none).
    Reply {
        req: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ok: Option<serde_json::Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        err: Option<String>,
    },
    /// The payload is what `id` printed.
    Output { id: PaneId },
    Exit { id: PaneId, code: Option<i32> },
}

impl Message {
    // The daemon's (server.rs); the app only reads replies.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn reply(req: u64, result: Result<serde_json::Value, String>) -> Self {
        match result {
            Ok(v) => Message::Reply { req, ok: Some(v), err: None },
            Err(e) => Message::Reply { req, ok: None, err: Some(e) },
        }
    }
}

/// One frame, ready to write in one call (so frames from two threads never interleave).
pub fn frame(header: &impl Serialize, payload: &[u8]) -> io::Result<Vec<u8>> {
    let head = serde_json::to_vec(header)?;
    let rest = 4 + head.len() + payload.len();
    if rest > MAX_FRAME {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("frame of {rest} bytes")));
    }
    let mut out = Vec::with_capacity(4 + rest);
    out.extend_from_slice(&(rest as u32).to_be_bytes());
    out.extend_from_slice(&(head.len() as u32).to_be_bytes());
    out.extend_from_slice(&head);
    out.extend_from_slice(payload);
    Ok(out)
}

/// The next frame's header and payload; `None` when the other side closed between frames.
pub fn read_frame(r: &mut impl Read) -> io::Result<Option<(Vec<u8>, Vec<u8>)>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
        Ok(()) => {}
    }
    let rest = u32::from_be_bytes(len) as usize;
    let bad = |what: String| io::Error::new(io::ErrorKind::InvalidData, what);
    if !(4..=MAX_FRAME).contains(&rest) {
        return Err(bad(format!("frame of {rest} bytes")));
    }
    let mut body = vec![0u8; rest];
    r.read_exact(&mut body)?;
    let head = u32::from_be_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if head > rest - 4 {
        return Err(bad(format!("header of {head} bytes in a frame of {rest}")));
    }
    let payload = body.split_off(4 + head);
    body.drain(..4);
    Ok(Some((body, payload)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_round_trips_with_a_binary_payload() {
        let req = Request { req: 7, op: Op::Write { id: 3 } };
        let payload = [0u8, 159, 146, 150, b'\n'];
        let mut buf = frame(&req, &payload).unwrap();
        buf.extend(frame(&Request { req: 8, op: Op::List }, &[]).unwrap());
        let mut r = &buf[..];
        let (head, body) = read_frame(&mut r).unwrap().unwrap();
        assert_eq!(serde_json::from_slice::<Request>(&head).unwrap(), req);
        assert_eq!(body, payload);
        let (head, body) = read_frame(&mut r).unwrap().unwrap();
        assert_eq!(serde_json::from_slice::<Request>(&head).unwrap(), Request { req: 8, op: Op::List });
        assert!(body.is_empty());
        assert!(read_frame(&mut r).unwrap().is_none(), "a clean end between frames");
    }

    #[test]
    fn hello_and_shutdown_keep_their_shape() {
        // An app of any version must be able to greet and replace a daemon of any other.
        let hello = serde_json::to_value(Request { req: 1, op: Op::Hello { version: 9 } }).unwrap();
        assert_eq!(hello, serde_json::json!({ "req": 1, "op": "hello", "version": 9 }));
        let bye = serde_json::to_value(Request { req: 2, op: Op::Shutdown }).unwrap();
        assert_eq!(bye, serde_json::json!({ "req": 2, "op": "shutdown" }));
        let reply = serde_json::to_value(Message::reply(1, Ok(serde_json::json!({ "version": 9 })))).unwrap();
        assert_eq!(reply, serde_json::json!({ "ev": "reply", "req": 1, "ok": { "version": 9 } }));
        let failed = serde_json::to_value(Message::reply(3, Err("no".into()))).unwrap();
        assert_eq!(failed, serde_json::json!({ "ev": "reply", "req": 3, "err": "no" }));
    }

    #[test]
    fn a_truncated_or_lying_frame_is_an_error_not_a_hang() {
        let mut buf = frame(&Request { req: 1, op: Op::List }, b"xyz").unwrap();
        buf.truncate(buf.len() - 1);
        assert!(read_frame(&mut &buf[..]).is_err());

        let mut lying = 10u32.to_be_bytes().to_vec();
        lying.extend_from_slice(&50u32.to_be_bytes());
        lying.extend_from_slice(&[0; 6]);
        assert!(read_frame(&mut &lying[..]).is_err());
        assert!(read_frame(&mut &u32::MAX.to_be_bytes()[..]).is_err());
    }
}

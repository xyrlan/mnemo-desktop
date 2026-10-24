//! James's voice (#530): Kokoro-82M, its ONNX build, with a PT-BR voice (`pm_alex` unless the
//! config's `voice.kokoro` names another), run by ONNX Runtime inside the app. On Windows it runs
//! on the GPU through DirectML, whatever its vendor, where there is one (its upsampling rewritten
//! for DirectML, `onnx_fix.rs`), and on the CPU where there is none. Elsewhere there is no runtime
//! pinned yet, and Piper speaks (`speech.rs`).
//!
//! Kokoro reads phonemes, not text: espeak-ng's for `pt-br`, as Kokoro's own pipeline (misaki's
//! `EspeakG2P`) makes them, from the espeak-ng in Piper's bundle, loaded into the app.
//!
//! Everything is fetched on first use, pinned and checked against its sha256 (`files.rs`): the
//! model and the voice from a pinned revision of `onnx-community/Kokoro-82M-v1.0-ONNX`, and on
//! Windows ONNX Runtime's DLL and DirectML's, each fetched alone out of its NuGet package.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use super::files::{self, Pinned};
use super::speech::Synth;

/// What Kokoro speaks at.
pub const RATE: u32 = 24_000;

macro_rules! hf {
    ($path:literal) => {
        concat!("https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/", $path)
    };
}

/// The model, full precision, on the GPU and the CPU alike. The half-precision build is half the
/// download, but whisper misheard twice the words of it (36.6% against 16.9%, `live_bench`); the
/// 8-bit ones do not run on DirectML.
pub const MODEL: Pinned = Pinned {
    file: "kokoro-v1.0.onnx",
    url: hf!("onnx/model.onnx"),
    bytes: 325_532_232,
    sha256: "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb",
};

/// The voice when the config names none.
pub const DEFAULT_VOICE: &str = "pm_alex";

/// Kokoro's PT-BR voices: 510 styles of 256 floats, one for each length of phonemes.
pub const VOICES: [Pinned; 3] = [
    Pinned { file: "pm_alex.bin", url: hf!("voices/pm_alex.bin"), bytes: 522_240, sha256: "0175c753f59c54e7fd5a995bedef0c5ff2fb67e0043dd3dcb2ae74ec2acbeb2a" },
    Pinned { file: "pm_santa.bin", url: hf!("voices/pm_santa.bin"), bytes: 522_240, sha256: "8b012db3185778afe2e45a62cbad69db73021774fe68dda634bcc748a982eede" },
    Pinned { file: "pf_dora.bin", url: hf!("voices/pf_dora.bin"), bytes: 522_240, sha256: "3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee" },
];

/// The voice named `name` (`pm_alex`, or `pm_alex.bin`), of Kokoro's PT-BR ones.
pub fn voice(name: &str) -> Result<&'static Pinned, String> {
    let name = name.trim().trim_end_matches(".bin");
    VOICES.iter().find(|v| v.file.trim_end_matches(".bin") == name).ok_or_else(|| {
        let names: Vec<&str> = VOICES.iter().map(|v| v.file.trim_end_matches(".bin")).collect();
        format!("voice.kokoro in jarvis.json is {name:?}, not one of Kokoro's PT-BR voices: {}", names.join(", "))
    })
}

/// ONNX Runtime 1.24.4 built with DirectML (the last one that is), x64, out of its NuGet package.
#[cfg(windows)]
const ONNXRUNTIME: files::Entry = files::Entry {
    file: "onnxruntime.dll",
    url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/1.24.4/microsoft.ml.onnxruntime.directml.1.24.4.nupkg",
    data_at: 6_342_542,
    packed: 6_039_111,
    bytes: 17_328_152,
    sha256: "e7eedec6a6f26dc39dc948276a75ef6d2bee3fff944d874ceed0bbd3b97bff40",
};

/// The DirectML that runtime is built against (1.15.4), x64: Windows has its own DirectML, but of
/// whatever version its build shipped.
#[cfg(windows)]
const DIRECTML: files::Entry = files::Entry {
    file: "DirectML.dll",
    url: "https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg",
    data_at: 142_873_434,
    packed: 9_332_741,
    bytes: 18_527_776,
    sha256: "9c9e6d822561c6c41b90e6994b3e8857cf1d66dbfb1e0c4c799c7c89b4e92da1",
};

/// `~/.mnemo-desktop/models/jarvis/kokoro/`.
pub fn kokoro_dir() -> PathBuf {
    super::speech::jarvis_dir().join("kokoro")
}

// ---------------------------------------------------------------------------------------
// Where it runs

/// What Kokoro runs on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Device {
    /// DirectML, on this adapter.
    Gpu(String),
    Cpu,
}

impl std::fmt::Display for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Device::Gpu(name) => write!(f, "the GPU ({name})"),
            Device::Cpu => f.write_str("the CPU"),
        }
    }
}

/// The GPU DirectML would run on, the one with the most memory of its own; none when the only
/// adapter is Windows's software one, as in a virtual machine with no GPU.
#[cfg(windows)]
pub fn gpu() -> Option<String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    // SAFETY: a DXGI factory, and plain reads of its adapters' descriptions.
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let mut best: Option<(usize, String)> = None;
        for i in 0.. {
            let Ok(adapter) = factory.EnumAdapters1(i) else { break };
            let Ok(desc) = adapter.GetDesc1() else { continue };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            let end = desc.Description.iter().position(|&c| c == 0).unwrap_or(desc.Description.len());
            let name = String::from_utf16_lossy(&desc.Description[..end]);
            if best.as_ref().is_none_or(|(memory, _)| desc.DedicatedVideoMemory > *memory) {
                best = Some((desc.DedicatedVideoMemory, name));
            }
        }
        best.map(|(_, name)| name)
    }
}

#[cfg(not(windows))]
pub fn gpu() -> Option<String> {
    None
}

// ---------------------------------------------------------------------------------------
// Files

/// What Kokoro needs, on disk and checked.
pub struct KokoroFiles {
    pub model: PathBuf,
    pub voice: PathBuf,
    pub runtime: PathBuf,
    /// DirectML's DLL, when there is a GPU to run on.
    pub directml: Option<PathBuf>,
    /// espeak-ng's library, and the directory that holds its `espeak-ng-data`.
    pub espeak: PathBuf,
    pub espeak_data: PathBuf,
    pub device: Device,
}

/// Fetches what is missing for the voice named `voice` on `device`.
#[cfg(windows)]
pub fn ensure_files(voice_name: &str, device: Device) -> Result<KokoroFiles, String> {
    let voice = voice(voice_name)?;
    let dir = kokoro_dir();
    let runtime_dir = dir.join("onnxruntime-1.24.4-directml");
    let runtime = files::ensure_entry(&runtime_dir, &ONNXRUNTIME)?;
    let directml = match device {
        Device::Gpu(_) => Some(files::ensure_entry(&runtime_dir, &DIRECTML)?),
        Device::Cpu => None,
    };
    let model = files::ensure(&dir, &MODEL, |_, _| {})?;
    let voice = files::ensure(&dir, voice, |_, _| {})?;
    // espeak-ng comes with Piper, which Jarvis has fetched since #506.
    let piper = super::speech::piper_exe(&super::speech::jarvis_dir())?;
    let home = piper.parent().ok_or("Piper's folder")?.to_path_buf();
    Ok(KokoroFiles { model, voice, runtime, directml, espeak: home.join("espeak-ng.dll"), espeak_data: home, device })
}

#[cfg(not(windows))]
pub fn ensure_files(voice_name: &str, _device: Device) -> Result<KokoroFiles, String> {
    voice(voice_name)?;
    let _ = (&MODEL, kokoro_dir);
    Err("Kokoro has no runtime pinned on this OS yet".into())
}

// ---------------------------------------------------------------------------------------
// Phonemes

type Initialize = unsafe extern "C" fn(c_int, c_int, *const c_char, c_int) -> c_int;
type SetVoiceByName = unsafe extern "C" fn(*const c_char) -> c_int;
type TextToPhonemes = unsafe extern "C" fn(*mut *const c_void, c_int, c_int) -> *const c_char;

/// espeak-ng, loaded and set to `pt-br`. Its state is global: one call at a time.
struct Espeak {
    _lib: libloading::Library,
    to_phonemes: TextToPhonemes,
}

// SAFETY: espeak-ng is only reached under `ESPEAK`'s lock.
unsafe impl Send for Espeak {}

static ESPEAK: Mutex<Option<Espeak>> = Mutex::new(None);

/// `AUDIO_OUTPUT_SYNCHRONOUS`, and `espeakINITIALIZE_DONT_EXIT`: a missing file is an error, not
/// the end of the app.
const OUTPUT_SYNCHRONOUS: c_int = 2;
const DONT_EXIT: c_int = 0x8000;
const CHARS_UTF8: c_int = 1;
/// IPA, with `^` tying the parts of one phoneme ("t^ʃ"), as misaki asks for.
const PHONEMES_IPA_TIED: c_int = 0x02 | 0x80 | ((b'^' as c_int) << 8);

fn load_espeak(lib: &Path, data: &Path) -> Result<(), String> {
    let mut slot = crate::voice::lock(&ESPEAK);
    if slot.is_some() {
        return Ok(());
    }
    let say = |e: &dyn std::fmt::Display| format!("espeak-ng ({}): {e}", lib.display());
    // SAFETY: espeak-ng's own library, its functions as `speak_lib.h` declares them.
    unsafe {
        let library = libloading::Library::new(lib).map_err(|e| say(&e))?;
        let initialize: Initialize = *library.get::<Initialize>(b"espeak_Initialize").map_err(|e| say(&e))?;
        let set_voice: SetVoiceByName = *library.get::<SetVoiceByName>(b"espeak_SetVoiceByName").map_err(|e| say(&e))?;
        let to_phonemes: TextToPhonemes = *library.get::<TextToPhonemes>(b"espeak_TextToPhonemes").map_err(|e| say(&e))?;
        let path = CString::new(data.to_str().ok_or_else(|| say(&"its folder's path is not UTF-8"))?).map_err(|e| say(&e))?;
        if initialize(OUTPUT_SYNCHRONOUS, 0, path.as_ptr(), DONT_EXIT) < 0 {
            return Err(say(&format!("it found no espeak-ng-data in {}", data.display())));
        }
        if set_voice(c"pt-br".as_ptr()) != 0 {
            return Err(say(&"it has no pt-br voice"));
        }
        *slot = Some(Espeak { _lib: library, to_phonemes });
    }
    Ok(())
}

/// espeak-ng's phonemes for `text`, clause after clause; nothing before `load_espeak`.
fn espeak(text: &str) -> String {
    let slot = crate::voice::lock(&ESPEAK);
    let Some(e) = slot.as_ref() else { return String::new() };
    let Ok(text) = CString::new(text) else { return String::new() };
    let mut at: *const c_void = text.as_ptr().cast();
    let mut out = vec![];
    // SAFETY: `at` walks `text`, which lives through the loop; espeak-ng sets it to null at its end.
    unsafe {
        while !at.is_null() {
            let ps = (e.to_phonemes)(&mut at, CHARS_UTF8, PHONEMES_IPA_TIED);
            if ps.is_null() {
                break;
            }
            out.push(CStr::from_ptr(ps).to_string_lossy().into_owned());
        }
    }
    out.join(" ")
}

/// The punctuation phonemizer keeps in place (its default marks), which espeak-ng drops. The
/// opening ones go with the word after them.
const MARKS: &str = ";:,.!?¡¿—…\"«»“”";
const OPENING: &str = "¡¿«“";

/// `text` as Kokoro's phonemes, `g2p` giving espeak-ng's for a stretch with no punctuation: what
/// misaki's `EspeakG2P` does for `pt-br`, with phonemizer's `preserve_punctuation`, `with_stress`,
/// `tie='^'` and `language_switch='remove-flags'`.
pub fn phonemes_with(text: &str, g2p: impl Fn(&str) -> String) -> String {
    // Parentheses would be read as espeak-ng's language flags: angles, then back.
    let text = text.replace('«', "“").replace('»', "”").replace('(', "«").replace(')', "»");
    let mut out = String::new();
    let mut words = String::new();
    let flush = |words: &mut String, out: &mut String| {
        if words.trim().is_empty() {
            words.clear();
            return;
        }
        let ps = without_flags(&g2p(words.trim()));
        let ps = ps.split_whitespace().collect::<Vec<_>>().join(" ");
        if !ps.is_empty() {
            if !out.is_empty() && !out.ends_with(|c: char| c == ' ' || OPENING.contains(c)) {
                out.push(' ');
            }
            out.push_str(&ps);
        }
        words.clear();
    };
    for c in text.chars() {
        if MARKS.contains(c) {
            flush(&mut words, &mut out);
            if OPENING.contains(c) && !out.is_empty() && !out.ends_with(' ') {
                out.push(' ');
            }
            out.push(c);
        } else {
            words.push(c);
        }
    }
    flush(&mut words, &mut out);
    let mut ps = out.trim().to_string();
    for (old, new) in E2M {
        ps = ps.replace(old, new);
    }
    ps.replace(['^', '-'], "").replace('«', "(").replace('»', ")")
}

/// espeak-ng's multi-letter phonemes as the one letter Kokoro learned each as (misaki's `e2m`).
const E2M: [(&str, &str); 11] = [
    ("a^ɪ", "I"),
    ("a^ʊ", "W"),
    ("d^z", "ʣ"),
    ("d^ʒ", "ʤ"),
    ("e^ɪ", "A"),
    ("o^ʊ", "O"),
    ("s^s", "S"),
    ("t^s", "ʦ"),
    ("t^ʃ", "ʧ"),
    ("ə^ʊ", "Q"),
    ("ɔ^ɪ", "Y"),
];

/// Without the "(en)" espeak-ng puts around a word it reads in another language.
fn without_flags(ps: &str) -> String {
    let mut out = String::with_capacity(ps.len());
    let mut depth = 0usize;
    for c in ps.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Kokoro's tokens (its `tokenizer.json`), each phoneme to its id; what is not there is dropped.
const VOCAB: &[(char, i64)] = &[
    (';', 1), (':', 2), (',', 3), ('.', 4), ('!', 5), ('?', 6), ('—', 9), ('…', 10), ('"', 11), ('(', 12),
    (')', 13), ('“', 14), ('”', 15), (' ', 16), ('\u{303}', 17), ('ʣ', 18), ('ʥ', 19), ('ʦ', 20), ('ʨ', 21),
    ('ᵝ', 22), ('ꭧ', 23), ('A', 24), ('I', 25), ('O', 31), ('Q', 33), ('S', 35), ('T', 36), ('W', 39),
    ('Y', 41), ('ᵊ', 42), ('a', 43), ('b', 44), ('c', 45), ('d', 46), ('e', 47), ('f', 48), ('h', 50),
    ('i', 51), ('j', 52), ('k', 53), ('l', 54), ('m', 55), ('n', 56), ('o', 57), ('p', 58), ('q', 59),
    ('r', 60), ('s', 61), ('t', 62), ('u', 63), ('v', 64), ('w', 65), ('x', 66), ('y', 67), ('z', 68),
    ('ɑ', 69), ('ɐ', 70), ('ɒ', 71), ('æ', 72), ('β', 75), ('ɔ', 76), ('ɕ', 77), ('ç', 78), ('ɖ', 80),
    ('ð', 81), ('ʤ', 82), ('ə', 83), ('ɚ', 85), ('ɛ', 86), ('ɜ', 87), ('ɟ', 90), ('ɡ', 92), ('ɥ', 99),
    ('ɨ', 101), ('ɪ', 102), ('ʝ', 103), ('ɯ', 110), ('ɰ', 111), ('ŋ', 112), ('ɳ', 113), ('ɲ', 114),
    ('ɴ', 115), ('ø', 116), ('ɸ', 118), ('θ', 119), ('œ', 120), ('ɹ', 123), ('ɾ', 125), ('ɻ', 126),
    ('ʁ', 128), ('ɽ', 129), ('ʂ', 130), ('ʃ', 131), ('ʈ', 132), ('ʧ', 133), ('ʊ', 135), ('ʋ', 136),
    ('ʌ', 138), ('ɣ', 139), ('ɤ', 140), ('χ', 142), ('ʎ', 143), ('ʒ', 147), ('ʔ', 148), ('ˈ', 156),
    ('ˌ', 157), ('ː', 158), ('ʰ', 162), ('ʲ', 164), ('↓', 169), ('→', 171), ('↗', 172), ('↘', 173),
    ('ᵻ', 177),
];

pub fn tokens(phonemes: &str) -> Vec<i64> {
    phonemes.chars().filter_map(|c| VOCAB.iter().find(|(v, _)| *v == c).map(|(_, id)| *id)).collect()
}

/// The most tokens Kokoro takes at once, its padding left out.
pub const MAX_TOKENS: usize = 510;

// ---------------------------------------------------------------------------------------
// The model

/// One environment per process, on the runtime loaded from `KokoroFiles::runtime`: the first one
/// loaded stays.
static ENVIRONMENT: OnceLock<Result<ort::environment::Environment, String>> = OnceLock::new();
/// DirectML's DLL, loaded by its path before the runtime, which then finds it loaded.
static DIRECTML_LIB: OnceLock<Result<libloading::Library, String>> = OnceLock::new();

fn environment(files: &KokoroFiles) -> Result<&'static ort::environment::Environment, String> {
    if let Some(dml) = &files.directml {
        // SAFETY: DirectML's own DLL; nothing of it is called here.
        let loaded = DIRECTML_LIB.get_or_init(|| unsafe { libloading::Library::new(dml) }.map_err(|e| format!("DirectML ({}): {e}", dml.display())));
        loaded.as_ref().map_err(Clone::clone)?;
    }
    ENVIRONMENT
        .get_or_init(|| {
            ort::init_from(&files.runtime)
                .map_err(|e| format!("ONNX Runtime ({}): {e}", files.runtime.display()))?
                .with_name("jarvis-voice")
                .with_telemetry(false)
                .build()
                .map_err(|e| format!("ONNX Runtime: {e}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// Kokoro, loaded with one voice, on `device`.
pub struct Kokoro {
    session: ort::session::Session,
    /// The voice's styles, 510 × 256.
    styles: Vec<f32>,
    pub device: Device,
    /// The speed: 1 is the voice's own.
    pub speed: f32,
}

const STYLE: usize = 256;

impl Kokoro {
    /// Loads the model on the files' device, and runs it once; one that will not load or run on the
    /// GPU is loaded on the CPU instead, said in the log.
    pub fn load(files: &KokoroFiles) -> Result<Kokoro, String> {
        load_espeak(&files.espeak, &files.espeak_data)?;
        let bytes = std::fs::read(&files.voice).map_err(|e| format!("{}: {e}", files.voice.display()))?;
        let styles: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        if styles.len() != MAX_TOKENS * STYLE {
            return Err(format!("{}: {} floats, not {}", files.voice.display(), styles.len(), MAX_TOKENS * STYLE));
        }
        let env = environment(files)?;
        if let Device::Gpu(name) = &files.device {
            match Self::start(env, &files.model, styles.clone(), files.device.clone()) {
                Ok(k) => return Ok(k),
                Err(e) => log::warn!("jarvis voice: Kokoro did not run on {name}, so it runs on the CPU: {e}"),
            }
        }
        Self::start(env, &files.model, styles, Device::Cpu)
    }

    fn start(env: &ort::environment::Environment, model: &Path, styles: Vec<f32>, device: Device) -> Result<Kokoro, String> {
        let started = Instant::now();
        let session = session(env, model, device != Device::Cpu)?;
        let mut k = Kokoro { session, styles, device, speed: 1.0 };
        // The first run sets up what the next ones use, and shows that it runs at all.
        k.synthesize("ˈoj")?;
        log::info!("jarvis voice: Kokoro ready on {} in {} ms", k.device, started.elapsed().as_millis());
        Ok(k)
    }

    /// The audio of `phonemes` (at most `MAX_TOKENS` of them), at `RATE`.
    pub fn synthesize(&mut self, phonemes: &str) -> Result<Vec<f32>, String> {
        let ids = tokens(phonemes);
        if ids.is_empty() {
            return Ok(vec![]);
        }
        if ids.len() > MAX_TOKENS {
            return Err(format!("{} phonemes, where Kokoro takes {MAX_TOKENS}", ids.len()));
        }
        // The style for this many phonemes (Kokoro's pipeline: `pack[len(ps) - 1]`).
        let row = (phonemes.chars().count().max(1) - 1).min(MAX_TOKENS - 1);
        let style = self.styles[row * STYLE..(row + 1) * STYLE].to_vec();
        let mut input = Vec::with_capacity(ids.len() + 2);
        input.push(0);
        input.extend(ids);
        input.push(0);
        let n = input.len() as i64;
        let fail = |e: ort::Error| format!("Kokoro: {e}");
        let input_ids = ort::value::Tensor::from_array(([1i64, n], input)).map_err(fail)?;
        let style = ort::value::Tensor::from_array(([1i64, STYLE as i64], style)).map_err(fail)?;
        let speed = ort::value::Tensor::from_array(([1i64], vec![self.speed])).map_err(fail)?;
        let outputs = self.session.run(ort::inputs!["input_ids" => input_ids, "style" => style, "speed" => speed]).map_err(fail)?;
        let (_, audio) = outputs[0].try_extract_tensor::<f32>().map_err(fail)?;
        Ok(audio.to_vec())
    }

    /// `text`'s phonemes, as Kokoro reads them.
    pub fn phonemes(text: &str) -> String {
        phonemes_with(text, espeak)
    }

    /// Says `text` a piece at a time (`pieces`), each handed over as soon as it is synthesized.
    pub fn say(&mut self, text: &str, sink: &mut dyn FnMut(&[f32]) -> bool) -> Result<(), String> {
        for piece in pieces(text) {
            for ps in fit(&Self::phonemes(&piece)) {
                let audio = self.synthesize(&ps)?;
                if !sink(&audio) {
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    /// The synth the speaker runs, saying the text as `pronounce::heard` spells it, with the app
    /// at full speed meanwhile: it runs in the app, which is often minimized when James speaks,
    /// and Windows would run it on the efficiency cores (`full_speed`).
    pub fn into_synth(mut self) -> Synth {
        Box::new(move |text, sink| {
            super::app_full_speed(true);
            let said = self.say(&super::pronounce::heard(text), sink);
            super::app_full_speed(false);
            said
        })
    }
}

fn session(env: &ort::environment::Environment, model: &Path, gpu: bool) -> Result<ort::session::Session, String> {
    let mut builder = ort::session::Session::builder(env).map_err(|e| e.to_string())?;
    if !gpu {
        return builder.commit_from_file(model).map_err(|e| format!("{}: {e}", model.display()));
    }
    on_directml(builder, model)
}

#[cfg(windows)]
fn on_directml(builder: ort::session::builder::SessionBuilder, model: &Path) -> Result<ort::session::Session, String> {
    use ort::ep::directml::{DeviceFilter, DirectML, PerformancePreference};
    let fail = |e: ort::Error<ort::session::builder::SessionBuilder>| e.to_string();
    let bytes = std::fs::read(model).map_err(|e| format!("{}: {e}", model.display()))?;
    let (patched, rewritten) = super::onnx_fix::for_directml(&bytes).map_err(|e| format!("{}: {e}", model.display()))?;
    drop(bytes);
    log::debug!("jarvis voice: {rewritten} grouped ConvTranspose rewritten for DirectML");
    // DirectML runs one node at a time, and plans its own memory.
    builder
        .with_memory_pattern(false)
        .map_err(fail)?
        .with_parallel_execution(false)
        .map_err(fail)?
        .with_execution_providers([DirectML::default()
            .with_device_filter(DeviceFilter::Gpu)
            .with_performance_preference(PerformancePreference::HighPerformance)
            .build()
            .error_on_failure()])
        .map_err(fail)?
        .commit_from_memory(&patched)
        .map_err(|e| format!("{} on DirectML: {e}", model.display()))
}

#[cfg(not(windows))]
fn on_directml(_builder: ort::session::builder::SessionBuilder, _model: &Path) -> Result<ort::session::Session, String> {
    Err("DirectML is Windows's".into())
}

/// `text` as the pieces it is synthesized in, each handed to the speaker as it is done: sentence by
/// sentence, a long one a clause at a time, as Piper had them (`speech::lines`). The first sound
/// waits only for the first piece, and the rest is synthesized while it plays: on DirectML each
/// new length of input costs its operators set up again, most of a piece's time (`live_bench`),
/// so the pieces stay short.
pub fn pieces(text: &str) -> Vec<String> {
    let mut pieces = super::speech::lines(text);
    // The first piece is what the first sound waits on: cut at its first comma, a pause the voice
    // makes anyway, when what comes on each side of it is not too short to say alone.
    if let Some(first) = pieces.first().cloned() {
        if let Some((head, tail)) = first_clause(&first) {
            pieces.splice(0..1, [head, tail]);
        }
    }
    pieces
}

/// What the first piece is cut into: none when it has no comma with `HEAD` characters before it
/// and as many after.
const HEAD: usize = 12;

fn first_clause(piece: &str) -> Option<(String, String)> {
    let mut seen = 0;
    for (i, c) in piece.char_indices() {
        seen += 1;
        if matches!(c, ',' | ';' | ':') && seen >= HEAD {
            let (head, tail) = (piece[..i + c.len_utf8()].trim(), piece[i + c.len_utf8()..].trim());
            return (tail.chars().count() >= HEAD).then(|| (head.to_string(), tail.to_string()));
        }
    }
    None
}

/// Phonemes cut at a space, so that each part fits in what Kokoro takes at once.
pub fn fit(ps: &str) -> Vec<String> {
    if tokens(ps).len() <= MAX_TOKENS {
        return if ps.trim().is_empty() { vec![] } else { vec![ps.to_string()] };
    }
    let words: Vec<&str> = ps.split(' ').collect();
    if words.len() < 2 {
        // One "word" too long for Kokoro: cut anywhere.
        let chars: Vec<char> = ps.chars().collect();
        return chars.chunks(MAX_TOKENS).map(|c| c.iter().collect()).collect();
    }
    let (a, b) = words.split_at(words.len() / 2);
    let mut out = fit(&a.join(" "));
    out.extend(fit(&b.join(" ")));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What espeak-ng gives for each stretch, as it gave it (`live_pronunciation`), so the
    /// punctuation and the mapping are tested off Windows too.
    fn g2p(text: &str) -> String {
        match text {
            "Olá" => "olˈa",
            "tudo bem" => "tˈudʊ bˈe^ɪŋ",
            "O PR passou" => "ʊ pˌeˈɛxe pasˈow",
            "isso" => "ˈisʊ",
            "chat" => "ʃˈat^ʃ",
            "ok" => "(en)ˈo^ʊke^ɪ(pt)",
            other => panic!("not in the fixture: {other:?}"),
        }
        .to_string()
    }

    #[test]
    fn phonemes_keep_their_punctuation_and_kokoro_s_letters() {
        assert_eq!(phonemes_with("Olá, tudo bem?", g2p), "olˈa, tˈudʊ bˈAŋ?");
        assert_eq!(phonemes_with("O PR passou. Olá!", g2p), "ʊ pˌeˈɛxe pasˈow. olˈa!");
        // Ties made one letter, a language flag dropped, parentheses kept as such.
        assert_eq!(phonemes_with("chat (ok)", g2p), "ʃˈaʧ (ˈOkA)");
        assert_eq!(phonemes_with("“isso”…", g2p), "“ˈisʊ”…");
        assert_eq!(phonemes_with("  ", g2p), "");
    }

    #[test]
    fn phonemes_become_kokoro_s_tokens() {
        // ʊ 135, space 16, p 58, ˌ 157, e 47, ˈ 156, ɛ 86, x 66; the unknown "_" is dropped.
        assert_eq!(tokens("ʊ pˌeˈɛxe_"), [135, 16, 58, 157, 47, 156, 86, 66, 47]);
        assert_eq!(tokens("bˈAŋ?"), [44, 156, 24, 112, 6]);
        assert_eq!(VOCAB.len(), 114);
    }

    #[test]
    fn phonemes_too_many_for_kokoro_are_cut_at_a_space() {
        let word = "abcdefghij";
        let ps = vec![word; 100].join(" ");
        let parts = fit(&ps);
        assert!(parts.len() >= 2);
        assert!(parts.iter().all(|p| tokens(p).len() <= MAX_TOKENS), "{:?}", parts.iter().map(|p| p.len()).collect::<Vec<_>>());
        assert_eq!(parts.join(" "), ps);
        assert_eq!(fit("olˈa"), ["olˈa"]);
        assert!(fit(" ").is_empty());
    }

    #[test]
    fn the_first_piece_is_cut_at_its_first_comma_and_the_rest_as_piper_had_it() {
        assert_eq!(pieces("Tem três issues abertas, a mais antiga é de ontem. Quer ver?"), ["Tem três issues abertas,", "a mais antiga é de ontem.", "Quer ver?"]);
        // Too short on one side to say alone: whole.
        assert_eq!(pieces("Pronto, terminou."), ["Pronto, terminou."]);
        assert_eq!(pieces("O CI está verde, ok."), ["O CI está verde, ok."]);
        // Only the first: the rest are sentences, a long one in clauses (`speech::lines`).
        assert_eq!(pieces("Oi. O CI está verde, pode fazer o merge."), ["Oi.", "O CI está verde, pode fazer o merge."]);
        assert!(pieces(" ").is_empty());
    }

    #[test]
    fn a_voice_is_one_of_kokoro_s_pt_br_ones() {
        assert_eq!(voice("pm_alex").unwrap().file, "pm_alex.bin");
        assert_eq!(voice("pf_dora.bin").unwrap().file, "pf_dora.bin");
        let err = voice("af_heart").unwrap_err();
        assert!(err.contains("pm_alex") && err.contains("pm_santa"), "{err}");
        assert_eq!(DEFAULT_VOICE, "pm_alex");
    }

    // -----------------------------------------------------------------------------------
    // Live, on Windows, with the real files (fetched into `~/.mnemo-desktop/models/` when
    // missing). Nothing is played: the audio stays in memory.

    /// The phonemes of each word the pronunciation table spells, as written and as spelled:
    /// `cargo test --lib jarvis_voice::kokoro::tests::live_pronunciation -- --ignored --nocapture`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_pronunciation() {
        use crate::jarvis_voice::pronounce;
        let files = ensure_files(DEFAULT_VOICE, Device::Cpu).unwrap();
        load_espeak(&files.espeak, &files.espeak_data).unwrap();
        let said = |t: &str| Kokoro::phonemes(&pronounce::heard(t));
        for w in pronounce::words().chain(["7h38", "às 2h", "Olá, tudo bem? O PR passou."]) {
            eprintln!("{w:>12}  {:<28} {}", Kokoro::phonemes(w), said(w));
        }
        // What the issue heard, and is heard no more.
        assert!(Kokoro::phonemes("CI").contains("tui"), "espeak-ng reads CI as a numeral");
        assert!(!said("CI").contains("tui"));
        assert!(!said("parent").starts_with("paɾ"));
        assert!(said("issues").contains('ʃ'));
        assert!(said("commit").ends_with("mˈit"), "{}", said("commit"));
        assert!(Kokoro::phonemes("7h38").contains("aɡˈa") && !said("7h38").contains("aɡˈa"));
        assert_eq!(said("às 2h"), Kokoro::phonemes("às duas horas"));
    }

    /// The model rewritten for DirectML (`onnx_fix.rs`) says what the model says: both run on the
    /// CPU over the same phonemes, and then the rewritten one on the GPU.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_directml_patch_changes_nothing_heard() {
        let device = gpu().map_or(Device::Cpu, Device::Gpu);
        let files = ensure_files(DEFAULT_VOICE, device.clone()).unwrap();
        let env = environment(&files).unwrap();
        let mut k = Kokoro::load(&KokoroFiles { device: Device::Cpu, ..ensure_files(DEFAULT_VOICE, device.clone()).unwrap() }).unwrap();
        let ps = Kokoro::phonemes("O CI do desktop está verde, e o PR quarenta e dois passou.");
        let plain = k.synthesize(&ps).unwrap();
        let (patched, n) = crate::jarvis_voice::onnx_fix::for_directml(&std::fs::read(&files.model).unwrap()).unwrap();
        assert_eq!(n, 3, "Kokoro upsamples with three grouped ConvTranspose");
        k.session = ort::session::Session::builder(env).unwrap().commit_from_memory(&patched).unwrap();
        let rewritten = k.synthesize(&ps).unwrap();
        assert_eq!(plain.len(), rewritten.len());
        let most = plain.iter().zip(&rewritten).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        eprintln!("{} samples; the most they differ by: {most}", plain.len());
        assert!(most < 1e-4, "{most}");
        if let Device::Gpu(_) = device {
            let mut g = Kokoro::load(&files).unwrap();
            assert_eq!(g.device, device);
            let on_gpu = g.synthesize(&ps).unwrap();
            let rms = |v: &[f32]| (v.iter().map(|x| x * x).sum::<f32>() / v.len() as f32).sqrt();
            eprintln!("on the GPU: {} samples, RMS {} against {}", on_gpu.len(), rms(&on_gpu), rms(&plain));
            assert!((on_gpu.len() as f32 / plain.len() as f32 - 1.0).abs() < 0.05);
        }
    }

    /// What whisper hears of a spelling, Kokoro saying it in a sentence: how the pronunciation
    /// table's spellings were chosen. `MNEMO_KOKORO_SPELLINGS`: `sentence with {}|spelling|…`
    /// lines, `;`-separated.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_spellings() {
        use crate::jarvis_voice::hear;
        let whisper = crate::voice::load_context(&hear::fetch(None).unwrap()).unwrap();
        let prompt = hear::prompt(&[]);
        let mut k = Kokoro::load(&ensure_files(DEFAULT_VOICE, gpu().map_or(Device::Cpu, Device::Gpu)).unwrap()).unwrap();
        let lines = std::env::var("MNEMO_KOKORO_SPELLINGS").unwrap();
        for line in lines.split(';') {
            let mut parts = line.split('|');
            let sentence = parts.next().unwrap();
            for spelling in parts {
                let mut clip = vec![];
                k.say(&sentence.replace("{}", spelling), &mut |p| {
                    clip.extend_from_slice(p);
                    true
                })
                .unwrap();
                let (text, _) = hear::hear(&whisper, &hear::to_whisper(&clip, RATE), &prompt).unwrap();
                eprintln!("{spelling:>14} → {} | {text}", Kokoro::phonemes(spelling));
            }
        }
    }

    /// Sentences in the style of James's replies.
    const BENCH: [&str; 8] = [
        "O PR quarenta e dois passou em todas as verificações.",
        "Abri o VS Code no projeto do desktop.",
        "Tem três issues abertas, a mais antiga é de ontem.",
        "O CI está verde, pode fazer o merge.",
        "Sua próxima reunião é às 7h38, com o time de produto.",
        "Fiz o commit e mandei para revisão.",
        "Não encontrei nenhum parent rodando agora.",
        "Pronto, o build terminou sem erros, e os testes passaram todos.",
    ];

    /// First sound, real-time factor and word error rate (whisper hearing it back) of Kokoro on
    /// the GPU and on the CPU, and of Piper, over `BENCH`, each warmed up first:
    /// `cargo test --release --lib jarvis_voice::kokoro::tests::live_bench -- --ignored --nocapture --test-threads=1`.
    /// `MNEMO_KOKORO_MODELS` (`path;path`) adds other builds of the model, on both;
    /// `MNEMO_KOKORO_AS_WRITTEN=1` leaves the pronunciation table out.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn live_bench() {
        use crate::jarvis_voice::{hear, speech};
        let whisper = crate::voice::load_context(&hear::fetch(None).unwrap()).unwrap();
        let prompt = hear::prompt(&[]);
        let as_written = std::env::var("MNEMO_KOKORO_AS_WRITTEN").is_ok();
        let heard = |t: &str| if as_written { t.to_string() } else { crate::jarvis_voice::pronounce::heard(t) };
        let wer = |clips: &[Vec<f32>], rate: u32| {
            let (mut errors, mut total) = (0, 0);
            for (clip, truth) in clips.iter().zip(BENCH) {
                let (text, _) = hear::hear(&whisper, &hear::to_whisper(clip, rate), &prompt).unwrap();
                let truth = hear::tests::words(truth);
                let e = hear::tests::word_errors(&truth, &hear::tests::words(&text));
                if e > 0 {
                    eprintln!("    heard: {text}");
                }
                errors += e;
                total += truth.len();
            }
            100.0 * errors as f32 / total as f32
        };
        let report = |what: &str, firsts: &mut Vec<f32>, synth: f32, audio: f32, clips: &[Vec<f32>], rate: u32| {
            firsts.sort_by(f32::total_cmp);
            eprintln!(
                "{what}: first sound median {:.3}s max {:.3}s; RTF {:.3}; WER {:.1}%",
                firsts[firsts.len() / 2],
                firsts[firsts.len() - 1],
                synth / audio,
                wer(clips, rate)
            );
        };

        let mut models: Vec<(String, Option<PathBuf>)> = vec![];
        for extra in std::env::var("MNEMO_KOKORO_MODELS").unwrap_or_default().split(';').filter(|m| !m.is_empty()) {
            models.push((extra.to_string(), Some(PathBuf::from(extra))));
        }
        models.push(("pinned".into(), None));
        // As the speaker runs it (`into_synth`).
        crate::jarvis_voice::app_full_speed(true);
        let devices = [gpu().map(Device::Gpu), Some(Device::Cpu)];
        for device in devices.into_iter().flatten() {
            for (name, path) in &models {
                let mut files = ensure_files(DEFAULT_VOICE, device.clone()).unwrap();
                if let Some(p) = path {
                    files.model = p.clone();
                }
                let t = Instant::now();
                let mut k = match Kokoro::load(&files) {
                    Ok(k) => k,
                    Err(e) => {
                        eprintln!("Kokoro {name} on {device}: {e}");
                        continue;
                    }
                };
                eprintln!("Kokoro {name} ({}) on {}: loaded and warmed in {:.2}s", files.model.file_name().unwrap().to_string_lossy(), k.device, t.elapsed().as_secs_f32());
                let (mut firsts, mut synth, mut audio, mut clips) = (vec![], 0f32, 0f32, vec![]);
                for text in BENCH {
                    let t = Instant::now();
                    let mut first = None;
                    let mut clip = vec![];
                    let said = k.say(&heard(text), &mut |piece| {
                        first.get_or_insert(t.elapsed().as_secs_f32());
                        clip.extend_from_slice(piece);
                        true
                    });
                    if let Err(e) = said {
                        eprintln!("  failed on {text:?}: {e}");
                        break;
                    }
                    synth += t.elapsed().as_secs_f32();
                    audio += clip.len() as f32 / RATE as f32;
                    firsts.push(first.unwrap());
                    clips.push(clip);
                }
                if clips.len() == BENCH.len() {
                    report(&format!("Kokoro {name} on {}", k.device), &mut firsts, synth, audio, &clips, RATE);
                }
            }
        }

        let files = speech::ensure_files(None).unwrap();
        let mut piper = speech::Piper::new(&files);
        let _ = piper.say("Oi.", &mut |_| true);
        let (mut firsts, mut synth, mut audio, mut clips) = (vec![], 0f32, 0f32, vec![]);
        for text in BENCH {
            let t = Instant::now();
            let mut first = None;
            let mut clip = vec![];
            piper
                .say(&heard(text), &mut |piece| {
                    first.get_or_insert(t.elapsed().as_secs_f32());
                    clip.extend_from_slice(piece);
                    true
                })
                .unwrap();
            synth += t.elapsed().as_secs_f32();
            audio += clip.len() as f32 / files.rate as f32;
            firsts.push(first.unwrap());
            clips.push(clip);
        }
        report("Piper on the CPU", &mut firsts, synth, audio, &clips, files.rate);
    }
}

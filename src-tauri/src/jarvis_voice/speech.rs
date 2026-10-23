//! Jarvis speaking (#506): Piper, local, with a PT-BR voice. What `jarvis_say` hands over waits
//! in a queue; one thread turns it into audio through Piper, another plays it. While the
//! push-to-talk key is held the player sends silence and holds its place, so nothing is said over
//! the maintainer, and the rest follows once the key is up. `hush` drops the queue and what is
//! still unplayed.
//!
//! Piper loads its voice in about 0.2 s, so a process is started ahead of time and waits on its
//! stdin with the voice loaded: a sentence then starts sounding after its own synthesis only.
//! That process ends by itself when the app does, since its stdin closes.

use std::any::Any;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, I24, U24};

use super::files::{self, Pinned};
use crate::voice::lock;

// ---------------------------------------------------------------------------------------
// Piper's files

/// Piper's last release with binaries (rhasspy/piper is archived; its successor ships Python
/// only). Windows only: elsewhere `piper` comes from the config or the PATH.
const PIPER_RELEASE: &str = "piper-2023.11.14-2";
#[cfg(windows)]
const PIPER_WINDOWS: Pinned = Pinned {
    file: "piper_windows_amd64.zip",
    url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
    bytes: 22_477_236,
    sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
};

/// The PT-BR voice and its config, at a pinned revision of rhasspy/piper-voices.
pub const VOICE: Pinned = Pinned {
    file: "pt_BR-faber-medium.onnx",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx",
    bytes: 63_201_294,
    sha256: "858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7",
};
pub const VOICE_CONFIG: Pinned = Pinned {
    file: "pt_BR-faber-medium.onnx.json",
    url: "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json",
    bytes: 4_855,
    sha256: "7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f",
};

/// `~/.mnemo-desktop/models/jarvis/`, beside the local model's files.
pub fn jarvis_dir() -> PathBuf {
    files::models_dir().join("jarvis")
}

/// What Piper needs, on disk and checked: its program, the voice, and the voice's sample rate.
pub struct PiperFiles {
    pub exe: PathBuf,
    pub model: PathBuf,
    pub rate: u32,
}

/// Fetches what is missing. `piper` is the config's `voice.piper`, which skips the download.
pub fn ensure_files(piper: Option<PathBuf>) -> Result<PiperFiles, String> {
    let dir = jarvis_dir();
    let exe = match piper {
        Some(p) if p.is_file() => p,
        Some(p) => return Err(format!("voice.piper in jarvis.json: {} is not a file", p.display())),
        None => piper_exe(&dir)?,
    };
    let model = files::ensure(&dir, &VOICE, |_, _| {})?;
    let config = files::ensure(&dir, &VOICE_CONFIG, |_, _| {})?;
    let rate = voice_rate(&std::fs::read_to_string(&config).map_err(|e| format!("{}: {e}", config.display()))?)?;
    Ok(PiperFiles { exe, model, rate })
}

/// The voice's sample rate, from its `.onnx.json`.
pub fn voice_rate(config: &str) -> Result<u32, String> {
    let v: serde_json::Value = serde_json::from_str(config).map_err(|e| format!("the voice's config: {e}"))?;
    v.pointer("/audio/sample_rate")
        .and_then(|r| r.as_u64())
        .and_then(|r| u32::try_from(r).ok())
        .filter(|&r| r > 0)
        .ok_or_else(|| "the voice's config has no audio.sample_rate".to_string())
}

/// Piper's release, unpacked once into `<dir>/piper-2023.11.14-2/` by Windows' own `tar`.
#[cfg(windows)]
fn piper_exe(dir: &Path) -> Result<PathBuf, String> {
    let home = dir.join(PIPER_RELEASE);
    let exe = home.join("piper.exe");
    if exe.is_file() {
        return Ok(exe);
    }
    let zip = files::ensure(dir, &PIPER_WINDOWS, |_, _| {})?;
    let unpacking = dir.join(format!("{PIPER_RELEASE}.unpacking"));
    let _ = std::fs::remove_dir_all(&unpacking);
    std::fs::create_dir_all(&unpacking).map_err(|e| format!("{}: {e}", unpacking.display()))?;
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let out = crate::proc::command(system.join("System32").join("tar.exe"))
        .arg("-xf")
        .arg(&zip)
        .arg("-C")
        .arg(&unpacking)
        .output()
        .map_err(|e| format!("unpacking Piper: {e}"))?;
    if !out.status.success() {
        return Err(format!("unpacking Piper: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    // The archive holds one `piper/` folder.
    std::fs::rename(unpacking.join("piper"), &home).map_err(|e| format!("{}: {e}", home.display()))?;
    let _ = std::fs::remove_dir_all(&unpacking);
    let _ = std::fs::remove_file(&zip);
    let _ = std::fs::remove_file(dir.join(format!("{}.sha256", PIPER_WINDOWS.file)));
    if exe.is_file() {
        Ok(exe)
    } else {
        Err(format!("Piper's archive has no piper.exe ({})", home.display()))
    }
}

#[cfg(not(windows))]
fn piper_exe(_dir: &Path) -> Result<PathBuf, String> {
    // A bare name: started from the PATH, and said plainly when it is not there (`Piper::spawn`).
    let _ = PIPER_RELEASE;
    Ok(PathBuf::from("piper"))
}

// ---------------------------------------------------------------------------------------
// Synthesis

/// Turns one text into audio at the voice's rate, handing it over in pieces as it comes; a
/// piece refused (`false`) stops it.
pub type Synth = Box<dyn FnMut(&str, &mut dyn FnMut(&[f32]) -> bool) -> Result<(), String> + Send>;

/// Piper, one process per text, the next one started and loaded while this one speaks.
pub struct Piper {
    exe: PathBuf,
    model: PathBuf,
    standby: Option<Child>,
}

impl Piper {
    pub fn new(files: &PiperFiles) -> Self {
        let mut p = Piper { exe: files.exe.clone(), model: files.model.clone(), standby: None };
        p.standby = p.spawn().map_err(|e| log::warn!("jarvis voice: {e}")).ok();
        p
    }

    fn spawn(&self) -> Result<Child, String> {
        let child = crate::proc::command(&self.exe)
            .args(args(&self.model))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                format!("Piper ({}) did not start: {e}. Jarvis speaks through it: install it, or name it in jarvis.json's voice.piper", self.exe.display())
            })?;
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            super::full_speed(child.as_raw_handle());
        }
        Ok(child)
    }

    /// Speaks `text` through the waiting process (or a new one when it died), then starts the
    /// next one.
    pub fn say(&mut self, text: &str, sink: &mut dyn FnMut(&[f32]) -> bool) -> Result<(), String> {
        let mut child = match self.standby.take() {
            Some(mut c) => match c.try_wait() {
                Ok(None) => c,
                // It died waiting (killed, or its voice would not load): a new one.
                _ => {
                    let _ = c.wait();
                    self.spawn()?
                }
            },
            None => self.spawn()?,
        };
        let spoken = speak_through(&mut child, text, sink);
        self.standby = self.spawn().map_err(|e| log::warn!("jarvis voice: {e}")).ok();
        spoken
    }

    pub fn into_synth(mut self) -> Synth {
        Box::new(move |text, sink| self.say(text, sink))
    }
}

impl Drop for Piper {
    fn drop(&mut self) {
        if let Some(mut c) = self.standby.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// Piper's command line: the voice (its `.onnx.json` beside it) and raw 16-bit mono PCM out.
pub fn args(model: &Path) -> Vec<std::ffi::OsString> {
    vec!["--model".into(), model.as_os_str().to_owned(), "--output-raw".into()]
}

/// One line of text, as Piper reads its input: a line is an utterance.
pub fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A sentence longer than this is handed to Piper a clause at a time.
const LONG_SENTENCE: usize = 60;
/// A clause shorter than this stays with the next one.
const SHORT_CLAUSE: usize = 20;

/// `text` as the lines Piper is given. Piper writes nothing of a line until it has synthesized
/// all of it, so the first sound waits for the first line: a long sentence goes in clauses, cut
/// after a comma, semicolon or colon (measured: a 90-character sentence first sounded 1.4 s after
/// `say`, where a short one sounded after 0.18 s). Sentences stay whole otherwise, as Piper would
/// read them.
pub fn lines(text: &str) -> Vec<String> {
    let text = one_line(text);
    let mut out = vec![];
    let mut sentence = String::new();
    let words: Vec<&str> = text.split(' ').filter(|w| !w.is_empty()).collect();
    for (i, word) in words.iter().enumerate() {
        if !sentence.is_empty() {
            sentence.push(' ');
        }
        sentence.push_str(word);
        if word.ends_with(['.', '!', '?']) || i + 1 == words.len() {
            out.extend(clauses(&std::mem::take(&mut sentence)));
        }
    }
    out
}

fn clauses(sentence: &str) -> Vec<String> {
    if sentence.chars().count() <= LONG_SENTENCE {
        return vec![sentence.to_string()];
    }
    let mut out = vec![];
    let mut clause = String::new();
    for word in sentence.split(' ') {
        if !clause.is_empty() {
            clause.push(' ');
        }
        clause.push_str(word);
        if word.ends_with([',', ';', ':']) && clause.chars().count() >= SHORT_CLAUSE {
            out.push(std::mem::take(&mut clause));
        }
    }
    if !clause.is_empty() {
        match out.last_mut() {
            // A tail too short to stand alone goes back with the clause before it.
            Some(last) if clause.chars().count() < SHORT_CLAUSE => {
                last.push(' ');
                last.push_str(&clause);
            }
            _ => out.push(clause),
        }
    }
    out
}

fn speak_through(child: &mut Child, text: &str, sink: &mut dyn FnMut(&[f32]) -> bool) -> Result<(), String> {
    {
        let mut stdin = child.stdin.take().ok_or("Piper has no stdin")?;
        for line in lines(text) {
            writeln!(stdin, "{line}").map_err(|e| format!("Piper: {e}"))?;
        }
    }
    let mut stdout = child.stdout.take().ok_or("Piper has no stdout")?;
    let mut pcm = Pcm::default();
    let mut buf = vec![0u8; 8192];
    let mut wanted = true;
    loop {
        let n = stdout.read(&mut buf).map_err(|e| format!("Piper: {e}"))?;
        if n == 0 {
            break;
        }
        if !sink(&pcm.feed(&buf[..n])) {
            wanted = false;
            break;
        }
    }
    if !wanted {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| format!("Piper: {e}"))?;
    if wanted && !status.success() {
        return Err(format!("Piper failed ({status})"));
    }
    Ok(())
}

/// Little-endian 16-bit samples read in arbitrary pieces, an odd byte kept for the next one.
#[derive(Default)]
pub struct Pcm {
    odd: Option<u8>,
}

impl Pcm {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<f32> {
        let mut out = Vec::with_capacity(bytes.len() / 2 + 1);
        let mut rest = bytes;
        if let Some(lo) = self.odd.take() {
            match rest.split_first() {
                Some((&hi, tail)) => {
                    out.push(i16::from_le_bytes([lo, hi]) as f32 / 32768.0);
                    rest = tail;
                }
                None => {
                    self.odd = Some(lo);
                    return out;
                }
            }
        }
        let mut pairs = rest.chunks_exact(2);
        out.extend(pairs.by_ref().map(|p| i16::from_le_bytes([p[0], p[1]]) as f32 / 32768.0));
        self.odd = pairs.remainder().first().copied();
        out
    }
}

// ---------------------------------------------------------------------------------------
// The queue and the player

/// Opens an output that plays what `Speaker::pull` gives it, at `rate`, and keeps playing while
/// the returned value lives. Runs on the player's thread: a cpal stream is not `Send`.
pub type Output = Box<dyn FnMut(u32, Arc<Shared>) -> Result<Box<dyn Any>, String> + Send>;

#[derive(Default)]
struct St {
    /// Texts not yet synthesized.
    queue: VecDeque<String>,
    /// Synthesized, not yet played, at the voice's rate.
    audio: VecDeque<f32>,
    /// Where the player is between `audio[0]` and `audio[1]`, when the output's rate is not the
    /// voice's.
    pos: f64,
    synthesizing: bool,
    /// Bumped by `hush`: a synthesis under way for an older one hands over nothing more.
    generation: u64,
    closed: bool,
    /// When `say` found nothing being said, and when the device was first handed a sample of it:
    /// the latency the log reports.
    asked: Option<Instant>,
    sounded: Option<Instant>,
    /// The last of those latencies.
    latency: Option<Duration>,
}

impl St {
    fn speaking(&self) -> bool {
        !self.queue.is_empty() || self.synthesizing || !self.audio.is_empty()
    }
}

pub struct Shared {
    st: Mutex<St>,
    cv: Condvar,
    /// The push-to-talk key is down: nothing is played. Set by the key's owner, read here.
    held: Arc<AtomicBool>,
}

impl Shared {
    /// Fills `out` with the next mono samples, `step` voice samples per output sample (1 when the
    /// output runs at the voice's rate), and silence for what is not there yet. While the key is
    /// held it is all silence, and nothing is taken.
    pub fn pull(&self, out: &mut [f32], step: f64) {
        if self.held.load(Ordering::SeqCst) {
            out.fill(0.0);
            return;
        }
        let mut st = lock(&self.st);
        if st.asked.is_some() && st.sounded.is_none() && !st.audio.is_empty() {
            st.sounded = Some(Instant::now());
        }
        if step == 1.0 {
            for o in out.iter_mut() {
                *o = st.audio.pop_front().unwrap_or(0.0);
            }
            return;
        }
        for o in out.iter_mut() {
            let i = st.pos as usize;
            let a = st.audio.get(i).copied();
            let b = st.audio.get(i + 1).copied();
            *o = match (a, b) {
                (Some(a), Some(b)) => {
                    let f = (st.pos - i as f64) as f32;
                    a + (b - a) * f
                }
                (Some(a), None) => a,
                _ => 0.0,
            };
            if a.is_some() {
                st.pos += step;
            }
            let whole = (st.pos as usize).min(st.audio.len());
            if whole > 0 {
                st.audio.drain(..whole);
                st.pos -= whole as f64;
            }
        }
        if st.audio.is_empty() {
            st.pos = 0.0;
        }
    }
}

/// How long the output stays open after the last sound, so a reply that follows soon does not
/// wait for the device again.
const LINGER: Duration = Duration::from_secs(2);
/// How often the player looks at the queue while it is speaking.
const TICK: Duration = Duration::from_millis(20);

pub struct Speaker {
    shared: Arc<Shared>,
}

impl Speaker {
    /// Starts the synthesis and player threads. Nothing plays while `held` is true. `on_speaking`
    /// hears when there starts and stops being something to say; `on_error`, a text that could
    /// not be said.
    pub fn start(
        rate: u32,
        held: Arc<AtomicBool>,
        mut synth: Synth,
        mut output: Output,
        on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<Self, String> {
        let shared = Arc::new(Shared { st: Mutex::new(St::default()), cv: Condvar::new(), held });

        let s = shared.clone();
        let failed = on_error.clone();
        std::thread::Builder::new()
            .name("jarvis-synth".into())
            .spawn(move || loop {
                let (text, generation) = {
                    let mut st = lock(&s.st);
                    while st.queue.is_empty() && !st.closed {
                        st = s.cv.wait(st).unwrap_or_else(|e| e.into_inner());
                    }
                    if st.closed {
                        return;
                    }
                    let text = st.queue.pop_front().unwrap_or_default();
                    st.synthesizing = true;
                    (text, st.generation)
                };
                let said = synth(&text, &mut |piece| {
                    let mut st = lock(&s.st);
                    if st.generation != generation || st.closed {
                        return false;
                    }
                    st.audio.extend(piece.iter().copied());
                    s.cv.notify_all();
                    true
                });
                lock(&s.st).synthesizing = false;
                s.cv.notify_all();
                if let Err(e) = said {
                    failed(e);
                }
            })
            .map_err(|e| format!("jarvis voice: {e}"))?;

        let s = shared.clone();
        std::thread::Builder::new()
            .name("jarvis-player".into())
            .spawn(move || {
                let mut stream: Option<Box<dyn Any>> = None;
                let mut said = false;
                let mut quiet_since: Option<Instant> = None;
                loop {
                    let (speaking, audible, closed) = {
                        let mut st = lock(&s.st);
                        if let (Some(asked), Some(sounded)) = (st.asked, st.sounded) {
                            let latency = sounded.saturating_duration_since(asked);
                            log::info!("jarvis voice: first sound {} ms after jarvis_say", latency.as_millis());
                            (st.asked, st.sounded, st.latency) = (None, None, Some(latency));
                        }
                        (st.speaking(), !s.held.load(Ordering::SeqCst) && !st.audio.is_empty(), st.closed)
                    };
                    if closed {
                        return;
                    }
                    if speaking != said {
                        said = speaking;
                        on_speaking(speaking);
                    }
                    if audible && stream.is_none() {
                        match output(rate, s.clone()) {
                            Ok(st) => stream = Some(st),
                            Err(e) => {
                                // Nothing can play it: dropped with the rest of the queue, not held
                                // for a device that may never come.
                                let mut st = lock(&s.st);
                                st.queue.clear();
                                st.audio.clear();
                                st.pos = 0.0;
                                st.generation += 1;
                                drop(st);
                                on_error(e);
                                continue;
                            }
                        }
                    }
                    if speaking {
                        quiet_since = None;
                    } else if stream.is_some() {
                        let since = *quiet_since.get_or_insert_with(Instant::now);
                        if since.elapsed() >= LINGER {
                            stream = None;
                            quiet_since = None;
                        }
                    }
                    let st = lock(&s.st);
                    if !st.speaking() && stream.is_none() && !st.closed {
                        // Nothing to say and nothing open: sleep until there is. While there is,
                        // the tick also notices the key coming up.
                        drop(s.cv.wait(st).unwrap_or_else(|e| e.into_inner()));
                    } else {
                        drop(s.cv.wait_timeout(st, TICK).unwrap_or_else(|e| e.into_inner()));
                    }
                }
            })
            .map_err(|e| format!("jarvis voice: {e}"))?;

        Ok(Speaker { shared })
    }

    /// Queues `text` after what is already queued.
    pub fn say(&self, text: &str) {
        let text = one_line(text);
        if text.is_empty() {
            return;
        }
        let mut st = lock(&self.shared.st);
        if !st.speaking() && !self.shared.held.load(Ordering::SeqCst) {
            (st.asked, st.sounded) = (Some(Instant::now()), None);
        }
        st.queue.push_back(text);
        drop(st);
        self.shared.cv.notify_all();
    }

    /// From the last `say` that found nothing being said to its first sample on the device, once:
    /// a second call has nothing until another `say` has sounded.
    pub fn take_latency(&self) -> Option<Duration> {
        lock(&self.shared.st).latency.take()
    }

    /// Stops speaking and drops everything queued.
    pub fn hush(&self) {
        let mut st = lock(&self.shared.st);
        st.queue.clear();
        st.audio.clear();
        st.pos = 0.0;
        st.generation += 1;
        st.asked = None;
        drop(st);
        self.shared.cv.notify_all();
    }

}

impl Drop for Speaker {
    fn drop(&mut self) {
        lock(&self.shared.st).closed = true;
        self.shared.cv.notify_all();
    }
}

// ---------------------------------------------------------------------------------------
// The device

/// The default output device, at the voice's rate when it takes it (Windows converts any rate
/// itself), else at its own rate with `pull` stepping between samples.
pub fn default_output() -> Output {
    Box::new(|rate, shared| {
        let device = cpal::default_host().default_output_device().ok_or("no speaker found")?;
        let name = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| "default output".into());
        let supported = device.default_output_config().map_err(|e| format!("speaker {name}: {e}"))?;
        let format = supported.sample_format();
        let own: cpal::StreamConfig = supported.into();
        let at_voice = cpal::StreamConfig { sample_rate: rate, ..own.clone() };
        let stream = match open(&device, at_voice, format, shared.clone(), 1.0) {
            Ok(s) => s,
            Err(first) => {
                let step = rate as f64 / own.sample_rate as f64;
                open(&device, own, format, shared, step).map_err(|e| format!("speaker {name}: {e} (at {rate} Hz: {first})"))?
            }
        };
        stream.play().map_err(|e| format!("speaker {name}: {e}"))?;
        Ok(Box::new(stream) as Box<dyn Any>)
    })
}

fn open(device: &cpal::Device, config: cpal::StreamConfig, format: SampleFormat, shared: Arc<Shared>, step: f64) -> Result<cpal::Stream, String> {
    match format {
        SampleFormat::I8 => build_output::<i8>(device, config, shared, step),
        SampleFormat::I16 => build_output::<i16>(device, config, shared, step),
        SampleFormat::I24 => build_output::<I24>(device, config, shared, step),
        SampleFormat::I32 => build_output::<i32>(device, config, shared, step),
        SampleFormat::U8 => build_output::<u8>(device, config, shared, step),
        SampleFormat::U16 => build_output::<u16>(device, config, shared, step),
        SampleFormat::U24 => build_output::<U24>(device, config, shared, step),
        SampleFormat::U32 => build_output::<u32>(device, config, shared, step),
        SampleFormat::F32 => build_output::<f32>(device, config, shared, step),
        SampleFormat::F64 => build_output::<f64>(device, config, shared, step),
        other => Err(format!("unsupported sample format {other}")),
    }
}

fn build_output<T>(device: &cpal::Device, config: cpal::StreamConfig, shared: Arc<Shared>, step: f64) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    let channels = (config.channels as usize).max(1);
    let mut mono = Vec::<f32>::new();
    device
        .build_output_stream::<T, _, _>(
            config,
            move |data: &mut [T], _| {
                mono.resize(data.len() / channels, 0.0);
                shared.pull(&mut mono, step);
                for (frame, &s) in data.chunks_exact_mut(channels).zip(&mono) {
                    frame.fill(T::from_sample(s));
                }
            },
            |e| log::warn!("jarvis voice: output stream: {e}"),
            None,
        )
        .map_err(|e| e.to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn piper_is_asked_for_raw_audio_from_the_voice() {
        let a = args(Path::new("v/pt_BR-faber-medium.onnx"));
        assert_eq!(a, ["--model", "v/pt_BR-faber-medium.onnx", "--output-raw"].map(std::ffi::OsString::from));
        assert_eq!(one_line("  Olá.\nO PR 42\r\n passou. "), "Olá. O PR 42 passou.");
    }

    #[test]
    fn a_long_sentence_goes_to_piper_in_clauses_and_a_short_one_whole() {
        assert_eq!(lines("Oi, eu sou o James.  Tudo bem?"), ["Oi, eu sou o James.", "Tudo bem?"]);
        assert_eq!(
            lines("O PR quarenta e dois passou em todas as verificações, e o CI do desktop está verde, ok."),
            ["O PR quarenta e dois passou em todas as verificações,", "e o CI do desktop está verde, ok."]
        );
        // No comma to cut at: whole, however long.
        let long = "Abri o pai no mnemo-desktop com o pedido inteiro e o que eu juntei sobre ele";
        assert_eq!(lines(long), [long]);
        assert!(lines(" \n ").is_empty());
        assert_eq!(voice_rate(r#"{"audio": {"sample_rate": 22050, "quality": "medium"}}"#), Ok(22050));
        assert!(voice_rate(r#"{"audio": {}}"#).is_err());
    }

    #[test]
    fn pcm_split_anywhere_reads_the_same_samples() {
        let samples: Vec<i16> = vec![0, 1, -1, i16::MAX, i16::MIN, 1234, -4321];
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let whole = Pcm::default().feed(&bytes);
        assert_eq!(whole.len(), samples.len());
        assert_eq!(whole[3], i16::MAX as f32 / 32768.0);
        for cut in [1, 3, 5, 13] {
            let mut pcm = Pcm::default();
            let mut got = pcm.feed(&bytes[..cut]);
            got.extend(pcm.feed(&[]));
            got.extend(pcm.feed(&bytes[cut..]));
            assert_eq!(got, whole, "cut at {cut}");
        }
    }

    /// A synth that says each text as 100 samples of its first letter's code / 1000, and an
    /// output that pulls 10 samples every 2 ms into `heard`, as a device would.
    pub(crate) fn fake_synth() -> Synth {
        Box::new(|text, sink| {
            let v = text.chars().next().map_or(0.0, |c| c as u32 as f32 / 1000.0);
            for _ in 0..4 {
                if !sink(&[v; 25]) {
                    break;
                }
            }
            Ok(())
        })
    }

    pub(crate) fn fake_output(heard: Arc<Mutex<Vec<f32>>>) -> Output {
        Box::new(move |_rate, shared| {
            let into = heard.clone();
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = stop.clone();
            std::thread::spawn(move || {
                while !stopped.load(Ordering::SeqCst) {
                    let mut buf = [0f32; 10];
                    shared.pull(&mut buf, 1.0);
                    lock(&into).extend(buf.iter().copied().filter(|&s| s != 0.0));
                    std::thread::sleep(Duration::from_millis(2));
                }
            });
            struct Stop(Arc<AtomicBool>);
            impl Drop for Stop {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::SeqCst);
                }
            }
            Ok(Box::new(Stop(stop)) as Box<dyn Any>)
        })
    }

    fn speaker(held: bool) -> (Speaker, Arc<AtomicBool>, Arc<Mutex<Vec<f32>>>, mpsc::Receiver<bool>) {
        let heard = Arc::new(Mutex::new(Vec::new()));
        let key = Arc::new(AtomicBool::new(held));
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let on_speaking = Arc::new(move |b| {
            let _ = lock(&tx).send(b);
        });
        let s = Speaker::start(22_050, key.clone(), fake_synth(), fake_output(heard.clone()), on_speaking, Arc::new(|e| panic!("{e}"))).unwrap();
        (s, key, heard, rx)
    }

    fn until(what: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !what() {
            assert!(Instant::now() < deadline, "timed out");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn speech_queued_while_the_key_is_held_waits_for_it_to_be_released() {
        let (s, key, heard, speaking) = speaker(true);
        s.say("abc");
        s.say("zzz");
        assert_eq!(speaking.recv_timeout(Duration::from_secs(5)), Ok(true));
        // Held: synthesized, and not a sample played.
        std::thread::sleep(Duration::from_millis(150));
        assert!(lock(&heard).is_empty(), "spoke over the key");
        assert_eq!(lock(&s.shared.st).audio.len(), 200, "both texts are ready and waiting");
        key.store(false, Ordering::SeqCst);
        until(|| lock(&heard).len() == 200);
        let got = lock(&heard).clone();
        assert!(got[..100].iter().all(|&x| x == 'a' as u32 as f32 / 1000.0), "in the order said");
        assert!(got[100..].iter().all(|&x| x == 'z' as u32 as f32 / 1000.0));
        assert_eq!(speaking.recv_timeout(Duration::from_secs(5)), Ok(false));
    }

    #[test]
    fn the_key_going_down_mid_sentence_pauses_it_where_it_was() {
        let shared = Shared { st: Mutex::new(St::default()), cv: Condvar::new(), held: Arc::default() };
        lock(&shared.st).audio.extend([1.0, 2.0, 3.0, 4.0]);
        let mut out = [0.0; 2];
        shared.pull(&mut out, 1.0);
        assert_eq!(out, [1.0, 2.0]);
        shared.held.store(true, Ordering::SeqCst);
        shared.pull(&mut out, 1.0);
        assert_eq!(out, [0.0, 0.0]);
        shared.held.store(false, Ordering::SeqCst);
        let mut rest = [9.0; 3];
        shared.pull(&mut rest, 1.0);
        assert_eq!(rest, [3.0, 4.0, 0.0], "goes on from where it stopped, then silence");
    }

    #[test]
    fn hush_drops_the_queue_and_what_is_unplayed() {
        let (s, key, heard, speaking) = speaker(true);
        s.say("abc");
        assert_eq!(speaking.recv_timeout(Duration::from_secs(5)), Ok(true));
        until(|| lock(&s.shared.st).audio.len() == 100);
        s.say("bcd");
        s.hush();
        assert_eq!(speaking.recv_timeout(Duration::from_secs(5)), Ok(false));
        key.store(false, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(100));
        assert!(lock(&heard).is_empty());
        // What comes after a hush is said as usual.
        s.say("e");
        until(|| lock(&heard).len() == 100);
    }

    #[test]
    fn an_output_at_another_rate_steps_between_samples() {
        let shared = Shared { st: Mutex::new(St::default()), cv: Condvar::new(), held: Arc::default() };
        lock(&shared.st).audio.extend([0.0, 1.0, 2.0, 3.0]);
        // The voice at half the output's rate: each sample, then the midpoint to the next.
        let mut out = [9.0; 6];
        shared.pull(&mut out, 0.5);
        assert_eq!(out, [0.0, 0.5, 1.0, 1.5, 2.0, 2.5]);
        let mut out = [9.0; 4];
        shared.pull(&mut out, 0.5);
        assert_eq!(out[..2], [3.0, 3.0]);
        assert!(lock(&shared.st).audio.len() <= 1);
    }
}

//! Push-to-talk dictation (issue #10). `voice_start` opens the default input device;
//! `voice_stop` closes it and transcribes the take locally with whisper.cpp. The model
//! downloads once, on first use, into `~/.mnemo-desktop/models/`; nothing else leaves the
//! machine. Where the transcript goes (caret, Monaco, PTY) is the frontend's call. On macOS the
//! model runs on the GPU (Metal), and `warm` loads it at launch so the first take does not wait;
//! elsewhere nothing of whisper runs before the first press.
//! A published build asks the CPU for `BASELINE` before it lets whisper run (#308).

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, TryLockError};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample, I24, U24};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Multilingual base model, 5-bit quantized: Portuguese and English at a third of the
/// full model's size.
pub const MODEL_FILE: &str = "ggml-base-q5_1.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin";
const MODEL_BYTES: u64 = 59_707_625;
/// Points at any ggml whisper model and skips the download (tests, or a bigger model).
const MODEL_ENV: &str = "MNEMO_WHISPER_MODEL";
/// Keeps whisper on the CPU where it would use the GPU (Metal, on macOS): a bench, or a GPU
/// that misbehaves.
const CPU_ENV: &str = "MNEMO_WHISPER_CPU";

/// whisper.cpp only accepts 16 kHz mono.
pub const WHISPER_RATE: u32 = 16_000;
/// A take longer than this keeps only its first five minutes.
const MAX_SECONDS: usize = 300;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Language {
    #[default]
    Auto,
    Pt,
    En,
}

impl Language {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(Self::Auto),
            "pt" => Some(Self::Pt),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    fn code(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Pt => "pt",
            Self::En => "en",
        }
    }
}

#[derive(Default)]
pub struct VoiceState {
    recording: Mutex<Option<Recording>>,
    language: Mutex<Language>,
    /// Loaded once; the lock is held across download and load so concurrent callers wait.
    model: Mutex<Option<Arc<WhisperContext>>>,
}

impl VoiceState {
    /// What dictation listens for, which a dropped file is heard in too (`voice_file.rs`).
    pub fn language(&self) -> Language {
        *lock(&self.language)
    }
}

/// A poisoned lock here only means an earlier take panicked; the data is still usable.
pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------------------
// Capture

pub struct Captured {
    /// Mono, at `rate`.
    pub samples: Vec<f32>,
    pub rate: u32,
}

/// What a take listens to, handed to an `Input` as it opens: where samples go, and where a
/// failure that ends the take is reported.
#[derive(Clone)]
pub struct Sink {
    samples: Arc<Mutex<Vec<f32>>>,
    lost: Arc<Mutex<Option<String>>>,
    on_lost: Arc<dyn Fn(&str) + Send + Sync>,
}

impl Sink {
    /// Appends interleaved `channels`-wide frames, up to `cap` mono samples.
    pub fn push<T>(&self, data: &[T], channels: usize, cap: usize)
    where
        T: Copy,
        f32: FromSample<T>,
    {
        let mut b = lock(&self.samples);
        if b.len() < cap {
            mix_to_mono(data, channels, &mut b);
        }
    }

    /// The input stopped delivering: kept for `finish`, and said at once through `on_lost`.
    /// Only the first failure counts.
    pub fn lose(&self, why: &str) {
        let mut lost = lock(&self.lost);
        if lost.is_none() {
            *lost = Some(why.to_string());
            (self.on_lost)(why);
        }
    }
}

/// An opened input: what keeps it open (dropped to close it), its rate and its name.
pub struct Opened {
    pub keep: Box<dyn std::any::Any>,
    pub rate: u32,
    pub device: String,
}

/// Opens an input on the capture thread: the default microphone, or a stand-in in tests.
pub type Input = Box<dyn FnOnce(Sink) -> Result<Opened, String> + Send>;

/// A live take. The cpal stream is not `Send`, so it lives on its own thread until the
/// stop sender drops.
struct Recording {
    stop: mpsc::Sender<()>,
    thread: JoinHandle<Result<Captured, String>>,
    lost: Arc<Mutex<Option<String>>>,
    device: String,
}

impl Recording {
    /// `on_lost` hears a failure that ends the take as it happens, from the input's thread.
    fn start(input: Input, on_lost: impl Fn(&str) + Send + Sync + 'static) -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<String, String>>();
        let (stop, stop_rx) = mpsc::channel::<()>();
        let sink = Sink { samples: Arc::default(), lost: Arc::default(), on_lost: Arc::new(on_lost) };
        let lost = sink.lost.clone();
        let thread = std::thread::Builder::new()
            .name("voice-capture".into())
            .spawn(move || {
                let samples = sink.samples.clone();
                let opened = match input(sink) {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e.clone()));
                        return Err(e);
                    }
                };
                let _ = ready_tx.send(Ok(opened.device));
                // Returns once `stop` is dropped.
                let _ = stop_rx.recv();
                drop(opened.keep);
                let samples = std::mem::take(&mut *lock(&samples));
                Ok(Captured { samples, rate: opened.rate })
            })
            .map_err(|e| format!("voice: {e}"))?;
        match ready_rx.recv() {
            Ok(Ok(device)) => Ok(Self { stop, thread, lost, device }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("voice: capture thread died".into()),
        }
    }

    /// The take, or why the microphone stopped partway: what it heard before then is not
    /// transcribed, since a take cut short reads as a sentence that was never said.
    fn finish(self) -> Result<Captured, String> {
        drop(self.stop);
        let take = self.thread.join().map_err(|_| "voice: capture thread panicked".to_string())??;
        match lock(&self.lost).take() {
            Some(why) => Err(lost_message(&self.device, &why)),
            None => Ok(take),
        }
    }
}

/// What a take whose microphone went away says.
pub fn lost_message(device: &str, why: &str) -> String {
    let why = why.trim().trim_end_matches('.');
    format!("the microphone ({device}) stopped during the take: {why}. Nothing was transcribed.")
}

/// A stream error that means no more audio is coming. A rerouted default (`DeviceChanged`), a
/// glitch (`Xrun`) or a refused real-time priority leaves the stream running.
fn ends_take(kind: cpal::ErrorKind) -> bool {
    use cpal::ErrorKind as K;
    matches!(kind, K::DeviceNotAvailable | K::StreamInvalidated | K::HostUnavailable | K::PermissionDenied)
}

/// The default input device, as cpal opens it.
fn default_input(sink: Sink) -> Result<Opened, String> {
    let device = cpal::default_host().default_input_device().ok_or("no microphone found")?;
    let name = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| "default microphone".into());
    let supported = device.default_input_config().map_err(|e| format!("microphone {name}: {e}"))?;
    let rate = supported.sample_rate();
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        SampleFormat::I8 => build_input::<i8>(&device, config, sink),
        SampleFormat::I16 => build_input::<i16>(&device, config, sink),
        SampleFormat::I24 => build_input::<I24>(&device, config, sink),
        SampleFormat::I32 => build_input::<i32>(&device, config, sink),
        SampleFormat::U8 => build_input::<u8>(&device, config, sink),
        SampleFormat::U16 => build_input::<u16>(&device, config, sink),
        SampleFormat::U24 => build_input::<U24>(&device, config, sink),
        SampleFormat::U32 => build_input::<u32>(&device, config, sink),
        SampleFormat::F32 => build_input::<f32>(&device, config, sink),
        SampleFormat::F64 => build_input::<f64>(&device, config, sink),
        other => return Err(format!("microphone {name}: unsupported sample format {other}")),
    }
    .map_err(|e| format!("microphone {name}: {e}"))?;
    stream.play().map_err(|e| format!("microphone {name}: {e}"))?;
    Ok(Opened { keep: Box::new(stream), rate, device: name })
}

fn build_input<T>(device: &cpal::Device, config: cpal::StreamConfig, sink: Sink) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let cap = config.sample_rate as usize * MAX_SECONDS;
    let errors = sink.clone();
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| sink.push(data, channels, cap),
            move |e| {
                log::warn!("voice: input stream: {e}");
                if ends_take(e.kind()) {
                    errors.lose(&e.to_string());
                }
            },
            None,
        )
        .map_err(|e| e.to_string())
}

/// Appends interleaved `channels`-wide frames to `out` as their per-frame mean.
pub fn mix_to_mono<T>(data: &[T], channels: usize, out: &mut Vec<f32>)
where
    T: Copy,
    f32: FromSample<T>,
{
    let channels = channels.max(1);
    out.extend(
        data.chunks_exact(channels)
            .map(|frame| frame.iter().map(|&s| <f32 as FromSample<T>>::from_sample_(s)).sum::<f32>() / channels as f32),
    );
}

// ---------------------------------------------------------------------------------------
// Signal

/// Band-limited resampling: a Hann-windowed sinc whose cutoff is the lower of the two
/// Nyquist frequencies, so a 48 kHz take loses what 16 kHz cannot hold instead of aliasing it.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    /// Zero crossings of the kernel on each side, in output samples.
    const HALF: f64 = 12.0;
    let ratio = to as f64 / from as f64;
    let cutoff = ratio.min(1.0);
    let reach = HALF / cutoff;
    let out_len = (input.len() as f64 * ratio).round() as usize;
    // Output i sits at input position i·from/to, whose fraction takes only `phases` values:
    // one table of weights per phase, instead of a sine and a cosine per tap (a 25 s take at
    // 44.1 kHz: 150 ms to 10 ms). A rate no microphone has could need millions of phases;
    // those weigh each output as it comes.
    let g = gcd(from, to);
    let phases = (to / g) as usize;
    let taps = |frac: f64| -> Taps {
        let first = (frac - reach).ceil() as i64;
        let last = (frac + reach).floor() as i64;
        let weights: Vec<f64> = (first..=last)
            .map(|j| {
                let x = (j as f64 - frac) * cutoff;
                sinc(x) * 0.5 * (1.0 + (std::f64::consts::PI * x / HALF).cos())
            })
            .collect();
        let norm = weights.iter().sum();
        Taps { first, weights, norm }
    };
    let table: Option<Vec<Taps>> =
        (phases <= 4096).then(|| (0..phases).map(|p| taps(p as f64 / phases as f64)).collect());
    (0..out_len)
        .map(|i| {
            let pos = i as u64 * from as u64;
            let whole = (pos / to as u64) as i64;
            let phase = ((pos % to as u64) / g as u64) as usize;
            let own;
            let t = match &table {
                Some(table) => &table[phase],
                None => {
                    own = taps(phase as f64 / phases as f64);
                    &own
                }
            };
            let start = whole + t.first;
            if start >= 0 && start as usize + t.weights.len() <= input.len() {
                let window = &input[start as usize..start as usize + t.weights.len()];
                let acc: f64 = window.iter().zip(&t.weights).map(|(&s, &w)| s as f64 * w).sum();
                return (acc / t.norm) as f32;
            }
            // Near either end the kernel is cut short: weigh by the taps that remain.
            let (mut acc, mut norm) = (0.0f64, 0.0f64);
            for (k, &w) in t.weights.iter().enumerate() {
                let at = start + k as i64;
                if at >= 0 && (at as usize) < input.len() {
                    acc += input[at as usize] as f64 * w;
                    norm += w;
                }
            }
            if norm.abs() > 1e-9 { (acc / norm) as f32 } else { 0.0 }
        })
        .collect()
}

/// The kernel for one phase: weights for inputs `first..` relative to the output's whole
/// input position, and their sum.
struct Taps {
    first: i64,
    weights: Vec<f64>,
    norm: f64,
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// True when no 30 ms window of 16 kHz audio rises above a muted or dead input. Whisper,
/// fed digital silence, invents a "Thank you." rather than returning nothing; room noise it
/// handles itself, and a higher floor would swallow a quiet microphone (measured: a built-in
/// mic idles near 0.0013 RMS, faint speech at 0.0024).
pub fn is_silent(audio: &[f32]) -> bool {
    const WINDOW: usize = WHISPER_RATE as usize * 3 / 100;
    const FLOOR: f32 = 0.001;
    !audio.chunks(WINDOW).any(|w| {
        let rms = (w.iter().map(|s| s * s).sum::<f32>() / w.len() as f32).sqrt();
        rms > FLOOR
    })
}

/// Joins segment texts, dropping whisper's non-speech annotations (`[BLANK_AUDIO]`,
/// `(music)`, `[Música]`) and collapsing whitespace.
pub fn clean_transcript(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut depth = 0usize;
    for c in raw.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---------------------------------------------------------------------------------------
// CPU baseline

/// What a published build's whisper needs from an x86 CPU (#308): the instruction sets ggml
/// turns on by itself once it is told not to tune the build to the machine compiling it, which
/// `GGML_NATIVE=OFF` in ci.yml and release.yml does. Haswell (2013) and Zen (2017) onwards have
/// all six; `scripts/portable-build.mjs` fails a build that has anything on beyond them.
pub const BASELINE: [&str; 6] = ["sse4.2", "avx", "f16c", "fma", "bmi2", "avx2"];

/// CMake's reading of a value as false, for `GGML_NATIVE`.
fn cmake_off(value: &str) -> bool {
    matches!(value.trim().to_ascii_uppercase().as_str(), "OFF" | "0" | "NO" | "FALSE" | "N")
}

/// The features of `BASELINE` that `has` does not report, in its order.
pub fn missing_features(has: impl Fn(&str) -> bool) -> Vec<&'static str> {
    BASELINE.iter().copied().filter(|f| !has(f)).collect()
}

#[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
fn cpu_has(feature: &str) -> bool {
    match feature {
        "sse4.2" => std::arch::is_x86_feature_detected!("sse4.2"),
        "avx" => std::arch::is_x86_feature_detected!("avx"),
        "f16c" => std::arch::is_x86_feature_detected!("f16c"),
        "fma" => std::arch::is_x86_feature_detected!("fma"),
        "bmi2" => std::arch::is_x86_feature_detected!("bmi2"),
        "avx2" => std::arch::is_x86_feature_detected!("avx2"),
        _ => false,
    }
}

/// The baseline is x86's: on another architecture there is nothing of it to lack.
#[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
fn cpu_has(_feature: &str) -> bool {
    true
}

/// Whether whisper can run on this CPU, asked before anything of whisper's runs. It cannot be
/// left to fail: on a CPU below what it was compiled for it executes an instruction the CPU
/// does not have, and the whole app dies with it, at every launch once the model is on disk.
/// A build tuned to its own machine (compiled without `GGML_NATIVE=OFF`) is not asked: that
/// machine has what the build was tuned to.
pub fn cpu_check() -> Result<(), String> {
    if !option_env!("GGML_NATIVE").is_some_and(cmake_off) {
        return Ok(());
    }
    let missing = missing_features(cpu_has);
    if missing.is_empty() {
        return Ok(());
    }
    Err(format!("dictation is not available on this CPU: it lacks {}", missing.join(", ")))
}

// ---------------------------------------------------------------------------------------
// Model and transcription

pub fn models_dir() -> PathBuf {
    // Shared by a debug build: the model is large and lands by a rename into place.
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    crate::app_dir::shared_dir_in(&home.map(PathBuf::from).unwrap_or_default()).join("models")
}

/// A whole model at `path`, not a missing or truncated one.
fn model_on_disk(path: &Path) -> bool {
    std::fs::metadata(path).map(|m| m.len() == MODEL_BYTES).unwrap_or(false)
}

/// How long the download may go without a byte before it counts as stalled. ureq has no
/// per-read timeout (`timeout_recv_body` is a budget for the whole body, not restarted per
/// read), so each request gets this long; one that ran out having brought bytes is followed by
/// a request for the rest, and one that brought none ends the download.
pub(crate) const STALL: Duration = Duration::from_secs(30);

/// Returns the model in `dir`, downloading it first if it is missing or truncated.
/// `progress(downloaded, total)` fires as bytes arrive.
pub fn ensure_model(dir: &Path, progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let path = dir.join(MODEL_FILE);
    if model_on_disk(&path) {
        return Ok(path);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    download(MODEL_URL, &path, MODEL_BYTES, STALL, progress).map_err(|e| format!("model download: {e}"))?;
    Ok(path)
}

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1e6)
}

/// Fetches `total` bytes from `url` into `path` through `<path>.part`, which a failed download
/// keeps: the next call asks for what it lacks (`Range`) instead of starting over. A download
/// still moving goes on however slow it is; one that brings nothing for `stall` fails.
pub fn download(url: &str, path: &Path, total: u64, stall: Duration, mut progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(stall))
        .timeout_recv_body(Some(stall))
        .build()
        .new_agent();
    let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > total {
        have = 0;
    }
    let kept = |have: u64| {
        if have > 0 {
            format!("; {} of {} kept, the next try goes on from there", megabytes(have), megabytes(total))
        } else {
            String::new()
        }
    };
    progress(have, total);
    let mut chunk = vec![0u8; 1 << 16];
    while have < total {
        let mut request = agent.get(url);
        if have > 0 {
            request = request.header("Range", format!("bytes={have}-"));
        }
        let response = match request.call() {
            Ok(r) => r,
            // What the `.part` holds does not fit the file served now: start over next time.
            Err(ureq::Error::StatusCode(416)) => {
                let _ = std::fs::remove_file(&part);
                return Err(format!("the server refused to resume at byte {have}; the next try starts over"));
            }
            Err(e) => return Err(format!("{e}{}", kept(have))),
        };
        // A server that ignores `Range` sends the whole file again.
        let resumed = have > 0 && response.status() == 206;
        let mut file = if resumed {
            std::fs::OpenOptions::new().append(true).open(&part)
        } else {
            have = 0;
            std::fs::File::create(&part)
        }
        .map_err(|e| format!("{}: {e}", part.display()))?;
        let mut body = response.into_body().into_with_config().limit(total - have + 1).reader();
        let before = have;
        let failed = loop {
            match body.read(&mut chunk) {
                Ok(0) => break None,
                Ok(n) => {
                    file.write_all(&chunk[..n]).map_err(|e| format!("{}: {e}", part.display()))?;
                    let was = have;
                    have += n as u64;
                    if have > total {
                        drop(file);
                        let _ = std::fs::remove_file(&part);
                        return Err(format!("expected {total} bytes, got more"));
                    }
                    if have >> 20 != was >> 20 {
                        progress(have, total);
                    }
                }
                Err(e) => break Some(e),
            }
        };
        file.flush().map_err(|e| format!("{}: {e}", part.display()))?;
        drop(file);
        if have == before && have < total {
            let why = failed.map(|e| e.to_string()).unwrap_or_else(|| "the server sent nothing".into());
            return Err(format!("stalled, nothing arrived in {} s ({why}){}", stall.as_secs_f32(), kept(have)));
        }
        if let Some(e) = failed {
            log::info!("voice: download paused at {have} bytes ({e}); asking for the rest");
        }
    }
    progress(have, total);
    std::fs::rename(&part, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Whether whisper runs on the GPU: Metal on macOS, unless `MNEMO_WHISPER_CPU` is set.
pub fn uses_gpu() -> bool {
    cfg!(target_os = "macos") && std::env::var_os(CPU_ENV).is_none()
}

pub fn load_context(path: &Path) -> Result<WhisperContext, String> {
    whisper_rs::install_logging_hooks();
    let p = path.to_str().ok_or("model path is not UTF-8")?;
    // Flash attention takes a third or more off the GPU's time on a take and makes the CPU 1.6
    // times slower (measured on an M5), so it goes with the GPU.
    let gpu = uses_gpu();
    let mut params = WhisperContextParameters::default();
    params.use_gpu(gpu).flash_attn(gpu);
    WhisperContext::new_with_params(p, params).map_err(|e| format!("model {p}: {e}"))
}

/// Tokens one decoding pass may spend on `samples` of audio. A pass covers up to 30 s; speech,
/// timestamps included, runs well under 8 tokens a second in English and Portuguese. Without a
/// budget a pass that loops on a repeated phrase runs to whisper's 220-token cap, once per
/// fallback temperature, and an 8 s take took up to 33 s on the CPU. A pass that does reach the
/// budget loses nothing: whisper ends the segment at its last timestamp and decodes the rest in
/// the next pass.
pub fn token_budget(samples: usize) -> i32 {
    let seconds = (samples as f32 / WHISPER_RATE as f32).min(30.0);
    16 + (seconds * 8.0) as i32
}

/// Fallback temperatures step by this: a pass that fails is retried at 0.4 and 0.8, not at
/// whisper's five steps of 0.2.
const TEMPERATURE_STEP: f32 = 0.4;

fn decode_params(language: Language, samples: usize) -> FullParams<'static, 'static> {
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language.code()));
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    params.set_n_threads(threads as _);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    params.set_max_tokens(token_budget(samples));
    params.set_temperature_inc(TEMPERATURE_STEP);
    params
}

/// Transcribes 16 kHz mono audio. Silence yields an empty string without running the model.
pub fn transcribe(ctx: &WhisperContext, audio: &[f32], language: Language) -> Result<String, String> {
    transcribe_with(ctx, audio, language, None::<fn(i32)>)
}

/// `transcribe`, telling `progress` how far through the audio whisper is, in percent: a dropped
/// file runs for minutes where a take runs for a second (`voice_file.rs`).
pub fn transcribe_with<F: FnMut(i32) + 'static>(
    ctx: &WhisperContext,
    audio: &[f32],
    language: Language,
    progress: Option<F>,
) -> Result<String, String> {
    if is_silent(audio) {
        return Ok(String::new());
    }
    // whisper.cpp rejects takes under a second; a quarter second of tail also keeps it
    // from clipping the last word.
    let min = WHISPER_RATE as usize + WHISPER_RATE as usize / 4;
    let mut padded = audio.to_vec();
    padded.resize(padded.len().max(min) + WHISPER_RATE as usize / 4, 0.0);

    let mut params = decode_params(language, audio.len());
    if let Some(progress) = progress {
        params.set_progress_callback_safe::<Option<F>, F>(Some(progress));
    }
    let mut state = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
    state.full(params, &padded).map_err(|e| format!("whisper: {e}"))?;

    let mut raw = String::new();
    for segment in state.as_iter() {
        raw.push_str(&segment.to_str_lossy().map_err(|e| format!("whisper: {e}"))?);
        raw.push(' ');
    }
    Ok(clean_transcript(&raw))
}

/// Runs the model once on a made-up take, so the process has built its GPU pipelines before a
/// real take needs them. With `load_context` it is the whole cost of a cold start: on a machine
/// that has never run them, loading compiles Metal's shaders (measured: 10.4 s, then 0.2 s once
/// macOS has cached them). On the CPU there are no pipelines to build: it would be a whole
/// encode for nothing, so it runs only with the GPU (`warms`).
pub fn warm_up(ctx: &WhisperContext) -> Result<(), String> {
    let take: Vec<f32> = (0..WHISPER_RATE as usize * 3 / 2)
        .map(|i| 0.1 * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / WHISPER_RATE as f32).sin())
        .collect();
    let mut params = decode_params(Language::En, take.len());
    params.set_max_tokens(8);
    let mut state = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
    state.full(params, &take).map_err(|e| format!("whisper: {e}"))?;
    Ok(())
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: u64,
}

fn model(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
    // Before the download as well as the load: a model this CPU cannot run is 60 MB of nothing.
    cpu_check()?;
    let state = app.state::<VoiceState>();
    let mut slot = lock(&state.model);
    if let Some(ctx) = slot.as_ref() {
        return Ok(ctx.clone());
    }
    let path = match std::env::var_os(MODEL_ENV) {
        Some(p) => PathBuf::from(p),
        None => ensure_model(&models_dir(), |downloaded, total| {
            let _ = app.emit("voice://progress", Progress { downloaded, total });
        })?,
    };
    let ctx = Arc::new(load_context(&path)?);
    if uses_gpu() {
        if let Err(e) = warm_up(&ctx) {
            log::warn!("voice: warming the model: {e}");
        }
    }
    *slot = Some(ctx.clone());
    Ok(ctx)
}

/// Whether the launch loads and warms the model. Only for the GPU, whose first run compiles
/// shaders for seconds; on the CPU loading takes a few hundredths of a second, so nothing of
/// whisper runs, and nothing of it is held in memory, until the first press. Never with no
/// model on disk: the download waits for the first press too.
pub fn warms_at_launch(gpu: bool, model_present: bool) -> bool {
    gpu && model_present
}

/// At launch, on the GPU: loads and warms the model in the background when it is already on
/// disk, so the first take waits for neither (`warms_at_launch`).
pub fn warm(app: &AppHandle) {
    let present = std::env::var_os(MODEL_ENV).is_some() || model_on_disk(&models_dir().join(MODEL_FILE));
    if !warms_at_launch(uses_gpu(), present) {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("voice-warm".into()).spawn(move || {
        let started = std::time::Instant::now();
        match model(&app) {
            Ok(_) => log::info!("voice: model ready in {:.1}s", started.elapsed().as_secs_f32()),
            Err(e) => log::warn!("voice: preparing model: {e}"),
        }
    });
    if let Err(e) = spawned {
        log::warn!("voice: {e}");
    }
}

// ---------------------------------------------------------------------------------------
// Commands

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("voice: {e}"))?
}

/// Opens the microphone and returns its name. Also starts fetching and loading the model in the
/// background, so the first take's download runs while the user is still talking. A microphone
/// that goes away during the take is said at once on `voice://lost`, and again by `voice_stop`.
#[tauri::command]
pub async fn voice_start(app: AppHandle) -> Result<String, String> {
    blocking(move || {
        // Said at the first press, not after a take nothing will transcribe.
        cpu_check()?;
        let state = app.state::<VoiceState>();
        let device;
        {
            let mut slot = lock(&state.recording);
            if slot.is_some() {
                return Err("already recording".into());
            }
            let lost = app.clone();
            let recording = Recording::start(Box::new(default_input), move |why| {
                let _ = lost.emit("voice://lost", why.to_string());
            })?;
            device = recording.device.clone();
            *slot = Some(recording);
        }
        let cold = match state.model.try_lock() {
            Ok(m) => m.is_none(),
            Err(TryLockError::Poisoned(m)) => m.into_inner().is_none(),
            // Held: a load is already under way.
            Err(TryLockError::WouldBlock) => false,
        };
        if cold {
            let app = app.clone();
            std::thread::spawn(move || {
                if let Err(e) = model(&app) {
                    log::warn!("voice: preparing model: {e}");
                }
            });
        }
        Ok(device)
    })
    .await
}

/// Closes the microphone and returns the transcript (empty for silence). On first use this
/// waits for the model download, reporting on `voice://progress`.
#[tauri::command]
pub async fn voice_stop(app: AppHandle) -> Result<String, String> {
    blocking(move || {
        let state = app.state::<VoiceState>();
        let recording = lock(&state.recording).take().ok_or("not recording")?;
        let take = recording.finish()?;
        let audio = resample(&take.samples, take.rate, WHISPER_RATE);
        if is_silent(&audio) {
            return Ok(String::new());
        }
        let ctx = model(&app)?;
        let language = *lock(&state.language);
        transcribe(&ctx, &audio, language)
    })
    .await
}

/// `auto`, `pt` or `en`; applies from the next `voice_stop`.
#[tauri::command]
pub fn voice_set_language(app: AppHandle, language: String) -> Result<(), String> {
    let lang = Language::parse(&language).ok_or_else(|| format!("unknown language {language:?}"))?;
    *lock(&app.state::<VoiceState>().language) = lang;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f32, rate: u32, seconds: f32, amp: f32) -> Vec<f32> {
        (0..(rate as f32 * seconds) as usize)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    fn rms(s: &[f32]) -> f32 {
        (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
    }

    #[test]
    fn a_cpu_with_the_whole_baseline_lacks_nothing_and_avx512_is_never_asked_for() {
        assert!(missing_features(|_| true).is_empty());
        // The machine of #308, an i7-10700F: all of the baseline, no AVX-512.
        let comet_lake = ["sse4.2", "avx", "f16c", "fma", "bmi2", "avx2"];
        assert!(missing_features(|f| comet_lake.contains(&f)).is_empty());
        assert!(!BASELINE.iter().any(|f| f.starts_with("avx512")));
    }

    #[test]
    fn a_cpu_below_the_baseline_is_told_what_it_lacks_in_order() {
        // Sandy Bridge: AVX, and nothing that came after it.
        let sandy_bridge = ["sse4.2", "avx"];
        assert_eq!(missing_features(|f| sandy_bridge.contains(&f)), vec!["f16c", "fma", "bmi2", "avx2"]);
        assert_eq!(missing_features(|_| false), BASELINE.to_vec());
    }

    #[test]
    fn ggml_native_is_off_the_way_cmake_reads_it() {
        for off in ["OFF", "off", "0", "FALSE", "No", " OFF "] {
            assert!(cmake_off(off), "{off:?}");
        }
        for on in ["ON", "1", "TRUE", "", "native"] {
            assert!(!cmake_off(on), "{on:?}");
        }
    }

    #[test]
    fn the_machine_running_the_suite_passes_its_own_check() {
        // Every CI runner has the baseline; with `GGML_NATIVE=OFF` this is the real probe.
        assert_eq!(cpu_check(), Ok(()));
    }

    #[test]
    fn mixes_interleaved_frames_to_their_mean() {
        let mut out = vec![];
        mix_to_mono(&[1.0f32, 0.0, 0.5, 0.5, -1.0, 1.0], 2, &mut out);
        assert_eq!(out, vec![0.5, 0.5, 0.0]);
        let mut ints = vec![];
        mix_to_mono(&[i16::MAX, i16::MIN], 1, &mut ints);
        assert!((ints[0] - 1.0).abs() < 1e-3 && (ints[1] + 1.0).abs() < 1e-3);
    }

    #[test]
    fn resample_keeps_length_ratio_and_passes_speech_band() {
        let input = tone(440.0, 48_000, 1.0, 0.5);
        let out = resample(&input, 48_000, WHISPER_RATE);
        assert_eq!(out.len(), 16_000);
        let ideal = tone(440.0, WHISPER_RATE, 1.0, 0.5);
        // Edges see a truncated kernel; judge the middle.
        let err: Vec<f32> = out[400..15_600].iter().zip(&ideal[400..15_600]).map(|(a, b)| a - b).collect();
        assert!(rms(&err) < 0.01, "rms error {}", rms(&err));
        assert_eq!(resample(&input, 48_000, 48_000), input);
        assert!(resample(&[], 44_100, WHISPER_RATE).is_empty());
    }

    #[test]
    fn resample_filters_what_16k_cannot_hold_instead_of_aliasing() {
        // 12 kHz at 48 kHz would fold to 4 kHz, squarely in the speech band.
        let out = resample(&tone(12_000.0, 48_000, 1.0, 0.5), 48_000, WHISPER_RATE);
        assert!(rms(&out[400..15_600]) < 0.01, "leak {}", rms(&out[400..15_600]));
        let odd = resample(&tone(300.0, 44_100, 1.0, 0.5), 44_100, WHISPER_RATE);
        assert_eq!(odd.len(), 16_000);
        assert!((rms(&odd[400..15_600]) - 0.5 / 2f32.sqrt()).abs() < 0.01);
    }

    /// The resampler before its phase tables: a sine and a cosine per tap.
    fn resample_direct(input: &[f32], from: u32, to: u32) -> Vec<f32> {
        const HALF: f64 = 12.0;
        let ratio = to as f64 / from as f64;
        let cutoff = ratio.min(1.0);
        let reach = HALF / cutoff;
        let last = input.len() - 1;
        let out_len = (input.len() as f64 * ratio).round() as usize;
        (0..out_len)
            .map(|i| {
                let t = i as f64 / ratio;
                let lo = (t - reach).ceil().max(0.0) as usize;
                let hi = ((t + reach).floor() as usize).min(last);
                let (mut acc, mut norm) = (0.0f64, 0.0f64);
                for (k, &s) in input[lo..=hi.max(lo)].iter().enumerate() {
                    let x = ((lo + k) as f64 - t) * cutoff;
                    let w = sinc(x) * 0.5 * (1.0 + (std::f64::consts::PI * x / HALF).cos());
                    acc += s as f64 * w;
                    norm += w;
                }
                if norm.abs() > 1e-9 { (acc / norm) as f32 } else { 0.0 }
            })
            .collect()
    }

    #[test]
    fn resample_matches_the_direct_kernel_at_every_rate() {
        let mut seed = 0x9e37_79b9u32;
        let noise: Vec<f32> = (0..30_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                seed as f32 / u32::MAX as f32 - 0.5
            })
            .collect();
        // 44_101 has 16 000 phases, past the table: each output weighs its own taps.
        for from in [48_000, 44_100, 22_050, 8_000, 96_000, 44_101] {
            let fast = resample(&noise, from, WHISPER_RATE);
            let slow = resample_direct(&noise, from, WHISPER_RATE);
            assert_eq!(fast.len(), slow.len(), "{from}");
            let worst = fast.iter().zip(&slow).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
            assert!(worst < 1e-5, "{from}: off by {worst}");
        }
        assert_eq!(resample(&[0.5], 48_000, WHISPER_RATE).len(), 0);
        assert_eq!(resample(&[0.5, 0.5], 8_000, WHISPER_RATE), vec![0.5; 4]);
    }

    #[test]
    fn token_budget_grows_with_the_take_up_to_one_window() {
        assert_eq!(token_budget(0), 16);
        assert_eq!(token_budget(8 * WHISPER_RATE as usize), 80);
        assert_eq!(token_budget(30 * WHISPER_RATE as usize), 256);
        assert_eq!(token_budget(300 * WHISPER_RATE as usize), 256);
    }

    #[test]
    fn silence_is_detected_and_speech_level_is_not() {
        assert!(is_silent(&vec![0.0; 16_000]));
        assert!(is_silent(&tone(200.0, WHISPER_RATE, 1.0, 0.001)));
        assert!(!is_silent(&tone(200.0, WHISPER_RATE, 1.0, 0.004)));
        assert!(is_silent(&[]));
    }

    #[test]
    fn transcript_drops_non_speech_annotations() {
        assert_eq!(clean_transcript(" [BLANK_AUDIO] "), "");
        assert_eq!(clean_transcript(" Olá, (música) tudo bem?  [Music]\n"), "Olá, tudo bem?");
        assert_eq!(clean_transcript(" Hello  world. "), "Hello world.");
        assert_eq!(clean_transcript("a [nested [x] y] b"), "a b");
    }

    #[test]
    fn languages_parse() {
        assert_eq!(Language::parse("pt"), Some(Language::Pt));
        assert_eq!(Language::parse("auto").map(Language::code), Some("auto"));
        assert_eq!(Language::parse("fr"), None);
    }

    // -- download --

    /// How the test server answers one connection, given where it was asked to start.
    #[derive(Clone, Copy)]
    enum Serve {
        /// The rest of the body, `chunk` bytes every `every`.
        Slow { chunk: usize, every: Duration },
        /// `bytes` of it, then nothing while the connection stays open.
        StallAfter { bytes: usize },
    }

    /// A local HTTP server for `body` that honours `Range`. Connection `n` is served by
    /// `plan(n)`; the `Range` asked of each connection is recorded.
    fn serve(body: Vec<u8>, plan: impl Fn(usize) -> Serve + Send + 'static) -> (String, Arc<Mutex<Vec<Option<String>>>>) {
        use std::io::BufRead;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
        let asked = Arc::new(Mutex::new(Vec::new()));
        let seen = asked.clone();
        let body = Arc::new(body);
        std::thread::spawn(move || {
            for (n, conn) in listener.incoming().enumerate() {
                let Ok(mut conn) = conn else { return };
                let mut reader = std::io::BufReader::new(conn.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = Some(v.trim().trim_end_matches('-').to_string());
                    }
                }
                lock(&seen).push(range.clone());
                let from: usize = range.as_deref().map_or(0, |r| r.parse().unwrap());
                let (body, how) = (body.clone(), plan(n));
                std::thread::spawn(move || {
                    let rest = &body[from..];
                    let head = if from > 0 {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{}\r\n\r\n",
                            rest.len(),
                            body.len() - 1,
                            body.len()
                        )
                    } else {
                        format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", rest.len())
                    };
                    if conn.write_all(head.as_bytes()).is_err() {
                        return;
                    }
                    match how {
                        Serve::Slow { chunk, every } => {
                            for piece in rest.chunks(chunk) {
                                if conn.write_all(piece).and_then(|_| conn.flush()).is_err() {
                                    return;
                                }
                                std::thread::sleep(every);
                            }
                        }
                        Serve::StallAfter { bytes } => {
                            let _ = conn.write_all(&rest[..bytes.min(rest.len())]);
                            let _ = conn.flush();
                            std::thread::sleep(Duration::from_secs(10));
                        }
                    }
                });
            }
        });
        (url, asked)
    }

    fn body(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 7 % 251) as u8).collect()
    }

    #[test]
    fn a_slow_download_that_keeps_moving_finishes() {
        // 96 KiB at 4 KiB every 40 ms takes about a second; nothing may stall for 400 ms.
        let data = body(96 * 1024);
        let (url, asked) = serve(data.clone(), |_| Serve::Slow { chunk: 4096, every: Duration::from_millis(40) });
        let dir = crate::testutil::temp_dir("voice-dl");
        let path = dir.join("model.bin");
        let started = std::time::Instant::now();
        download(&url, &path, data.len() as u64, Duration::from_millis(400), |_, _| {}).unwrap();
        assert!(started.elapsed() > Duration::from_millis(400), "the body outlasted one window");
        assert_eq!(std::fs::read(&path).unwrap(), data);
        assert!(!dir.join("model.bin.part").exists());
        // Every request after the first asked for the rest, not for byte 0.
        let asked = lock(&asked).clone();
        assert!(asked.len() >= 2, "{asked:?}");
        assert!(asked[1..].iter().all(|r| r.as_deref().is_some_and(|r| r != "0")), "{asked:?}");
    }

    #[test]
    fn a_stalled_download_times_out_and_the_next_try_goes_on_from_what_it_kept() {
        let data = body(64 * 1024);
        // The first connection brings 10 000 bytes and goes quiet; every later one brings none.
        let (url, stalled) = serve(data.clone(), |n| Serve::StallAfter { bytes: if n == 0 { 10_000 } else { 0 } });
        let dir = crate::testutil::temp_dir("voice-dl");
        let path = dir.join("model.bin");
        let part = dir.join("model.bin.part");
        let started = std::time::Instant::now();
        let err = download(&url, &path, data.len() as u64, Duration::from_millis(300), |_, _| {}).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        assert!(err.contains("stalled") && err.contains("kept"), "{err}");
        // The first request ran out its window having moved, so the rest was asked for once.
        assert_eq!(lock(&stalled).clone(), vec![None, Some("10000".to_string())]);
        assert_eq!(std::fs::read(&part).unwrap(), data[..10_000]);
        assert!(!path.exists());

        let (url, asked) = serve(data.clone(), |_| Serve::Slow { chunk: 8192, every: Duration::ZERO });
        let mut first = None;
        download(&url, &path, data.len() as u64, Duration::from_millis(300), |done, _| {
            first.get_or_insert(done);
        })
        .unwrap();
        assert_eq!(lock(&asked).clone(), vec![Some("10000".to_string())]);
        assert_eq!(first, Some(10_000));
        assert_eq!(std::fs::read(&path).unwrap(), data);
        assert!(!part.exists());
    }

    #[test]
    fn a_server_that_ignores_range_is_read_from_the_start() {
        let data = body(32 * 1024);
        let dir = crate::testutil::temp_dir("voice-dl");
        let path = dir.join("model.bin");
        // A `.part` of the wrong bytes, and a server that answers every request with all of it.
        std::fs::write(dir.join("model.bin.part"), vec![0xffu8; 5000]).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/m", listener.local_addr().unwrap());
        let served = data.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let (mut conn, _) = listener.accept().unwrap();
            let mut reader = std::io::BufReader::new(conn.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap() > 0 && line != "\r\n" {
                line.clear();
            }
            let _ = write!(conn, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", served.len());
            let _ = conn.write_all(&served);
        });
        download(&url, &path, data.len() as u64, Duration::from_secs(5), |_, _| {}).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), data);
    }

    // -- launch --

    #[test]
    fn only_the_gpu_path_runs_whisper_at_launch() {
        assert!(warms_at_launch(true, true));
        assert!(!warms_at_launch(false, true), "the CPU path waits for the first press");
        assert!(!warms_at_launch(true, false), "nothing downloads at launch");
        assert!(!warms_at_launch(false, false));
        // Windows and Linux have no GPU path: their launch runs nothing of whisper.
        if !cfg!(target_os = "macos") {
            assert!(!uses_gpu());
        }
    }

    // -- capture --

    /// A stand-in microphone: `before` samples at 48 kHz from its own thread, then, when
    /// `fail` is set, the failure a disconnected device reports.
    fn fake_input(before: usize, fail: Option<&'static str>, delivered: mpsc::Sender<()>) -> Input {
        Box::new(move |sink: Sink| {
            let feeder = std::thread::spawn(move || {
                sink.push(&vec![0.25f32; before], 1, usize::MAX);
                if let Some(why) = fail {
                    sink.lose(why);
                }
                let _ = delivered.send(());
            });
            Ok(Opened { keep: Box::new(feeder), rate: 48_000, device: "USB Mic".into() })
        })
    }

    #[test]
    fn a_take_whose_microphone_went_away_says_so_and_names_it() {
        let (tx, rx) = mpsc::channel();
        let heard = Arc::new(Mutex::new(Vec::<String>::new()));
        let told = heard.clone();
        let rec = Recording::start(fake_input(4_800, Some("Device disconnected"), tx), move |why| {
            lock(&told).push(why.to_string())
        })
        .unwrap();
        assert_eq!(rec.device, "USB Mic");
        rx.recv().unwrap();
        // Said as it happened, not only at the release.
        assert_eq!(lock(&heard).clone(), vec!["Device disconnected".to_string()]);
        let err = rec.finish().map(|c| c.samples.len()).unwrap_err();
        assert_eq!(err, lost_message("USB Mic", "Device disconnected"));
        assert!(err.contains("USB Mic") && err.contains("stopped during the take"), "{err}");
        assert!(!err.contains("no speech"), "{err}");
    }

    #[test]
    fn a_take_whose_microphone_stayed_is_returned_whole() {
        let (tx, rx) = mpsc::channel();
        let rec = Recording::start(fake_input(4_800, None, tx), |_| panic!("nothing was lost")).unwrap();
        rx.recv().unwrap();
        let take = rec.finish().unwrap();
        assert_eq!((take.samples.len(), take.rate), (4_800, 48_000));
    }

    #[test]
    fn a_microphone_that_cannot_open_is_an_error_at_the_press() {
        let rec = Recording::start(Box::new(|_| Err("microphone USB Mic: access denied".into())), |_| {});
        assert_eq!(rec.err(), Some("microphone USB Mic: access denied".to_string()));
    }

    #[test]
    fn only_errors_that_stop_the_stream_end_the_take() {
        use cpal::ErrorKind as K;
        for k in [K::DeviceNotAvailable, K::StreamInvalidated, K::HostUnavailable, K::PermissionDenied] {
            assert!(ends_take(k), "{k:?}");
        }
        for k in [K::DeviceChanged, K::Xrun, K::RealtimeDenied] {
            assert!(!ends_take(k), "{k:?}");
        }
        assert_eq!(
            lost_message("USB Mic", "Device disconnected."),
            "the microphone (USB Mic) stopped during the take: Device disconnected. Nothing was transcribed."
        );
    }

    /// A fixture WAV as 16 kHz mono, through the same mix and resample a live take gets.
    fn fixture(name: &str) -> Vec<f32> {
        let wav = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/voice").join(name);
        let mut reader = hound::WavReader::open(&wav).expect("fixture");
        let spec = reader.spec();
        let ints: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        let mut mono = vec![];
        mix_to_mono(&ints, spec.channels as usize, &mut mono);
        resample(&mono, spec.sample_rate, WHISPER_RATE)
    }

    /// Timings for the WAVs in `$MNEMO_VOICE_BENCH` (a directory), for a PR's before/after:
    /// `MNEMO_VOICE_BENCH=dir cargo test --lib voice::tests::bench -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn bench() {
        let dir = PathBuf::from(std::env::var_os("MNEMO_VOICE_BENCH").expect("MNEMO_VOICE_BENCH"));
        let path = match std::env::var_os(MODEL_ENV) {
            Some(p) => PathBuf::from(p),
            None => ensure_model(&std::env::temp_dir().join("mnemo-desktop-models"), |_, _| {}).expect("model"),
        };
        let t = std::time::Instant::now();
        let ctx = load_context(&path).expect("load");
        let loaded = t.elapsed().as_secs_f32();
        warm_up(&ctx).expect("warm up");
        eprintln!("load {loaded:.2}s, warm up {:.2}s", t.elapsed().as_secs_f32() - loaded);
        let mut names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "wav"))
            .collect();
        names.sort();
        for wav in names {
            let mut reader = hound::WavReader::open(&wav).expect("wav");
            let spec = reader.spec();
            let ints: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
            let mut mono = vec![];
            mix_to_mono(&ints, spec.channels as usize, &mut mono);
            let t = std::time::Instant::now();
            let audio = resample(&mono, spec.sample_rate, WHISPER_RATE);
            let rs = t.elapsed().as_secs_f32();
            for _ in 0..3 {
                let t = std::time::Instant::now();
                let text = transcribe(&ctx, &audio, Language::Auto).unwrap();
                eprintln!(
                    "{} {:.1}s audio: resample {rs:.2}s, transcribe {:.2}s: {text}",
                    wav.file_name().unwrap().to_string_lossy(),
                    audio.len() as f32 / WHISPER_RATE as f32,
                    t.elapsed().as_secs_f32()
                );
            }
        }
    }

    /// Audio → transcript on two 2 s synthesized takes, English at 44.1 kHz and Portuguese
    /// at 48 kHz. Downloads the model on first run into the system temp dir, not `$HOME`,
    /// which other tests repoint.
    #[test]
    fn transcribes_the_fixtures() {
        let path = match std::env::var_os(MODEL_ENV) {
            Some(p) => PathBuf::from(p),
            None => ensure_model(&std::env::temp_dir().join("mnemo-desktop-models"), |_, _| {}).expect("model"),
        };
        let ctx = load_context(&path).expect("load");
        warm_up(&ctx).expect("warm up");
        let cases = [
            ("hello.wav", Language::Auto, &["hello", "world"]),
            ("hello.wav", Language::En, &["hello", "world"]),
            ("ola.wav", Language::Auto, &["bom dia", "você"]),
            ("ola.wav", Language::Pt, &["bom dia", "você"]),
        ];
        for (name, language, words) in cases {
            let text = transcribe(&ctx, &fixture(name), language).unwrap().to_lowercase();
            assert!(words.iter().all(|w| text.contains(w)), "{name} {language:?}: {text:?}");
        }
        assert_eq!(transcribe(&ctx, &vec![0.0; 32_000], Language::Auto).unwrap(), "");
        // Above the silence gate, so whisper itself must hear nothing in a quiet room's hiss.
        let mut seed = 0x2545_f491u32;
        let hiss: Vec<f32> = (0..48_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.005
            })
            .collect();
        assert!(!is_silent(&hiss));
        assert_eq!(transcribe(&ctx, &hiss, Language::Auto).unwrap(), "");
    }
}

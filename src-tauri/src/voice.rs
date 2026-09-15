//! Push-to-talk dictation (issue #10). `voice_start` opens the default input device;
//! `voice_stop` closes it and transcribes the take locally with whisper.cpp. The model
//! downloads once, on first use, into `~/.mnemo-desktop/models/`; nothing else leaves the
//! machine. Where the transcript goes (caret, Monaco, PTY) is the frontend's call.

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

/// A poisoned lock here only means an earlier take panicked; the data is still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------------------
// Capture

pub struct Captured {
    /// Mono, at `rate`.
    pub samples: Vec<f32>,
    pub rate: u32,
}

/// A live take. The cpal stream is not `Send`, so it lives on its own thread until the
/// stop sender drops.
struct Recording {
    stop: mpsc::Sender<()>,
    thread: JoinHandle<Result<Captured, String>>,
}

impl Recording {
    fn start() -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (stop, stop_rx) = mpsc::channel::<()>();
        let thread = std::thread::Builder::new()
            .name("voice-capture".into())
            .spawn(move || {
                let buf = Arc::new(Mutex::new(Vec::new()));
                let (stream, rate) = match open_input(buf.clone()) {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e.clone()));
                        return Err(e);
                    }
                };
                let _ = ready_tx.send(Ok(()));
                // Returns once `stop` is dropped.
                let _ = stop_rx.recv();
                drop(stream);
                let samples = std::mem::take(&mut *lock(&buf));
                Ok(Captured { samples, rate })
            })
            .map_err(|e| format!("voice: {e}"))?;
        match ready_rx.recv() {
            Ok(Ok(())) => Ok(Self { stop, thread }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("voice: capture thread died".into()),
        }
    }

    fn finish(self) -> Result<Captured, String> {
        drop(self.stop);
        self.thread.join().map_err(|_| "voice: capture thread panicked".to_string())?
    }
}

fn open_input(buf: Arc<Mutex<Vec<f32>>>) -> Result<(cpal::Stream, u32), String> {
    let device = cpal::default_host().default_input_device().ok_or("no microphone found")?;
    let supported = device.default_input_config().map_err(|e| format!("microphone: {e}"))?;
    let rate = supported.sample_rate();
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        SampleFormat::I8 => build_input::<i8>(&device, config, buf),
        SampleFormat::I16 => build_input::<i16>(&device, config, buf),
        SampleFormat::I24 => build_input::<I24>(&device, config, buf),
        SampleFormat::I32 => build_input::<i32>(&device, config, buf),
        SampleFormat::U8 => build_input::<u8>(&device, config, buf),
        SampleFormat::U16 => build_input::<u16>(&device, config, buf),
        SampleFormat::U24 => build_input::<U24>(&device, config, buf),
        SampleFormat::U32 => build_input::<u32>(&device, config, buf),
        SampleFormat::F32 => build_input::<f32>(&device, config, buf),
        SampleFormat::F64 => build_input::<f64>(&device, config, buf),
        other => return Err(format!("microphone: unsupported sample format {other}")),
    }?;
    stream.play().map_err(|e| format!("microphone: {e}"))?;
    Ok((stream, rate))
}

fn build_input<T>(device: &cpal::Device, config: cpal::StreamConfig, buf: Arc<Mutex<Vec<f32>>>) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let cap = config.sample_rate as usize * MAX_SECONDS;
    device
        .build_input_stream::<T, _, _>(
            config,
            move |data: &[T], _| {
                let mut b = lock(&buf);
                if b.len() < cap {
                    mix_to_mono(data, channels, &mut b);
                }
            },
            |e| log::warn!("voice: input stream: {e}"),
            None,
        )
        .map_err(|e| format!("microphone: {e}"))
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

fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-9 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// True when no 30 ms window of 16 kHz audio rises above a quiet room. Whisper, fed
/// silence, invents a "Thank you." rather than returning nothing.
pub fn is_silent(audio: &[f32]) -> bool {
    const WINDOW: usize = WHISPER_RATE as usize * 3 / 100;
    const FLOOR: f32 = 0.005;
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
// Model and transcription

pub fn models_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("models")
}

/// Returns the model in `dir`, downloading it first if it is missing or truncated.
/// `progress(downloaded, total)` fires as bytes arrive.
pub fn ensure_model(dir: &Path, mut progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let path = dir.join(MODEL_FILE);
    if std::fs::metadata(&path).map(|m| m.len() == MODEL_BYTES).unwrap_or(false) {
        return Ok(path);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let part = dir.join(format!("{MODEL_FILE}.part"));
    let fail = |e: String| {
        let _ = std::fs::remove_file(&part);
        format!("model download: {e}")
    };
    let agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_body(Some(Duration::from_secs(60)))
        .build()
        .new_agent();
    let response = agent.get(MODEL_URL).call().map_err(|e| fail(e.to_string()))?;
    let mut body = response.into_body().into_with_config().limit(MODEL_BYTES + 1).reader();
    let mut file = std::fs::File::create(&part).map_err(|e| fail(e.to_string()))?;
    let mut chunk = vec![0u8; 1 << 16];
    let (mut done, mut reported) = (0u64, 0u64);
    progress(0, MODEL_BYTES);
    loop {
        let n = body.read(&mut chunk).map_err(|e| fail(e.to_string()))?;
        if n == 0 {
            break;
        }
        file.write_all(&chunk[..n]).map_err(|e| fail(e.to_string()))?;
        done += n as u64;
        if done - reported >= 1 << 20 {
            reported = done;
            progress(done, MODEL_BYTES);
        }
    }
    file.flush().map_err(|e| fail(e.to_string()))?;
    drop(file);
    if done != MODEL_BYTES {
        return Err(fail(format!("expected {MODEL_BYTES} bytes, got {done}")));
    }
    progress(done, MODEL_BYTES);
    std::fs::rename(&part, &path).map_err(|e| fail(e.to_string()))?;
    Ok(path)
}

pub fn load_context(path: &Path) -> Result<WhisperContext, String> {
    whisper_rs::install_logging_hooks();
    let p = path.to_str().ok_or("model path is not UTF-8")?;
    WhisperContext::new_with_params(p, WhisperContextParameters::default()).map_err(|e| format!("model {p}: {e}"))
}

/// Transcribes 16 kHz mono audio. Silence yields an empty string without running the model.
pub fn transcribe(ctx: &WhisperContext, audio: &[f32], language: Language) -> Result<String, String> {
    if is_silent(audio) {
        return Ok(String::new());
    }
    // whisper.cpp rejects takes under a second; a quarter second of tail also keeps it
    // from clipping the last word.
    let min = WHISPER_RATE as usize + WHISPER_RATE as usize / 4;
    let mut padded = audio.to_vec();
    padded.resize(padded.len().max(min) + WHISPER_RATE as usize / 4, 0.0);

    let mut state = ctx.create_state().map_err(|e| format!("whisper: {e}"))?;
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
    state.full(params, &padded).map_err(|e| format!("whisper: {e}"))?;

    let mut raw = String::new();
    for segment in state.as_iter() {
        raw.push_str(&segment.to_str_lossy().map_err(|e| format!("whisper: {e}"))?);
        raw.push(' ');
    }
    Ok(clean_transcript(&raw))
}

#[derive(Clone, Serialize)]
struct Progress {
    downloaded: u64,
    total: u64,
}

fn model(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
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
    *slot = Some(ctx.clone());
    Ok(ctx)
}

// ---------------------------------------------------------------------------------------
// Commands

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("voice: {e}"))?
}

/// Opens the microphone. Also starts fetching and loading the model in the background, so
/// the first take's download runs while the user is still talking.
#[tauri::command]
pub async fn voice_start(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let state = app.state::<VoiceState>();
        {
            let mut slot = lock(&state.recording);
            if slot.is_some() {
                return Err("already recording".into());
            }
            *slot = Some(Recording::start()?);
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
        Ok(())
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

    #[test]
    fn silence_is_detected_and_speech_level_is_not() {
        assert!(is_silent(&vec![0.0; 16_000]));
        assert!(is_silent(&tone(200.0, WHISPER_RATE, 1.0, 0.002)));
        assert!(!is_silent(&tone(200.0, WHISPER_RATE, 1.0, 0.05)));
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
    }
}

//! Jarvis's voice (#506): a global push-to-talk key, whisper.cpp in Portuguese, Piper out.
//!
//! - **The key** is the config's `voice.key` (`DEFAULT_KEY` when it names none), registered
//!   system-wide through the global-shortcut plugin, so it works with the app unfocused or
//!   minimized. It is registered only once `jarvis.json` exists, so an app with no Jarvis set up
//!   takes no key from the system; `"key": null` turns it off. It is never dictation's key, and
//!   nothing it hears is typed anywhere: down opens the microphone (`listening`), up transcribes
//!   (`transcribing`) and emits one `jarvis://heard` with what was said. A take with nothing said
//!   in it emits none.
//! - **Speech in** is dictation's capture and whisper.cpp (`voice.rs`), in Portuguese, with a
//!   model of Jarvis's own (`hear.rs`); `voice.whisper` points at one already on disk.
//! - **Speech out** is Piper with a PT-BR voice (`speech.rs`), queued, and silent while the key
//!   is held; `voice.piper` points at a Piper of one's own, which is how it runs off Windows.
//! - `jarvis://voice` says `idle`, `listening`, `transcribing` or `speaking` as it changes, the
//!   first of those that is true, in that order of precedence from `listening` down.
//!   `jarvis://voice-error` says what went wrong where no command was there to return it.
//!
//! Files are fetched at launch once the key is on, else on first use, each checked against its
//! sha256 (`files.rs`).

mod files;
mod hear;
mod speech;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::Shortcut;
use whisper_rs::WhisperContext;

use crate::voice::{self, lock, Captured, Recording};

/// The push-to-talk key when the config names none.
pub const DEFAULT_KEY: &str = "CommandOrControl+Shift+Space";
/// Dictation's toggle (`dictation.toggle` in `src/actions/chords.ts`), which Jarvis's key may
/// never be.
const DICTATION_KEY: &str = "CommandOrControl+E";

/// `jarvis://voice`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoicePhase {
    Idle,
    Listening,
    Transcribing,
    Speaking,
}

/// `jarvis://heard`: a take, once the key is released.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Heard {
    pub text: String,
    /// The decoder's own confidence, 0–1.
    pub confidence: f32,
    /// The title of the window in front when the key went down.
    pub window: Option<String>,
}

/// What the voice tells the panel.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Phase(VoicePhase),
    Heard(Heard),
    Error(String),
}

impl Event {
    pub fn name(&self) -> &'static str {
        match self {
            Event::Phase(_) => "jarvis://voice",
            Event::Heard(_) => "jarvis://heard",
            Event::Error(_) => "jarvis://voice-error",
        }
    }
}

// ---------------------------------------------------------------------------------------
// Config

/// The config's `voice` section.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Config {
    /// None: no key is registered.
    pub key: Option<String>,
    pub piper: Option<PathBuf>,
    pub whisper: Option<PathBuf>,
}

/// Reads `voice` from `jarvis.json`'s parsed `section`. `exists` is whether there is a
/// `jarvis.json` at all: with none, no key is taken.
pub fn parse_config(section: &serde_json::Value, exists: bool, home: &Path) -> Result<Config, String> {
    let path = |k: &str| -> Result<Option<PathBuf>, String> {
        match section.get(k) {
            None | Some(serde_json::Value::Null) => Ok(None),
            Some(serde_json::Value::String(s)) if !s.trim().is_empty() => Ok(Some(expand(s.trim(), home))),
            Some(other) => Err(format!("voice.{k} in jarvis.json is {other}, not a path")),
        }
    };
    let key = match section.get("key") {
        _ if !exists => None,
        None => Some(DEFAULT_KEY.to_string()),
        Some(serde_json::Value::Null) | Some(serde_json::Value::Bool(false)) => None,
        Some(serde_json::Value::String(s)) if s.trim().is_empty() => None,
        Some(serde_json::Value::String(s)) => {
            shortcut(s.trim())?;
            Some(s.trim().to_string())
        }
        Some(other) => return Err(format!("voice.key in jarvis.json is {other}, not a key such as {DEFAULT_KEY:?}")),
    };
    Ok(Config { key, piper: path("piper")?, whisper: path("whisper")? })
}

/// `key` as the plugin reads it, refused when it is dictation's, however it is spelled.
pub fn shortcut(key: &str) -> Result<Shortcut, String> {
    let parsed: Shortcut = key.parse().map_err(|e| format!("voice.key {key:?} in jarvis.json: {e}"))?;
    let dictation: Shortcut = DICTATION_KEY.parse().map_err(|e| format!("{e}"))?;
    if parsed == dictation {
        return Err(format!("voice.key {key:?} in jarvis.json is dictation's key: Jarvis's must be another"));
    }
    Ok(parsed)
}

/// `~/x` or `~\x` under `home`; anything else as written.
fn expand(p: &str, home: &Path) -> PathBuf {
    match p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        Some(rest) => home.join(rest),
        None if p == "~" => home.to_path_buf(),
        None => PathBuf::from(p),
    }
}

// ---------------------------------------------------------------------------------------
// The voice

/// What the voice runs on: whisper and Piper here, stand-ins in tests.
pub trait Backend: Send + Sync + 'static {
    /// Called as the key goes down, on its own thread: gets the model ready while the maintainer
    /// talks.
    fn warm(&self);
    /// The text of a take and the decoder's confidence; empty when nothing was said.
    fn hear(&self, take: &Captured) -> Result<(String, f32), String>;
    /// After a take, heard or not (the microphone may have failed before anything was): what
    /// `warm` set up for it may go.
    fn done(&self) {}
    /// At launch, once the key is on, on its own thread: fetches what the first take and the
    /// first `say` would otherwise wait on. Nothing is loaded.
    fn prefetch(&self) {}
    /// A speaker, started. Nothing plays while `held` is true.
    fn speaker(
        &self,
        held: Arc<AtomicBool>,
        on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<speech::Speaker, String>;
}

/// The phase, from what is going on: the key held comes first, then a take being transcribed,
/// then speech.
pub fn phase_of(held: bool, transcribing: bool, speaking: bool) -> VoicePhase {
    if held {
        VoicePhase::Listening
    } else if transcribing {
        VoicePhase::Transcribing
    } else if speaking {
        VoicePhase::Speaking
    } else {
        VoicePhase::Idle
    }
}

#[derive(Default)]
struct Flags {
    held: bool,
    /// Takes released and not yet heard: a press can come before the last one is done.
    transcribing: usize,
    speaking: bool,
    said: Option<VoicePhase>,
}

type Emit = Arc<dyn Fn(Event) + Send + Sync>;

struct Phases {
    flags: Mutex<Flags>,
    emit: Emit,
}

impl Phases {
    fn update(&self, change: impl FnOnce(&mut Flags)) {
        let mut f = lock(&self.flags);
        change(&mut f);
        let now = phase_of(f.held, f.transcribing > 0, f.speaking);
        if f.said.unwrap_or(VoicePhase::Idle) != now {
            f.said = Some(now);
            (self.emit)(Event::Phase(now));
        }
    }
}

/// A take under way, and the window that was in front when it began.
pub struct Take {
    recording: Recording,
    window: Option<String>,
}

pub struct JarvisVoice {
    backend: Box<dyn Backend>,
    phases: Arc<Phases>,
    take: Mutex<Option<Take>>,
    /// The key is down; the speaker reads it.
    held: Arc<AtomicBool>,
    speaker: Mutex<Option<Arc<speech::Speaker>>>,
    /// Counts `hush`es, so a `say` that was waiting for its speaker to be set up when one came
    /// says nothing.
    hushes: AtomicU64,
}

impl JarvisVoice {
    pub fn new(backend: Box<dyn Backend>, emit: Emit) -> Self {
        JarvisVoice {
            backend,
            phases: Arc::new(Phases { flags: Mutex::default(), emit }),
            take: Mutex::new(None),
            held: Arc::default(),
            speaker: Mutex::new(None),
            hushes: AtomicU64::new(0),
        }
    }

    fn emit(&self, e: Event) {
        (self.phases.emit)(e)
    }

    /// The key went down: the microphone opens, and nothing is said until it is up. A second
    /// press while one is held does nothing.
    pub fn press(self: &Arc<Self>, input: voice::Input, window: Option<String>) -> Result<(), String> {
        let mut take = lock(&self.take);
        if take.is_some() {
            return Ok(());
        }
        self.held.store(true, Ordering::SeqCst);
        self.phases.update(|f| f.held = true);
        let me = self.clone();
        let recording = Recording::start(input, move |why| me.emit(Event::Error(voice::lost_message("microphone", why))));
        match recording {
            Ok(recording) => {
                *take = Some(Take { recording, window });
                let me = self.clone();
                std::thread::spawn(move || me.backend.warm());
                Ok(())
            }
            Err(e) => {
                self.held.store(false, Ordering::SeqCst);
                self.phases.update(|f| f.held = false);
                Err(e)
            }
        }
    }

    /// The key came up: the take, to hand to `finish`, and the speaker may go on.
    pub fn release(&self) -> Option<Take> {
        let take = lock(&self.take).take();
        self.held.store(false, Ordering::SeqCst);
        let taking = take.is_some();
        self.phases.update(|f| {
            f.held = false;
            f.transcribing += usize::from(taking);
        });
        take
    }

    /// Transcribes a released take and says what was heard, if anything was.
    pub fn finish(&self, take: Take) {
        let released = std::time::Instant::now();
        let heard = take.recording.finish().and_then(|c| self.backend.hear(&c));
        self.backend.done();
        match heard {
            Ok((text, confidence)) if !text.is_empty() => {
                // The latency, never the words: the log is not Jarvis's conversation log.
                log::info!("jarvis voice: heard {} words in {} ms, confidence {confidence:.2}", text.split_whitespace().count(), released.elapsed().as_millis());
                self.emit(Event::Heard(Heard { text, confidence: confidence.clamp(0.0, 1.0), window: take.window }))
            }
            Ok(_) => log::info!("jarvis voice: nothing said in the take ({} ms)", released.elapsed().as_millis()),
            Err(e) => {
                log::warn!("jarvis voice: {e}");
                self.emit(Event::Error(e));
            }
        }
        self.phases.update(|f| f.transcribing = f.transcribing.saturating_sub(1));
    }

    /// Fetches what the voice needs ahead of its first use (`Backend::prefetch`).
    pub fn prefetch(&self) {
        self.backend.prefetch()
    }

    /// Queues `text` to be said. The first call sets the speaker up, fetching what it needs.
    pub fn say(&self, text: &str) -> Result<(), String> {
        let hushes = self.hushes.load(Ordering::SeqCst);
        let speaker = self.speaker()?;
        if self.hushes.load(Ordering::SeqCst) == hushes {
            speaker.say(text);
        }
        Ok(())
    }

    /// Stops speaking and drops what is queued.
    pub fn hush(&self) {
        self.hushes.fetch_add(1, Ordering::SeqCst);
        if let Ok(Some(s)) = self.speaker.try_lock().as_deref() {
            s.hush();
        }
    }

    fn speaker(&self) -> Result<Arc<speech::Speaker>, String> {
        let mut slot = lock(&self.speaker);
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
        let phases = self.phases.clone();
        let errors = self.phases.clone();
        let s = Arc::new(self.backend.speaker(
            self.held.clone(),
            Arc::new(move |speaking| phases.update(|f| f.speaking = speaking)),
            Arc::new(move |e| {
                log::warn!("jarvis voice: {e}");
                (errors.emit)(Event::Error(e))
            }),
        )?);
        *slot = Some(s.clone());
        Ok(s)
    }
}

// ---------------------------------------------------------------------------------------
// Whisper and Piper

/// The voice on this machine.
pub struct Local {
    config: Config,
    model: Mutex<Option<Arc<WhisperContext>>>,
    /// Whisper's prompt (`hear::prompt`), made again from the projects at each press.
    prompt: Mutex<String>,
    /// Held while whisper's model is fetched, and while Piper's files are: dictation's `download`
    /// resumes a `.part` file, and the launch's `prefetch` and a first take or `say` must not
    /// write the same one at once.
    fetching_model: Mutex<()>,
    fetching_piper: Mutex<()>,
}

impl Local {
    pub fn new(config: Config) -> Self {
        Local {
            config,
            model: Mutex::new(None),
            prompt: Mutex::new(hear::prompt(&[])),
            fetching_model: Mutex::new(()),
            fetching_piper: Mutex::new(()),
        }
    }

    fn fetch_model(&self) -> Result<PathBuf, String> {
        let _one = lock(&self.fetching_model);
        hear::fetch(self.config.whisper.clone())
    }

    fn fetch_piper(&self) -> Result<speech::PiperFiles, String> {
        let _one = lock(&self.fetching_piper);
        speech::ensure_files(self.config.piper.clone())
    }

    fn model(&self) -> Result<Arc<WhisperContext>, String> {
        // Held across the load, so a press's warm-up and the release's take load it once.
        let mut slot = lock(&self.model);
        if let Some(m) = slot.as_ref() {
            return Ok(m.clone());
        }
        let started = std::time::Instant::now();
        let m = Arc::new(voice::load_context(&self.fetch_model()?)?);
        log::info!("jarvis voice: model ready in {:.1}s", started.elapsed().as_secs_f32());
        *slot = Some(m.clone());
        Ok(m)
    }
}

impl Backend for Local {
    fn warm(&self) {
        app_full_speed(true);
        *lock(&self.prompt) = hear::prompt(&crate::jarvis::projects());
        if let Err(e) = self.model() {
            log::warn!("jarvis voice: preparing the model: {e}");
        }
    }

    fn hear(&self, take: &Captured) -> Result<(String, f32), String> {
        let audio = hear::to_whisper(&take.samples, take.rate);
        if voice::is_silent(&audio) {
            return Ok((String::new(), 0.0));
        }
        let model = self.model()?;
        let prompt = lock(&self.prompt).clone();
        hear::hear(&model, &audio, &prompt)
    }

    fn done(&self) {
        app_full_speed(false);
    }

    fn prefetch(&self) {
        let started = std::time::Instant::now();
        // What fails here fails again, said to the panel, when the key or a reply needs the file.
        let errors: Vec<String> = [self.fetch_model().map(drop), self.fetch_piper().map(drop)].into_iter().filter_map(Result::err).collect();
        if errors.is_empty() {
            log::info!("jarvis voice: its files are ready ({:.1}s)", started.elapsed().as_secs_f32());
        }
        for e in errors {
            log::warn!("jarvis voice: fetching its files: {e}");
        }
    }

    fn speaker(
        &self,
        held: Arc<AtomicBool>,
        on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<speech::Speaker, String> {
        let files = self.fetch_piper()?;
        let piper = speech::Piper::new(&files);
        speech::Speaker::start(files.rate, held, piper.into_synth(), speech::default_output(), on_speaking, on_error)
    }
}

/// The title of the window in front, as Windows has it.
#[cfg(windows)]
pub fn foreground_title() -> Option<String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW};
    // SAFETY: plain reads of the foreground window's title into a buffer sized for it.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        (!title.trim().is_empty()).then_some(title)
    }
}

#[cfg(not(windows))]
pub fn foreground_title() -> Option<String> {
    None
}

/// Opts `process` out of Windows 11's power throttling (EcoQoS), which runs a process with no
/// window in front, such as Piper or this app minimized, on the efficiency cores at a low clock.
/// The maintainer is waiting on these: measured, Piper's first clause took 821 ms throttled and
/// 233 ms not. Windows before 10 1709 has no such throttling and refuses the call; that is fine.
#[cfg(windows)]
pub fn full_speed(process: std::os::windows::io::RawHandle) {
    throttling(process, PROCESS_POWER_THROTTLING_EXECUTION_SPEED)
}

#[cfg(windows)]
use windows_sys::Win32::System::Threading::PROCESS_POWER_THROTTLING_EXECUTION_SPEED;

/// This app at full speed while a take is under way (`true`), and back to Windows's own choice
/// after it (`false`): the app is often minimized when the key is used.
#[cfg(windows)]
fn app_full_speed(on: bool) {
    // SAFETY: the pseudo-handle of this process, always valid.
    let me = unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() };
    throttling(me as _, if on { PROCESS_POWER_THROTTLING_EXECUTION_SPEED } else { 0 })
}

#[cfg(not(windows))]
fn app_full_speed(_on: bool) {}

/// Takes the execution-speed throttling of `process` into its own hands (`control` set: never
/// throttled), or gives it back to Windows (`control` 0).
#[cfg(windows)]
fn throttling(process: std::os::windows::io::RawHandle, control: u32) {
    use windows_sys::Win32::System::Threading::{
        ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_STATE,
    };
    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: control,
        // The bit clear: not throttled, for what `control` takes over.
        StateMask: 0,
    };
    // SAFETY: a live process handle and a state of the size the call is told.
    unsafe {
        SetProcessInformation(
            process as _,
            ProcessPowerThrottling,
            &state as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
    }
}

// ---------------------------------------------------------------------------------------
// The app

/// At launch: the voice's state, and the key once `jarvis.json` exists.
pub fn start(app: &AppHandle) {
    let emitter = app.clone();
    let emit: Emit = Arc::new(move |e: Event| {
        let name = e.name();
        let _ = match e {
            Event::Phase(p) => emitter.emit(name, p),
            Event::Heard(h) => emitter.emit(name, h),
            Event::Error(m) => emitter.emit(name, m),
        };
    });
    let exists = crate::jarvis::config_path().is_file();
    let config = crate::jarvis::section("voice").and_then(|s| parse_config(&s, exists, &crate::app_dir::home()));
    let config = config.unwrap_or_else(|e| {
        log::warn!("jarvis voice: {e}; the push-to-talk key is off");
        Config::default()
    });
    let key = config.key.clone();
    let voice = Arc::new(JarvisVoice::new(Box::new(Local::new(config)), emit));
    app.manage(voice.clone());
    if let Some(key) = key {
        match listen(app, &key, voice.clone()) {
            Ok(()) => {
                log::info!("jarvis voice: push-to-talk on {key}");
                // The first take and the first reply would otherwise wait on some 280 MB.
                std::thread::spawn(move || voice.prefetch());
            }
            Err(e) => log::warn!("jarvis voice: the push-to-talk key {key}: {e}"),
        }
    }
}

/// Registers `key`: down and up go, in order, to one thread that runs the take.
fn listen(app: &AppHandle, key: &str, voice: Arc<JarvisVoice>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let key = shortcut(key)?;
    app.plugin(tauri_plugin_global_shortcut::Builder::new().build()).map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    std::thread::Builder::new()
        .name("jarvis-key".into())
        .spawn(move || {
            for down in rx {
                if down {
                    // Read before anything else: the window the maintainer is looking at.
                    let window = foreground_title();
                    if let Err(e) = voice.press(Box::new(voice::default_input), window) {
                        log::warn!("jarvis voice: {e}");
                        voice.emit(Event::Error(e));
                    }
                } else if let Some(take) = voice.release() {
                    let voice = voice.clone();
                    std::thread::spawn(move || voice.finish(take));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    app.global_shortcut()
        .on_shortcut(key, move |_app, _key, event| {
            let _ = tx.send(event.state() == ShortcutState::Pressed);
        })
        .map_err(|e| e.to_string())
}

/// `jarvis_say(text: String) -> Result<(), String>`: queues `text` to be spoken in PT-BR, after
/// what is already queued, and never while the key is held. Returns once it is queued; the first
/// call fetches Piper and its voice.
#[tauri::command]
pub async fn jarvis_say(voice: State<'_, Arc<JarvisVoice>>, text: String) -> Result<(), String> {
    let voice = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || voice.say(&text)).await.map_err(|e| format!("jarvis voice: {e}"))?
}

/// `jarvis_hush() -> ()`: stops speaking and drops the queue.
#[tauri::command]
pub fn jarvis_hush(voice: State<'_, Arc<JarvisVoice>>) {
    voice.hush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn the_key_is_the_configs_or_the_default_and_none_without_a_config() {
        let home = Path::new("/home/you");
        assert_eq!(parse_config(&json!(null), true, home).unwrap().key.as_deref(), Some(DEFAULT_KEY));
        assert_eq!(parse_config(&json!({}), true, home).unwrap().key.as_deref(), Some(DEFAULT_KEY));
        assert_eq!(parse_config(&json!({ "key": "Alt+F9" }), true, home).unwrap().key.as_deref(), Some("Alt+F9"));
        assert_eq!(parse_config(&json!({ "key": null }), true, home).unwrap().key, None);
        assert_eq!(parse_config(&json!({ "key": "" }), true, home).unwrap().key, None);
        // No jarvis.json: Jarvis is not set up, and the system keeps its keys.
        assert_eq!(parse_config(&json!(null), false, home).unwrap().key, None);
        let c = parse_config(&json!({ "piper": "~/piper/piper", "whisper": "/m/ggml.bin" }), true, home).unwrap();
        assert_eq!(c.piper, Some(home.join("piper/piper")));
        assert_eq!(c.whisper, Some(PathBuf::from("/m/ggml.bin")));
        assert!(parse_config(&json!({ "key": 3 }), true, home).is_err());
        assert!(parse_config(&json!({ "key": "Ctrl+Nonsense" }), true, home).is_err());
        assert!(parse_config(&json!({ "piper": 1 }), true, home).is_err());
    }

    #[test]
    fn the_key_routes_to_jarvis_never_to_dictation() {
        // Dictation's toggle, however it is spelled, is refused as Jarvis's key.
        for k in ["CommandOrControl+E", "CmdOrCtrl+E", "CmdOrControl+e"] {
            let err = shortcut(k).unwrap_err();
            assert!(err.contains("dictation"), "{k}: {err}");
        }
        assert!(shortcut(DEFAULT_KEY).is_ok());

        // A press and a release: a take for Jarvis, said on Jarvis's events only, carrying the
        // window that was in front at the press.
        let (voice, events, _) = fake_voice(Ok(("abre o PR 42".into(), 0.8)));
        voice.press(mic(), Some("app.rs - mnemo-desktop - Visual Studio Code".into())).unwrap();
        let take = voice.release().expect("a take");
        voice.finish(take);
        let got = lock(&events).clone();
        assert_eq!(
            got,
            vec![
                Event::Phase(VoicePhase::Listening),
                Event::Phase(VoicePhase::Transcribing),
                Event::Heard(Heard {
                    text: "abre o PR 42".into(),
                    confidence: 0.8,
                    window: Some("app.rs - mnemo-desktop - Visual Studio Code".into()),
                }),
                Event::Phase(VoicePhase::Idle),
            ]
        );
        assert!(got.iter().all(|e| e.name().starts_with("jarvis://")), "nothing for dictation's voice://");
        assert_eq!(serde_json::to_value(&got[2..3].iter().map(|e| e.name()).collect::<Vec<_>>()).unwrap(), json!(["jarvis://heard"]));
    }

    #[test]
    fn a_held_key_pressed_again_is_one_take_and_nothing_said_is_no_heard() {
        let (voice, events, _) = fake_voice(Ok((String::new(), 0.0)));
        voice.press(mic(), None).unwrap();
        voice.press(mic(), None).unwrap();
        voice.finish(voice.release().unwrap());
        assert!(voice.release().is_none());
        assert_eq!(
            lock(&events).clone(),
            vec![Event::Phase(VoicePhase::Listening), Event::Phase(VoicePhase::Transcribing), Event::Phase(VoicePhase::Idle)]
        );
    }

    #[test]
    fn a_failed_take_is_an_error_and_the_phase_goes_back_to_idle() {
        let (voice, events, _) = fake_voice(Err("whisper: out of memory".into()));
        voice.press(mic(), None).unwrap();
        voice.finish(voice.release().unwrap());
        assert_eq!(lock(&events)[2], Event::Error("whisper: out of memory".into()));
        assert_eq!(lock(&events).last(), Some(&Event::Phase(VoicePhase::Idle)));

        let (voice, events, _) = fake_voice(Ok(("x".into(), 1.0)));
        let err = voice.press(Box::new(|_| Err("no microphone found".into())), None).unwrap_err();
        assert_eq!(err, "no microphone found");
        assert!(voice.release().is_none());
        assert_eq!(lock(&events).clone(), vec![Event::Phase(VoicePhase::Listening), Event::Phase(VoicePhase::Idle)]);
    }

    #[test]
    fn speech_waits_while_the_key_is_held_and_follows_its_release() {
        let (voice, events, played) = fake_voice(Ok(("e o CI?".into(), 0.9)));
        voice.press(mic(), None).unwrap();
        voice.say("o PR passou").unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert!(lock(&played).is_empty(), "spoke over the maintainer");
        assert_eq!(lock(&events).clone(), vec![Event::Phase(VoicePhase::Listening)], "listening outranks speaking");
        let take = voice.release().unwrap();
        voice.finish(take);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while lock(&played).len() < 100 || lock(&events).last() != Some(&Event::Phase(VoicePhase::Idle)) {
            assert!(std::time::Instant::now() < deadline, "{:?}", lock(&events));
            std::thread::sleep(Duration::from_millis(5));
        }
        let phases: Vec<_> = lock(&events).iter().filter(|e| matches!(e, Event::Phase(_))).cloned().collect();
        assert_eq!(phases.first(), Some(&Event::Phase(VoicePhase::Listening)));
        assert!(phases.contains(&Event::Phase(VoicePhase::Speaking)), "{phases:?}");

        // Hush drops what is waiting.
        voice.press(mic(), None).unwrap();
        voice.say("isso não").unwrap();
        voice.hush();
        voice.finish(voice.release().unwrap());
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(lock(&played).len(), 100);
    }

    #[test]
    fn phases_rank_listening_then_transcribing_then_speaking() {
        assert_eq!(phase_of(true, true, true), VoicePhase::Listening);
        assert_eq!(phase_of(false, true, true), VoicePhase::Transcribing);
        assert_eq!(phase_of(false, false, true), VoicePhase::Speaking);
        assert_eq!(phase_of(false, false, false), VoicePhase::Idle);
        assert_eq!(serde_json::to_value(VoicePhase::Transcribing).unwrap(), json!("transcribing"));
        let h = Heard { text: "oi".into(), confidence: 0.5, window: None };
        assert_eq!(serde_json::to_value(h).unwrap(), json!({ "text": "oi", "confidence": 0.5, "window": null }));
    }

    #[test]
    fn a_take_ends_with_done_even_when_the_microphone_was_lost() {
        use std::sync::atomic::AtomicUsize;
        struct Counting(Arc<AtomicUsize>);
        impl Backend for Counting {
            fn warm(&self) {}
            fn hear(&self, _: &Captured) -> Result<(String, f32), String> {
                Ok((String::new(), 0.0))
            }
            fn done(&self) {
                self.0.fetch_add(1, Ordering::SeqCst);
            }
            fn speaker(
                &self,
                _: Arc<AtomicBool>,
                _: Arc<dyn Fn(bool) + Send + Sync>,
                _: Arc<dyn Fn(String) + Send + Sync>,
            ) -> Result<speech::Speaker, String> {
                Err("no speaker".into())
            }
        }
        let done = Arc::new(AtomicUsize::new(0));
        let events = Arc::new(Mutex::new(vec![]));
        let into = events.clone();
        let voice = Arc::new(JarvisVoice::new(Box::new(Counting(done.clone())), Arc::new(move |e| lock(&into).push(e))));
        // A microphone unplugged partway: the take is an error and is never heard.
        let unplugged: voice::Input = Box::new(|sink: voice::Sink| {
            sink.push(&vec![0.1f32; 4_800], 1, usize::MAX);
            sink.lose("device unplugged");
            Ok(voice::Opened { keep: Box::new(()), rate: 48_000, device: "test mic".into() })
        });
        voice.press(unplugged, None).unwrap();
        voice.finish(voice.release().unwrap());
        assert_eq!(done.load(Ordering::SeqCst), 1, "what warm set up for the take is let go");
        assert!(lock(&events).iter().any(|e| matches!(e, Event::Error(_))), "{:?}", lock(&events));
        voice.press(mic(), None).unwrap();
        voice.finish(voice.release().unwrap());
        assert_eq!(done.load(Ordering::SeqCst), 2);
    }

    /// The latencies the PR reports, on this machine's speaker with the real files (fetched into
    /// `~/.mnemo-desktop/models/` when missing):
    /// `cargo test --release --lib jarvis_voice::tests::live -- --ignored --nocapture`.
    /// Speech out: from `say` to the first sample on the device. Speech in: from the key's release
    /// to the text, over takes Piper speaks (no recording), with the model warmed by the press.
    #[test]
    #[ignore]
    fn live() {
        let local = Local::new(Config::default());
        let t = std::time::Instant::now();
        let speaker = local.speaker(Arc::default(), Arc::new(|_| {}), Arc::new(|e| panic!("{e}"))).unwrap();
        eprintln!("speaker ready in {:.2}s", t.elapsed().as_secs_f32());
        std::thread::sleep(Duration::from_secs(1));
        for text in ["Oi, eu sou o James.", "O PR quarenta e dois passou em todas as verificações, e o CI do desktop está verde."] {
            speaker.say(text);
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let latency = loop {
                if let Some(l) = speaker.take_latency() {
                    break l;
                }
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(1));
            };
            eprintln!("say → first sound: {} ms ({text})", latency.as_millis());
            std::thread::sleep(Duration::from_secs(6));
        }

        let files = speech::ensure_files(None).unwrap();
        let mut piper = speech::Piper::new(&files);
        let t = std::time::Instant::now();
        local.warm();
        eprintln!("whisper ({}) loaded in {:.2}s", hear::MODEL.file, t.elapsed().as_secs_f32());
        for text in ["James, quais PRs estão abertos no desktop?", "os checks do PR 42 do mnemo passaram?", "abre o VS Code no mnemo-src"] {
            let mut samples = vec![];
            piper.say(text, &mut |p| {
                samples.extend_from_slice(p);
                true
            })
            .unwrap();
            let t = std::time::Instant::now();
            let (heard, confidence) = local.hear(&Captured { samples, rate: files.rate }).unwrap();
            eprintln!("release → heard: {} ms, {confidence:.2}: {heard} ({text})", t.elapsed().as_millis());
        }
    }

    /// A microphone that gives a tenth of a second of tone.
    fn mic() -> voice::Input {
        Box::new(|sink: voice::Sink| {
            sink.push(&vec![0.1f32; 4_800], 1, usize::MAX);
            Ok(voice::Opened { keep: Box::new(()), rate: 48_000, device: "test mic".into() })
        })
    }

    struct Fake {
        heard: Result<(String, f32), String>,
        played: Arc<Mutex<Vec<f32>>>,
    }

    impl Backend for Fake {
        fn warm(&self) {}
        fn hear(&self, take: &Captured) -> Result<(String, f32), String> {
            assert_eq!(take.samples.len(), 4_800);
            self.heard.clone()
        }
        fn speaker(
            &self,
            held: Arc<AtomicBool>,
            on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
            on_error: Arc<dyn Fn(String) + Send + Sync>,
        ) -> Result<speech::Speaker, String> {
            speech::Speaker::start(22_050, held, speech::tests::fake_synth(), speech::tests::fake_output(self.played.clone()), on_speaking, on_error)
        }
    }

    fn fake_voice(heard: Result<(String, f32), String>) -> (Arc<JarvisVoice>, Arc<Mutex<Vec<Event>>>, Arc<Mutex<Vec<f32>>>) {
        let events = Arc::new(Mutex::new(vec![]));
        let into = events.clone();
        let played = Arc::new(Mutex::new(vec![]));
        let voice = JarvisVoice::new(Box::new(Fake { heard, played: played.clone() }), Arc::new(move |e| lock(&into).push(e)));
        (Arc::new(voice), events, played)
    }
}

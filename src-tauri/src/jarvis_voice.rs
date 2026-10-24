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
//! - **Hands-free** (`wake.rs`): with the config's `voice.wake` set, or once `jarvis_listen` turns
//!   it on, the microphone stays open and an utterance that begins with James's name is a take
//!   (`via: wake`), without the name; after James has spoken, whatever is said within
//!   `voice.wake.followMs` is one too (`via: follow`), and a goodbye there ends the conversation.
//!   While James speaks only his name counts, and it hushes him. The key and dictation win over
//!   it: while either listens, hands-free takes nothing.
//! - `jarvis://voice` says `idle`, `listening`, `transcribing`, `speaking` or `waiting` (the
//!   follow-up window) as it changes, the first of those that is true, in that order of precedence
//!   from `listening` down. `jarvis://level` carries the microphone's and the speaker's loudness,
//!   0–1, 20 times a second while it is not `idle`. `jarvis://voice-error` says what went wrong
//!   where no command was there to return it.
//!
//! Files are fetched at launch once the key or hands-free is on, else on first use, each checked
//! against its sha256 (`files.rs`).

mod files;
mod hear;
mod speech;
mod wake;
#[cfg(test)]
mod wake_tests;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, OnceLock, Weak};
use std::time::{Duration, Instant};

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
    /// James has answered and the follow-up window is open.
    Waiting,
}

/// How a take began: the push-to-talk key, James's name said hands-free, or the follow-up window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HeardVia {
    Key,
    Wake,
    Follow,
}

/// `jarvis://heard`: a take, once it ended.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Heard {
    /// What was said; a hands-free take comes without the name it began with.
    pub text: String,
    /// The decoder's own confidence, 0–1.
    pub confidence: f32,
    /// The title of the window in front when the take began.
    pub window: Option<String>,
    pub via: HeardVia,
}

/// `jarvis://level`: how loud the microphone and the speaker are, each 0–1.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct VoiceLevel {
    pub mic: f32,
    pub out: f32,
}

/// What the voice tells the panel.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    Phase(VoicePhase),
    Heard(Heard),
    Error(String),
    Level(VoiceLevel),
}

impl Event {
    pub fn name(&self) -> &'static str {
        match self {
            Event::Phase(_) => "jarvis://voice",
            Event::Heard(_) => "jarvis://heard",
            Event::Error(_) => "jarvis://voice-error",
            Event::Level(_) => "jarvis://level",
        }
    }
}

// ---------------------------------------------------------------------------------------
// Config

/// The follow-up window when the config's `voice.wake` names none.
pub const DEFAULT_FOLLOW_MS: u64 = 8_000;

/// The config's `voice` section.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Config {
    /// None: no key is registered.
    pub key: Option<String>,
    pub piper: Option<PathBuf>,
    pub whisper: Option<PathBuf>,
    /// `voice.wake`: hands-free on at launch, with this follow-up window in ms. None: off until
    /// `jarvis_listen` turns it on.
    pub wake: Option<u64>,
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
    let wake = match section.get("wake") {
        _ if !exists => None,
        None | Some(serde_json::Value::Null) | Some(serde_json::Value::Bool(false)) => None,
        Some(serde_json::Value::Bool(true)) => Some(DEFAULT_FOLLOW_MS),
        Some(serde_json::Value::Object(o)) => match o.get("followMs") {
            None | Some(serde_json::Value::Null) => Some(DEFAULT_FOLLOW_MS),
            Some(ms) => Some(ms.as_u64().filter(|&ms| ms > 0).ok_or_else(|| format!("voice.wake.followMs in jarvis.json is {ms}, not a number of ms"))?),
        },
        Some(other) => return Err(format!("voice.wake in jarvis.json is {other}, not true or {{ \"followMs\": {DEFAULT_FOLLOW_MS} }}")),
    };
    Ok(Config { key, piper: path("piper")?, whisper: path("whisper")?, wake })
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
    /// `hear`, given up once `stop` is set: a hands-free take that went on past its pause is heard
    /// again whole, and what was begun on its first part is not wanted.
    fn hear_until(&self, take: &Captured, _stop: &Arc<AtomicBool>) -> Result<(String, f32), String> {
        self.hear(take)
    }
    /// After a take, heard or not (the microphone may have failed before anything was): what
    /// `warm` set up for it may go.
    fn done(&self) {}
    /// At launch, once the key is on, on its own thread: fetches what the first take and the
    /// first `say` would otherwise wait on. Nothing is loaded.
    fn prefetch(&self) {}
    /// The first words of the start of an utterance (16 kHz, a second or two), for whether it
    /// began with James's name: a short decode of only that audio (`wake.rs`). Nothing, while
    /// what it needs is not loaded yet: it never waits for a download.
    fn check(&self, _audio: &[f32]) -> Result<String, String> {
        Ok(String::new())
    }
    /// As hands-free turns on, on its own thread: fetches and loads what its checks need.
    fn load(&self) -> Result<(), String> {
        Ok(())
    }
    /// Dictation is recording: hands-free takes nothing.
    fn dictating(&self) -> bool {
        false
    }
    /// A speaker, started. Nothing plays while `held` is true.
    fn speaker(
        &self,
        held: Arc<AtomicBool>,
        on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<speech::Speaker, String>;
}

/// The phase, from what is going on: someone being listened to comes first (the key held, or a
/// hands-free take being said), then a take being transcribed, then speech, then the follow-up
/// window.
pub fn phase_of(listening: bool, transcribing: bool, speaking: bool, waiting: bool) -> VoicePhase {
    if listening {
        VoicePhase::Listening
    } else if transcribing {
        VoicePhase::Transcribing
    } else if speaking {
        VoicePhase::Speaking
    } else if waiting {
        VoicePhase::Waiting
    } else {
        VoicePhase::Idle
    }
}

#[derive(Default)]
struct Flags {
    held: bool,
    /// A hands-free take is being said.
    taking: bool,
    /// Takes ended and not yet heard: a press can come before the last one is done.
    transcribing: usize,
    /// Of those, the hands-free ones: what is said meanwhile is for James (`wake::Now::pending`).
    pending: usize,
    speaking: bool,
    /// The follow-up window is open.
    waiting: bool,
    /// Hands-free listening is on: James falling silent opens the window.
    hands_free: bool,
    /// James was hushed: his falling silent opens no window.
    hushed: bool,
    said: Option<VoicePhase>,
    /// The levels' ticker runs.
    ticking: bool,
}

type Emit = Arc<dyn Fn(Event) + Send + Sync>;

/// How loud the microphone and the speaker are, as RMS in `f32` bits: written by whoever hears or
/// plays, read by the levels' ticker.
#[derive(Default)]
struct Levels {
    mic: AtomicU32,
    /// The speaker's own (`speech::Speaker::level`), once it is set up.
    out: OnceLock<Arc<AtomicU32>>,
}

impl Levels {
    fn mic(&self) -> f32 {
        f32::from_bits(self.mic.load(Ordering::Relaxed))
    }

    fn out(&self) -> f32 {
        self.out.get().map_or(0.0, |o| f32::from_bits(o.load(Ordering::Relaxed)))
    }
}

/// How often `jarvis://level` is sent while the phase is not `idle`.
const LEVEL_EVERY: Duration = Duration::from_millis(50);

/// An RMS as the orb's 0–1: -60 dB is 0, -10 dB is 1, linear in dB between.
pub fn loudness(rms: f32) -> f32 {
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() + 60.0) / 50.0).clamp(0.0, 1.0)
}

struct Phases {
    flags: Mutex<Flags>,
    emit: Emit,
    levels: Levels,
}

impl Phases {
    fn update(self: &Arc<Self>, change: impl FnOnce(&mut Flags)) {
        let mut f = lock(&self.flags);
        change(&mut f);
        let now = phase_of(f.held || f.taking, f.transcribing > 0, f.speaking, f.waiting);
        if f.said.unwrap_or(VoicePhase::Idle) != now {
            f.said = Some(now);
            (self.emit)(Event::Phase(now));
        }
        if now != VoicePhase::Idle && !f.ticking {
            f.ticking = true;
            let me = self.clone();
            let spawned = std::thread::Builder::new().name("jarvis-levels".into()).spawn(move || me.tick());
            if spawned.is_err() {
                f.ticking = false;
            }
        }
    }

    /// Sends the levels, smoothed for an animation, until the phase is `idle`: the microphone's
    /// while someone is listened to or the window is open, the speaker's while James speaks.
    fn tick(self: Arc<Self>) {
        let (mut mic, mut out) = (0.0f32, 0.0f32);
        let smooth = |was: f32, now: f32| was + (now - was) * if now > was { 0.6 } else { 0.2 };
        loop {
            std::thread::sleep(LEVEL_EVERY);
            let phase = {
                let mut f = lock(&self.flags);
                let phase = f.said.unwrap_or(VoicePhase::Idle);
                if phase == VoicePhase::Idle {
                    f.ticking = false;
                    return;
                }
                phase
            };
            mic = smooth(mic, loudness(self.levels.mic()));
            out = smooth(out, loudness(self.levels.out()));
            let hearing = matches!(phase, VoicePhase::Listening | VoicePhase::Waiting);
            (self.emit)(Event::Level(VoiceLevel {
                mic: if hearing { mic } else { 0.0 },
                out: if phase == VoicePhase::Speaking { out } else { 0.0 },
            }));
        }
    }
}

/// Hands-free takes handed on at their pause (`wake::Host`), numbered: the last one that ended, the
/// last that is over, and those that went on past their pause, until their transcript has seen
/// it. Each take goes on or is over before the next one ends.
#[derive(Default)]
struct Joins {
    ended: u64,
    settled: u64,
    resumed: Vec<u64>,
    /// Stops the transcript of the last take that ended, once it is not wanted.
    stop: Option<Arc<AtomicBool>>,
}

/// A take under way, and the window that was in front when it began.
pub struct Take {
    recording: Recording,
    window: Option<String>,
}

/// The microphone hands-free listens to, open while it is on.
struct Hands {
    _recording: Recording,
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
    hands: Mutex<Option<Hands>>,
    /// Bumped each time hands-free turns on or off: the ears of an earlier one say nothing.
    era: AtomicU64,
    follow_ms: u64,
    /// Opens the microphone hands-free listens to.
    mic: Box<dyn Fn() -> voice::Input + Send + Sync>,
    /// The window in front when the hands-free take under way began.
    front: Mutex<Option<String>>,
    joins: Mutex<Joins>,
    /// Told when `joins` changes, or the era does.
    joined: Condvar,
    /// Held while a hands-free take is transcribed. Two at once would take each other's cores:
    /// whisper's threads spin while they wait on each other, and a take that went on overlapping
    /// the transcript of its first part took a minute in the tests, where alone it takes seconds.
    hearing: Mutex<()>,
}

impl JarvisVoice {
    pub fn new(backend: Box<dyn Backend>, emit: Emit) -> Self {
        JarvisVoice {
            backend,
            phases: Arc::new(Phases { flags: Mutex::default(), emit, levels: Levels::default() }),
            take: Mutex::new(None),
            held: Arc::default(),
            speaker: Mutex::new(None),
            hushes: AtomicU64::new(0),
            hands: Mutex::new(None),
            era: AtomicU64::new(0),
            follow_ms: DEFAULT_FOLLOW_MS,
            mic: Box::new(|| Box::new(voice::default_input)),
            front: Mutex::new(None),
            joins: Mutex::default(),
            joined: Condvar::new(),
            hearing: Mutex::new(()),
        }
    }

    /// The follow-up window, `ms` long.
    pub fn follow(mut self, ms: u64) -> Self {
        self.follow_ms = ms;
        self
    }

    /// Hands-free listens through what `mic` opens, the default microphone otherwise.
    pub fn mic(mut self, mic: impl Fn() -> voice::Input + Send + Sync + 'static) -> Self {
        self.mic = Box::new(mic);
        self
    }

    fn emit(&self, e: Event) {
        (self.phases.emit)(e)
    }

    /// The key went down: the microphone opens, and nothing is said until it is up. A second
    /// press while one is held does nothing. The window closes: the key's take is its own.
    pub fn press(self: &Arc<Self>, input: voice::Input, window: Option<String>) -> Result<(), String> {
        let mut take = lock(&self.take);
        if take.is_some() {
            return Ok(());
        }
        self.held.store(true, Ordering::SeqCst);
        self.phases.update(|f| {
            f.held = true;
            f.waiting = false;
        });
        let me = self.clone();
        let phases = self.phases.clone();
        let meter: voice::Tap = Arc::new(move |mono: &[f32]| phases.levels.mic.store(voice::rms(mono).to_bits(), Ordering::Relaxed));
        let recording = Recording::tapped(input, meter, true, false, move |why| me.emit(Event::Error(voice::lost_message("microphone", why))));
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
                self.emit(Event::Heard(Heard { text, confidence: confidence.clamp(0.0, 1.0), window: take.window, via: HeardVia::Key }))
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

    /// Stops speaking and drops what is queued. Hushed, James opens no window: whoever hushed him
    /// has something else to say, typed or spoken.
    pub fn hush(&self) {
        self.hushes.fetch_add(1, Ordering::SeqCst);
        self.phases.update(|f| {
            f.hushed = true;
            f.waiting = false;
        });
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
            Arc::new(move |speaking| {
                phases.update(|f| {
                    // James fell silent by himself: the window opens.
                    if f.speaking && !speaking && f.hands_free && !f.hushed && !f.held {
                        f.waiting = true;
                    }
                    f.speaking = speaking;
                    f.hushed = false;
                })
            }),
            Arc::new(move |e| {
                log::warn!("jarvis voice: {e}");
                (errors.emit)(Event::Error(e))
            }),
        )?);
        let _ = self.phases.levels.out.set(s.level());
        *slot = Some(s.clone());
        Ok(s)
    }

    // -----------------------------------------------------------------------------------
    // Hands-free

    /// Turns hands-free listening on or off for this run, opening or closing its microphone, or
    /// with `None` only says whether it is on. Returns whether it is on.
    pub fn listen(self: &Arc<Self>, enabled: Option<bool>) -> Result<bool, String> {
        let mut hands = lock(&self.hands);
        let Some(on) = enabled else {
            return Ok(hands.is_some());
        };
        if on == hands.is_some() {
            if !on {
                // Off since its microphone was lost, perhaps (`lost`): turned off, it is not
                // opened again.
                self.era.fetch_add(1, Ordering::SeqCst);
                self.joined.notify_all();
            }
            return Ok(on);
        }
        let era = self.era.fetch_add(1, Ordering::SeqCst) + 1;
        // A take waiting to know whether it went on has its answer: nothing more joins it.
        self.joined.notify_all();
        if !on {
            // Dropped, the recording closes the microphone; the ears see the era change and go.
            *hands = None;
            self.phases.update(|f| {
                f.hands_free = false;
                f.taking = false;
                f.waiting = false;
            });
            log::info!("jarvis voice: hands-free off");
            return Ok(false);
        }
        let (tx, rx) = mpsc::channel::<(Vec<f32>, f32)>();
        let phases = self.phases.clone();
        let tap: voice::Tap = Arc::new(move |mono: &[f32]| {
            phases.levels.mic.store(voice::rms(mono).to_bits(), Ordering::Relaxed);
            // The speaker's level as this piece was heard: what of it is James (`wake.rs`).
            let _ = tx.send((mono.to_vec(), phases.levels.out()));
        });
        let me = Arc::downgrade(self);
        let recording = Recording::tapped((self.mic)(), tap, false, true, move |why| lost(&me, era, why))?;
        let wired = Wired { voice: self.clone(), era };
        let (rate, follow) = (recording.rate, self.follow_ms);
        std::thread::Builder::new()
            .name("jarvis-ears".into())
            .spawn(move || {
                let mut ears = wake::Ears::new(rate, follow);
                while wired.live() {
                    match rx.recv_timeout(Duration::from_millis(200)) {
                        Ok((piece, out)) => ears.feed(&piece, out, &wired),
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .map_err(|e| format!("jarvis voice: {e}"))?;
        *hands = Some(Hands { _recording: recording });
        drop(hands);
        self.phases.update(|f| f.hands_free = true);
        log::info!("jarvis voice: hands-free on");
        let me = self.clone();
        std::thread::spawn(move || {
            if let Err(e) = me.backend.load() {
                log::warn!("jarvis voice: hands-free: {e}");
                me.emit(Event::Error(format!("hands-free listening cannot hear James's name until whisper's model is ready: {e}")));
            }
        });
        Ok(true)
    }

    /// A hands-free take began.
    fn began(&self, via: HeardVia) {
        *lock(&self.front) = foreground_title();
        let speaking = lock(&self.phases.flags).speaking;
        // His name while he speaks: he stops, as for `jarvis_hush`, and listens.
        if via == HeardVia::Wake && speaking {
            self.hush();
        }
        self.phases.update(|f| {
            f.taking = true;
            f.waiting = false;
        });
    }

    /// A hands-free take reached its pause: transcribed on its own thread, while the ears listen
    /// on for whether it goes on.
    fn ended(self: &Arc<Self>, samples: Vec<f32>, rate: u32, via: HeardVia, lead: usize) {
        self.phases.update(|f| {
            f.taking = false;
            f.transcribing += 1;
            f.pending += 1;
        });
        let stop = Arc::new(AtomicBool::new(false));
        let take = {
            let mut j = lock(&self.joins);
            j.ended += 1;
            j.stop = Some(stop.clone());
            j.ended
        };
        let era = self.era.load(Ordering::SeqCst);
        // Kept, not taken: a take that goes on ends again, in front of the same window.
        let window = lock(&self.front).clone();
        let me = self.clone();
        std::thread::spawn(move || me.finish_hands_free(Captured { samples, rate }, via, lead, window, (take, era), stop));
    }

    /// The take that ended went on past its pause: what is being made of it is not wanted.
    fn resumed(&self) {
        let mut j = lock(&self.joins);
        let last = j.ended;
        j.resumed.push(last);
        if let Some(stop) = j.stop.take() {
            stop.store(true, Ordering::SeqCst);
        }
        drop(j);
        self.joined.notify_all();
        self.phases.update(|f| f.taking = true);
    }

    /// The take that ended is over: what is made of it is heard.
    fn settled(&self) {
        let mut j = lock(&self.joins);
        j.settled = j.ended;
        j.stop = None;
        drop(j);
        self.joined.notify_all();
    }

    /// Whether the take that was `take` in `era` went on past its pause, once that is known: it
    /// went on, or it settled, or hands-free was turned off or on since, and nothing joins it.
    fn went_on(&self, (take, era): (u64, u64)) -> bool {
        let mut j = lock(&self.joins);
        loop {
            if let Some(at) = j.resumed.iter().position(|&t| t == take) {
                j.resumed.swap_remove(at);
                return true;
            }
            if j.settled >= take || self.era.load(Ordering::SeqCst) != era {
                return false;
            }
            // Told of every change; the timeout is only in case one is ever missed.
            j = match self.joined.wait_timeout(j, Duration::from_secs(1)) {
                Ok((j, _)) => j,
                Err(e) => e.into_inner().0,
            };
        }
    }

    fn finish_hands_free(&self, take: Captured, via: HeardVia, lead: usize, window: Option<String>, which: (u64, u64), stop: Arc<AtomicBool>) {
        let ended = Instant::now();
        let secs = take.samples.len() as f32 / take.rate.max(1) as f32;
        self.backend.warm();
        let heard = {
            let _one = lock(&self.hearing);
            if stop.load(Ordering::SeqCst) {
                Err("not wanted".to_string())
            } else {
                self.backend.hear_until(&take, &stop)
            }
        };
        self.backend.done();
        let ms = ended.elapsed().as_millis();
        let went_on = self.went_on(which);
        // What the take was, said as `update` lands it: its length and the latency, never the words.
        let said = |what: &str, change: &dyn Fn(&mut Flags)| {
            log::info!("jarvis voice: a {secs:.1} s hands-free take ({via:?}) {what} in {ms} ms");
            self.phases.update(|f| {
                change(f);
                f.transcribing = f.transcribing.saturating_sub(1);
                f.pending = f.pending.saturating_sub(1);
            });
        };
        if went_on {
            return said("went on past its pause", &|_| {});
        }
        let (text, confidence) = match heard {
            Ok(heard) => heard,
            Err(e) => {
                log::warn!("jarvis voice: {e}");
                self.emit(Event::Error(e));
                return said("failed", &|_| {});
            }
        };
        let text = wake::collapse(&text);
        if wake::goodbye(&text) {
            return said("said goodbye", &|f| f.waiting = false);
        }
        // Without the name it began with; in the window, without one it may have begun with.
        let named = via == HeardVia::Wake || wake::call(&text).is_some();
        let text = wake::request(&text, if via == HeardVia::Wake { lead } else { 0 });
        if text.is_empty() || wake::no_speech(&text) || (!named && wake::unsure(&text, confidence)) {
            // The name alone: the window opens for what comes next. Nothing in the window, or only
            // what whisper writes for a cough, the keyboard or a hesitation: it closes, or a noisy
            // room would hold it open, one take after another.
            let what = if named { "had nothing after the name" } else { "was no speech" };
            return said(what, &|f| f.waiting = named && f.hands_free && !f.held);
        }
        log::info!("jarvis voice: heard {} words hands-free, confidence {confidence:.2}", text.split_whitespace().count());
        self.emit(Event::Heard(Heard { text, confidence: confidence.clamp(0.0, 1.0), window, via }));
        said("was heard", &|_| {});
    }
}

/// After losing its microphone, hands-free opens the default one again this often, this many
/// times: a headset unplugged, or a Bluetooth one gone, leaves the system a moment to settle on
/// another.
#[cfg(not(test))]
const REOPEN_EVERY: Duration = Duration::from_secs(1);
#[cfg(test)]
const REOPEN_EVERY: Duration = Duration::from_millis(20);
const REOPEN_TRIES: u32 = 10;

/// The microphone hands-free listens to went away: it listens through the default one again, or,
/// when none opens within `REOPEN_TRIES`, says so and is off. Turned off or on again meanwhile, it
/// is left as it was turned.
fn lost(voice: &Weak<JarvisVoice>, era: u64, why: &str) {
    let Some(voice) = voice.upgrade() else { return };
    if voice.era.load(Ordering::SeqCst) != era {
        return;
    }
    let why = why.trim().trim_end_matches('.').to_string();
    // Off its own thread: this runs on the input's.
    std::thread::spawn(move || {
        if voice.era.load(Ordering::SeqCst) != era {
            return;
        }
        let _ = voice.listen(Some(false));
        log::warn!("jarvis voice: hands-free lost its microphone: {why}");
        for _ in 0..REOPEN_TRIES {
            let era = voice.era.load(Ordering::SeqCst);
            std::thread::sleep(REOPEN_EVERY);
            if voice.era.load(Ordering::SeqCst) != era {
                return;
            }
            match voice.listen(Some(true)) {
                Ok(_) => return log::info!("jarvis voice: hands-free listens again"),
                Err(e) => log::info!("jarvis voice: hands-free: {e}"),
            }
        }
        voice.emit(Event::Error(format!("the microphone stopped: {why}. Hands-free listening is off.")));
    });
}

/// The voice, as the ears of one era of hands-free see it.
struct Wired {
    voice: Arc<JarvisVoice>,
    era: u64,
}

impl Wired {
    fn live(&self) -> bool {
        self.voice.era.load(Ordering::SeqCst) == self.era
    }
}

impl wake::Host for Wired {
    fn now(&self) -> wake::Now {
        let f = lock(&self.voice.phases.flags);
        wake::Now { blocked: f.held || self.voice.backend.dictating(), speaking: f.speaking, waiting: f.waiting, pending: f.pending > 0 }
    }

    fn check(&self, audio: &[f32]) -> String {
        let started = Instant::now();
        let heard = self.voice.backend.check(audio);
        log::debug!("jarvis voice: name check in {} ms", started.elapsed().as_millis());
        heard.unwrap_or_else(|e| {
            log::warn!("jarvis voice: name check: {e}");
            String::new()
        })
    }

    fn began(&self, via: HeardVia) {
        if self.live() {
            self.voice.began(via)
        }
    }

    fn ended(&self, audio: Vec<f32>, rate: u32, via: HeardVia, lead: usize) {
        if self.live() {
            self.voice.ended(audio, rate, via, lead)
        }
    }

    fn resumed(&self) {
        if self.live() {
            self.voice.resumed()
        }
    }

    fn settled(&self) {
        if self.live() {
            self.voice.settled()
        }
    }

    fn dropped(&self) {
        if self.live() {
            self.voice.phases.update(|f| f.taking = false);
        }
    }

    fn closed(&self) {
        if self.live() {
            self.voice.phases.update(|f| f.waiting = false);
        }
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

    /// What `run` hears in `take`, with the model and the prompt; nothing, without running it,
    /// in a take that is silent.
    fn heard(&self, take: &Captured, run: impl FnOnce(&WhisperContext, &[f32], &str) -> Result<(String, f32), String>) -> Result<(String, f32), String> {
        let audio = hear::to_whisper(&take.samples, take.rate);
        if voice::is_silent(&audio) {
            return Ok((String::new(), 0.0));
        }
        let model = self.model()?;
        let prompt = lock(&self.prompt).clone();
        run(&model, &audio, &prompt)
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
        self.heard(take, hear::hear)
    }

    fn hear_until(&self, take: &Captured, stop: &Arc<AtomicBool>) -> Result<(String, f32), String> {
        self.heard(take, |model, audio, prompt| hear::hear_until(model, audio, prompt, stop))
    }

    fn check(&self, audio: &[f32]) -> Result<String, String> {
        if voice::is_silent(audio) {
            return Ok(String::new());
        }
        // Not `model()`: the first launch fetches 190 MB, and the ears do not wait on it.
        let Some(model) = self.model.try_lock().ok().and_then(|m| m.clone()) else {
            return Ok(String::new());
        };
        let prompt = lock(&self.prompt).clone();
        app_full_speed(true);
        let heard = hear::head(&model, audio, &prompt);
        app_full_speed(false);
        heard
    }

    fn load(&self) -> Result<(), String> {
        *lock(&self.prompt) = hear::prompt(&crate::jarvis::projects());
        self.model().map(drop)
    }

    fn dictating(&self) -> bool {
        voice::dictating()
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

/// What wants the app at full speed now: takes under way, and name checks. Signed, so that a
/// `false` that comes before its `true` (a take released before its warm-up ran) still balances.
static FULL_SPEED: AtomicIsize = AtomicIsize::new(0);

/// This app at full speed while a take or a name check is under way (`true`), and back to
/// Windows's own choice once none is (`false`, one for each `true`): the app is often minimized
/// when James is called. Hands-free listening for the name is left to Windows.
fn app_full_speed(on: bool) {
    let was = FULL_SPEED.fetch_add(if on { 1 } else { -1 }, Ordering::SeqCst);
    match (on, was) {
        (true, 0) => set_full_speed(true),
        (false, 1) => set_full_speed(false),
        _ => {}
    }
}

#[cfg(windows)]
fn set_full_speed(on: bool) {
    // SAFETY: the pseudo-handle of this process, always valid.
    let me = unsafe { windows_sys::Win32::System::Threading::GetCurrentProcess() };
    throttling(me as _, if on { PROCESS_POWER_THROTTLING_EXECUTION_SPEED } else { 0 })
}

#[cfg(not(windows))]
fn set_full_speed(_on: bool) {}

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

/// At launch: the voice's state, the key once `jarvis.json` exists, and hands-free listening when
/// its `voice.wake` is set.
pub fn start(app: &AppHandle) {
    let emitter = app.clone();
    let emit: Emit = Arc::new(move |e: Event| {
        let name = e.name();
        let _ = match e {
            Event::Phase(p) => emitter.emit(name, p),
            Event::Heard(h) => emitter.emit(name, h),
            Event::Error(m) => emitter.emit(name, m),
            Event::Level(l) => emitter.emit(name, l),
        };
    });
    let exists = crate::jarvis::config_path().is_file();
    let config = crate::jarvis::section("voice").and_then(|s| parse_config(&s, exists, &crate::app_dir::home()));
    let config = config.unwrap_or_else(|e| {
        log::warn!("jarvis voice: {e}; the push-to-talk key and hands-free are off");
        Config::default()
    });
    let (key, wake) = (config.key.clone(), config.wake);
    let voice = Arc::new(JarvisVoice::new(Box::new(Local::new(config)), emit).follow(wake.unwrap_or(DEFAULT_FOLLOW_MS)));
    app.manage(voice.clone());
    let mut prefetch = false;
    if let Some(key) = key {
        match listen(app, &key, voice.clone()) {
            Ok(()) => {
                log::info!("jarvis voice: push-to-talk on {key}");
                prefetch = true;
            }
            Err(e) => log::warn!("jarvis voice: the push-to-talk key {key}: {e}"),
        }
    }
    if wake.is_some() {
        prefetch = true;
        let voice = voice.clone();
        // Opening the microphone can take a moment; the launch does not wait on it.
        std::thread::spawn(move || {
            if let Err(e) = voice.listen(Some(true)) {
                log::warn!("jarvis voice: hands-free: {e}");
                voice.emit(Event::Error(format!("hands-free listening did not start: {e}")));
            }
        });
    }
    if prefetch {
        // The first take and the first reply would otherwise wait on some 280 MB.
        std::thread::spawn(move || voice.prefetch());
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

/// `jarvis_listen(enabled: Option<bool>) -> Result<bool, String>`: turns hands-free listening on
/// or off for this run, opening or closing its microphone, or with none only reads it. Resolves
/// with whether it is on; a microphone that will not open is an error.
#[tauri::command]
pub async fn jarvis_listen(voice: State<'_, Arc<JarvisVoice>>, enabled: Option<bool>) -> Result<bool, String> {
    let voice = voice.inner().clone();
    tauri::async_runtime::spawn_blocking(move || voice.listen(enabled)).await.map_err(|e| format!("jarvis voice: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;

    /// The default microphone and speaker open in a process where the system's thread pool has
    /// threads made single-threaded apartments, as cpal's notification client made one when a
    /// headset was unplugged (`voice::as_itself`). A pool made so stays so: the test runs in a
    /// process of its own, this test binary again running only `opens_with_the_pool_made_sta`.
    #[cfg(windows)]
    #[test]
    fn the_microphone_and_speaker_open_after_the_pool_was_made_sta() {
        let out = crate::proc::command(std::env::current_exe().unwrap())
            .args(["--exact", "jarvis_voice::tests::opens_with_the_pool_made_sta", "--ignored", "--test-threads=1", "--nocapture"])
            .output()
            .unwrap();
        let said = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
        assert!(out.status.success() && said.contains("1 passed"), "{said}");
    }

    /// Run by `the_microphone_and_speaker_open_after_the_pool_was_made_sta`. A machine with no
    /// microphone or no speaker (CI) has nothing to open. The speaker is asked for its format,
    /// which is where opening it failed, and never played.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn opens_with_the_pool_made_sta() {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        if host.default_input_device().is_none() || host.default_output_device().is_none() {
            return eprintln!("no microphone or no speaker here: nothing to open");
        }
        let open = || {
            let rec = voice::Recording::start(Box::new(voice::default_input), |_| {}).expect("the default microphone opens");
            let _ = rec.finish();
            let (speaker, name) = speech::speaker().expect("a speaker");
            speaker.default_output_config().unwrap_or_else(|e| panic!("the speaker {name} opens: {e}"));
        };
        // Once first, as the app does at launch: the pool's threads that activation runs on are
        // then among those made single-threaded.
        open();
        assert!(make_pool_sta() > 0, "no pool thread was made single-threaded");
        for _ in 0..3 {
            open();
        }
    }

    /// Runs `CoInitializeEx` for a single-threaded apartment on as many of the system thread
    /// pool's threads as 400 callbacks reach, as cpal's `OnDeviceStateChanged` does on the one it
    /// is called on. Returns how many it made so.
    #[cfg(windows)]
    fn make_pool_sta() -> usize {
        use std::sync::atomic::AtomicUsize;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        use windows_sys::Win32::System::Threading::{TrySubmitThreadpoolCallback, PTP_CALLBACK_INSTANCE};
        const CALLS: usize = 400;
        // (ran, made single-threaded)
        static COUNTS: [AtomicUsize; 2] = [AtomicUsize::new(0), AtomicUsize::new(0)];
        unsafe extern "system" fn sta(_: PTP_CALLBACK_INSTANCE, _: *mut std::ffi::c_void) {
            // SAFETY: COM initialised for this thread, and left so, as cpal leaves it.
            if unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.0 == 0 {
                COUNTS[1].fetch_add(1, Ordering::SeqCst);
            }
            std::thread::sleep(Duration::from_millis(20));
            COUNTS[0].fetch_add(1, Ordering::SeqCst);
        }
        for _ in 0..CALLS {
            // SAFETY: a callback that takes no context, on the process's default pool.
            assert!(unsafe { TrySubmitThreadpoolCallback(Some(sta), std::ptr::null_mut(), std::ptr::null()) } != 0);
        }
        let until = Instant::now() + Duration::from_secs(30);
        while COUNTS[0].load(Ordering::SeqCst) < CALLS && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(10));
        }
        COUNTS[1].load(Ordering::SeqCst)
    }


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
    fn hands_free_is_on_at_launch_only_when_the_config_says_so() {
        let home = Path::new("/home/you");
        let wake = |v: serde_json::Value, exists: bool| parse_config(&v, exists, home).map(|c| c.wake);
        assert_eq!(wake(json!({}), true), Ok(None));
        assert_eq!(wake(json!({ "wake": null }), true), Ok(None));
        assert_eq!(wake(json!({ "wake": false }), true), Ok(None));
        assert_eq!(wake(json!({ "wake": true }), true), Ok(Some(DEFAULT_FOLLOW_MS)));
        assert_eq!(wake(json!({ "wake": {} }), true), Ok(Some(8_000)));
        assert_eq!(wake(json!({ "wake": { "followMs": 5000 } }), true), Ok(Some(5_000)));
        assert_eq!(wake(json!({ "wake": true }), false), Ok(None));
        assert!(wake(json!({ "wake": { "followMs": "8s" } }), true).is_err());
        assert!(wake(json!({ "wake": { "followMs": 0 } }), true).is_err());
        assert!(wake(json!({ "wake": "yes" }), true).is_err());
        // docs/jarvis.example.json's own.
        assert_eq!(wake(json!({ "key": DEFAULT_KEY, "wake": { "followMs": 8000 }, "orb": true }), true), Ok(Some(8_000)));
    }

    /// Until no take is being transcribed.
    fn transcribed(voice: &JarvisVoice) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while lock(&voice.phases.flags).transcribing > 0 {
            assert!(std::time::Instant::now() < deadline, "{:?}", lock(&voice.phases.flags).transcribing);
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    #[test]
    fn the_name_alone_opens_the_window_and_noise_in_it_closes_it() {
        for (heard, confidence, via, waiting) in [
            ("James.", 0.9, HeardVia::Wake, true),
            ("", 0.9, HeardVia::Wake, true),
            ("James.", 0.9, HeardVia::Follow, true),
            ("James, ahn...", 0.9, HeardVia::Follow, true),
            ("", 0.9, HeardVia::Follow, false),
            ("Legendas pela comunidade Amara.org", 0.9, HeardVia::Follow, false),
            // Whisper's writing for a room with no one talking in it: a dot, sounds, its own prompt.
            (".", 0.4, HeardVia::Follow, false),
            ("Ah!", 0.7, HeardVia::Follow, false),
            ("Aaaahhh.", 0.2, HeardVia::Follow, false),
            ("Uóter.", 0.0, HeardVia::Follow, false),
            ("Projetos. Projetos. Projetos.", 0.7, HeardVia::Follow, false),
        ] {
            let (voice, events, _) = fake_voice(Ok((heard.into(), confidence)));
            voice.phases.update(|f| f.hands_free = true);
            voice.ended(vec![0.1; 4_800], 16_000, via, 1);
            voice.settled();
            transcribed(&voice);
            assert_eq!(lock(&voice.phases.flags).waiting, waiting, "{heard:?} via {via:?}");
            assert!(!said(&events).iter().any(|e| matches!(e, Event::Heard(_))), "{heard:?} is no request");
        }
    }

    #[test]
    fn a_request_is_heard_once_said_and_unsure_only_without_the_name() {
        for (heard, confidence, via, request) in [
            ("Desculpa.", 0.44, HeardVia::Follow, "Desculpa."),
            ("E o CI? E o CI?", 0.9, HeardVia::Follow, "E o CI?"),
            // The name heard in it: little confidence is for the loop to ask about (#506).
            ("James, abre o PR.", 0.2, HeardVia::Follow, "abre o PR."),
            ("James, abre o PR. James, abre o PR.", 0.2, HeardVia::Wake, "abre o PR."),
            ("mnemo-desktop", 0.8, HeardVia::Follow, "mnemo-desktop"),
        ] {
            let (voice, events, _) = fake_voice(Ok((heard.into(), confidence)));
            voice.phases.update(|f| f.hands_free = true);
            voice.ended(vec![0.1; 4_800], 16_000, via, 1);
            voice.settled();
            transcribed(&voice);
            let texts: Vec<String> = said(&events).into_iter().filter_map(|e| if let Event::Heard(h) = e { Some(h.text) } else { None }).collect();
            assert_eq!(texts, [request], "{heard:?} via {via:?}");
        }
    }

    /// What a `Scripted` backend was asked: transcripts begun, given up, and the most at once.
    #[derive(Default)]
    struct Counts {
        calls: std::sync::atomic::AtomicUsize,
        stopped: std::sync::atomic::AtomicUsize,
        busy: std::sync::atomic::AtomicUsize,
        most: std::sync::atomic::AtomicUsize,
    }

    /// Hears what `heard` says of a take's length. `slow`: each take takes half a second, unless
    /// it is stopped first.
    struct Scripted {
        heard: fn(usize) -> String,
        slow: bool,
        counts: Arc<Counts>,
    }

    impl Backend for Scripted {
        fn warm(&self) {}
        fn hear(&self, take: &Captured) -> Result<(String, f32), String> {
            Ok(((self.heard)(take.samples.len()), 0.9))
        }
        fn hear_until(&self, take: &Captured, stop: &Arc<AtomicBool>) -> Result<(String, f32), String> {
            let c = &self.counts;
            c.calls.fetch_add(1, Ordering::SeqCst);
            let busy = c.busy.fetch_add(1, Ordering::SeqCst) + 1;
            c.most.fetch_max(busy, Ordering::SeqCst);
            let deadline = std::time::Instant::now() + Duration::from_millis(if self.slow { 500 } else { 0 });
            let mut heard = self.hear(take);
            while std::time::Instant::now() < deadline {
                if stop.load(Ordering::SeqCst) {
                    c.stopped.fetch_add(1, Ordering::SeqCst);
                    heard = Err("whisper: aborted".into());
                    break;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            c.busy.fetch_sub(1, Ordering::SeqCst);
            heard
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

    fn scripted(slow: bool) -> (Arc<JarvisVoice>, Arc<Mutex<Vec<Event>>>, Arc<Counts>) {
        let events = Arc::new(Mutex::new(vec![]));
        let into = events.clone();
        let counts = Arc::new(Counts::default());
        let heard = |len: usize| match len {
            ..=1_999 => "James.".to_string(),
            2_000..=3_999 => "James, abre o VS Code.".to_string(),
            4_000..=5_999 => "E o CI?".to_string(),
            _ => "E o CI do desktop?".to_string(),
        };
        let backend = Scripted { heard, slow, counts: counts.clone() };
        let voice = Arc::new(JarvisVoice::new(Box::new(backend), Arc::new(move |e| lock(&into).push(e))).mic(mic));
        voice.phases.update(|f| f.hands_free = true);
        (voice, events, counts)
    }

    /// Until `n` transcripts have begun.
    fn begun(counts: &Counts, n: usize) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while counts.calls.load(Ordering::SeqCst) < n {
            assert!(std::time::Instant::now() < deadline, "{n} begun");
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn texts(events: &Mutex<Vec<Event>>) -> Vec<String> {
        said(events).into_iter().filter_map(|e| if let Event::Heard(h) = e { Some(h.text) } else { None }).collect()
    }

    #[test]
    fn a_take_that_went_on_past_its_pause_is_heard_once_whole() {
        let (voice, events, counts) = scripted(true);
        let wired = Wired { voice: voice.clone(), era: voice.era.load(Ordering::SeqCst) };
        use wake::Host;
        // The name, a breath, and the request, in front of the editor.
        wired.began(HeardVia::Wake);
        *lock(&voice.front) = Some("app.rs - mnemo-desktop - Visual Studio Code".into());
        wired.ended(vec![0.1; 1_000], 16_000, HeardVia::Wake, 1);
        assert!(wired.now().pending, "what is said now is for James");
        // Its transcript under way when the take goes on.
        begun(&counts, 1);
        wired.resumed();
        assert_eq!(said(&events).last(), Some(&Event::Phase(VoicePhase::Listening)), "listening again");
        wired.ended(vec![0.1; 3_000], 16_000, HeardVia::Wake, 1);
        wired.settled();
        transcribed(&voice);
        assert!(!wired.now().pending);
        let heard: Vec<Heard> = said(&events).into_iter().filter_map(|e| if let Event::Heard(h) = e { Some(h) } else { None }).collect();
        assert_eq!(heard.len(), 1, "{:?}", said(&events));
        assert_eq!((heard[0].text.as_str(), heard[0].via), ("abre o VS Code.", HeardVia::Wake));
        assert_eq!(heard[0].window.as_deref(), Some("app.rs - mnemo-desktop - Visual Studio Code"));
        assert_eq!(counts.stopped.load(Ordering::SeqCst), 1, "the first part's transcript was given up");
        assert!(!said(&events).iter().any(|e| matches!(e, Event::Error(_))), "a transcript given up is no error");
        assert!(!lock(&voice.phases.flags).waiting, "a request, not the name alone");

        // A transcript done before the take went on is not used either; the whole take's is.
        let (voice, events, counts) = scripted(false);
        voice.ended(vec![0.1; 5_000], 16_000, HeardVia::Follow, 0);
        begun(&counts, 1);
        while counts.busy.load(Ordering::SeqCst) > 0 {
            std::thread::sleep(Duration::from_millis(1));
        }
        voice.resumed();
        voice.ended(vec![0.1; 7_000], 16_000, HeardVia::Follow, 0);
        voice.settled();
        transcribed(&voice);
        assert_eq!(texts(&events), ["E o CI do desktop?"]);
    }

    #[test]
    fn hands_free_takes_are_transcribed_one_at_a_time() {
        // The name alone, and the request said while it is transcribed.
        let (voice, events, counts) = scripted(true);
        voice.ended(vec![0.1; 1_000], 16_000, HeardVia::Wake, 1);
        voice.settled();
        voice.ended(vec![0.1; 5_000], 16_000, HeardVia::Follow, 0);
        voice.settled();
        transcribed(&voice);
        assert_eq!(texts(&events), ["E o CI?"]);
        assert_eq!(counts.most.load(Ordering::SeqCst), 1, "never two at once");

        // A take that goes on while its transcript waits its turn is never begun.
        let (voice, events, counts) = scripted(true);
        voice.ended(vec![0.1; 5_000], 16_000, HeardVia::Follow, 0);
        voice.settled();
        begun(&counts, 1);
        voice.ended(vec![0.1; 1_000], 16_000, HeardVia::Wake, 1);
        voice.resumed();
        voice.ended(vec![0.1; 3_000], 16_000, HeardVia::Wake, 1);
        voice.settled();
        transcribed(&voice);
        assert_eq!(texts(&events), ["E o CI?", "abre o VS Code."]);
        assert_eq!(counts.calls.load(Ordering::SeqCst), 2, "the first part's never begun");
    }

    #[test]
    fn a_take_waits_for_its_join_and_hands_free_turned_off_ends_the_wait() {
        // Turned off, or off again after its microphone was lost: nothing more can join the take,
        // and it is heard at once.
        for was_on in [true, false] {
            let (voice, events, _) = scripted(false);
            if was_on {
                voice.listen(Some(true)).unwrap();
            }
            voice.ended(vec![0.1; 3_000], 16_000, HeardVia::Wake, 1);
            std::thread::sleep(Duration::from_millis(150));
            assert!(!said(&events).iter().any(|e| matches!(e, Event::Heard(_))), "heard before the join was out");
            assert_eq!(lock(&voice.phases.flags).transcribing, 1);
            let off = std::time::Instant::now();
            voice.listen(Some(false)).unwrap();
            transcribed(&voice);
            assert!(off.elapsed() < Duration::from_millis(500), "{:?}", off.elapsed());
            assert_eq!(texts(&events), ["abre o VS Code."], "was on: {was_on}");
        }

        // Its join out, a transcript already made is heard at once: the join adds nothing to it.
        let (voice, events, _) = scripted(false);
        voice.ended(vec![0.1; 3_000], 16_000, HeardVia::Wake, 1);
        std::thread::sleep(Duration::from_millis(150));
        let settled = std::time::Instant::now();
        voice.settled();
        transcribed(&voice);
        assert!(settled.elapsed() < Duration::from_millis(500), "{:?}", settled.elapsed());
        assert_eq!(texts(&events), ["abre o VS Code."]);
    }

    #[test]
    fn loudness_is_zero_to_one_in_decibels() {
        assert_eq!(loudness(0.0), 0.0);
        assert_eq!(loudness(0.001), 0.0);
        assert!((loudness(0.01) - 0.4).abs() < 1e-4);
        assert_eq!(loudness(0.5), 1.0);
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
        let got = said(&events);
        assert_eq!(
            got,
            vec![
                Event::Phase(VoicePhase::Listening),
                Event::Phase(VoicePhase::Transcribing),
                Event::Heard(Heard {
                    text: "abre o PR 42".into(),
                    confidence: 0.8,
                    window: Some("app.rs - mnemo-desktop - Visual Studio Code".into()),
                    via: HeardVia::Key,
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
            said(&events),
            vec![Event::Phase(VoicePhase::Listening), Event::Phase(VoicePhase::Transcribing), Event::Phase(VoicePhase::Idle)]
        );
    }

    #[test]
    fn a_failed_take_is_an_error_and_the_phase_goes_back_to_idle() {
        let (voice, events, _) = fake_voice(Err("whisper: out of memory".into()));
        voice.press(mic(), None).unwrap();
        voice.finish(voice.release().unwrap());
        assert_eq!(said(&events)[2], Event::Error("whisper: out of memory".into()));
        assert_eq!(said(&events).last(), Some(&Event::Phase(VoicePhase::Idle)));

        let (voice, events, _) = fake_voice(Ok(("x".into(), 1.0)));
        let err = voice.press(Box::new(|_| Err("no microphone found".into())), None).unwrap_err();
        assert_eq!(err, "no microphone found");
        assert!(voice.release().is_none());
        assert_eq!(said(&events), vec![Event::Phase(VoicePhase::Listening), Event::Phase(VoicePhase::Idle)]);
    }

    #[test]
    fn hushed_he_opens_no_window_and_the_key_closes_one() {
        let (voice, events, _) = fake_voice(Ok(("e o CI?".into(), 0.9)));
        voice.phases.update(|f| f.hands_free = true);
        let until = |what: &str, done: &dyn Fn(&[Event]) -> bool| {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            while !done(&said(&events)) {
                assert!(std::time::Instant::now() < deadline, "{what}: {:?}", said(&events));
                std::thread::sleep(Duration::from_millis(2));
            }
        };
        // Enough to say that the hush comes while he speaks.
        for _ in 0..50 {
            voice.say("o PR passou").unwrap();
        }
        until("speaking", &|e| e.contains(&Event::Phase(VoicePhase::Speaking)));
        voice.hush();
        until("idle", &|e| e.last() == Some(&Event::Phase(VoicePhase::Idle)));
        assert!(!said(&events).contains(&Event::Phase(VoicePhase::Waiting)));

        // Falling silent by himself he opens it, and the key closes it: its take is its own.
        voice.say("o PR passou").unwrap();
        until("the window", &|e| e.last() == Some(&Event::Phase(VoicePhase::Waiting)));
        voice.press(mic(), None).unwrap();
        voice.finish(voice.release().unwrap());
        assert_eq!(said(&events).last(), Some(&Event::Phase(VoicePhase::Idle)));
    }

    #[test]
    fn speech_waits_while_the_key_is_held_and_follows_its_release() {
        let (voice, events, played) = fake_voice(Ok(("e o CI?".into(), 0.9)));
        voice.press(mic(), None).unwrap();
        voice.say("o PR passou").unwrap();
        std::thread::sleep(Duration::from_millis(150));
        assert!(lock(&played).is_empty(), "spoke over the maintainer");
        assert_eq!(said(&events), vec![Event::Phase(VoicePhase::Listening)], "listening outranks speaking");
        let take = voice.release().unwrap();
        voice.finish(take);
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while lock(&played).len() < 100 || said(&events).last() != Some(&Event::Phase(VoicePhase::Idle)) {
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
        assert_eq!(phase_of(true, true, true, true), VoicePhase::Listening);
        assert_eq!(phase_of(false, true, true, true), VoicePhase::Transcribing);
        assert_eq!(phase_of(false, false, true, true), VoicePhase::Speaking);
        assert_eq!(phase_of(false, false, false, true), VoicePhase::Waiting);
        assert_eq!(phase_of(false, false, false, false), VoicePhase::Idle);
        assert_eq!(serde_json::to_value(VoicePhase::Waiting).unwrap(), json!("waiting"));
        assert_eq!(serde_json::to_value(VoicePhase::Transcribing).unwrap(), json!("transcribing"));
        let h = Heard { text: "oi".into(), confidence: 0.5, window: None, via: HeardVia::Follow };
        assert_eq!(serde_json::to_value(h).unwrap(), json!({ "text": "oi", "confidence": 0.5, "window": null, "via": "follow" }));
        assert_eq!(serde_json::to_value(VoiceLevel { mic: 0.5, out: 0.0 }).unwrap(), json!({ "mic": 0.5, "out": 0.0 }));
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
            Ok(voice::Opened { keep: Box::new(()), rate: 48_000, device: "test mic".into(), watch: None })
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

    /// What the voice said, its levels left out: they come on their own clock.
    fn said(events: &Mutex<Vec<Event>>) -> Vec<Event> {
        lock(events).iter().filter(|e| !matches!(e, Event::Level(_))).cloned().collect()
    }

    /// A microphone that gives a tenth of a second of tone.
    fn mic() -> voice::Input {
        Box::new(|sink: voice::Sink| {
            sink.push(&vec![0.1f32; 4_800], 1, usize::MAX);
            Ok(voice::Opened { keep: Box::new(()), rate: 48_000, device: "test mic".into(), watch: None })
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

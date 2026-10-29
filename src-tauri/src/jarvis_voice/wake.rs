//! Hands-free listening (#503, #506): James called by his name, without the push-to-talk key.
//!
//! While hands-free is on the microphone stays open, and `Ears` reads it a piece at a time:
//! - **Utterances.** A gate set above the room's own noise floor cuts the audio into utterances:
//!   one starts after `ONSET` of frames over the gate, and ends after `PAUSE` under it.
//! - **The name.** Once an utterance has gone on for `FIRST_CHECK`, its start is decoded for its
//!   first few words (`Host::check`, a short decode of only that audio). When they are James's
//!   name, perhaps after a greeting (`call`), the utterance is a take and the phase is `listening`
//!   while it is still being said; it ends at the pause, or at `MAX_TAKE`. An utterance that did
//!   not begin with the name is not decoded again, however long it runs: one check, two when the
//!   first heard only a greeting.
//! - **A pause is not always the end.** At the pause a take is handed on to be transcribed, and
//!   speech back within `JOIN` goes on with it: "James, [a breath] abre o VS Code", or a request
//!   said in two goes, is one take. What was made of its first part is then not used.
//! - **What was said decides how long to wait** (#503). A transcript that reads as a request said
//!   to its end (`whole`: "abre o VS Code.", "e o CI?") ends the take after `WHOLE_MS` of silence;
//!   one that does not (the name alone, "quais PRs estão", "abre o,") waits the join out. Speech
//!   back after `WHOLE_MS`, in what was the join, is still for James (`Ears::grace`): a take of its
//!   own, no name needed, so a request cut there is heard in two, never lost.
//! - **The window.** After James has spoken, whatever is said before the window closes is a take,
//!   no name needed. Its start is the utterance's, so it is `listening` from the first syllable.
//!   So is what is said while a take is still being transcribed: right after the name alone, the
//!   request, before the window the name opens is there.
//! - **His own voice.** On speakers the microphone hears James. A frame counts as someone talking
//!   only when it is louder than his voice, as it reaches the microphone, would make it: how much
//!   of him reaches it (`gain`) is learnt while he speaks, against what the speaker was fed in the
//!   last `ECHO_SPAN`. He never begins a reply with his own name, so what of him gets through
//!   still starts nothing.
//!
//! Nothing here keeps audio past its utterance, and nothing of it is written or logged.

use std::collections::VecDeque;

use super::{hear, HeardVia};
use crate::voice::rms;

/// The gate is read every frame.
const FRAME_MS: u32 = 20;
/// Frames over the gate in a row that start an utterance: a click or a knock is shorter.
const ONSET: u32 = 4;
/// What ends an utterance that is no take: this long under the gate. Measured over the fixtures
/// Piper spoke (`fixtures/voice/wake-*.wav`), a comma leaves up to 0.38 s of silence and a full
/// stop 0.46 s: 0.7 s keeps two sentences of talk one utterance, checked once.
const PAUSE_MS: u32 = 700;
/// What hands a take (or an utterance not yet checked) on to be transcribed: shorter than
/// `PAUSE_MS`, since speech back within `JOIN_MS` still goes on with it. Over a full stop's
/// 0.46 s, so that two sentences said at Piper's pace are one transcript.
const TAKE_PAUSE_MS: u32 = 600;
/// Audio kept from before the gate opened, so the first syllable is not cut.
const PREROLL_MS: u32 = 300;
/// Silence kept after the last frame of speech, so the last word is not cut.
const TAIL_MS: u32 = 200;
/// From an utterance's start to its first check, and to its second when the first heard only a
/// greeting ("ei"), or a word cut short. "Ei, James" is said in about 0.9 s.
const FIRST_CHECK_MS: u32 = 1_000;
const SECOND_CHECK_MS: u32 = 2_000;
/// After a take's pause, speech back within this long goes on with the take. Its transcript starts
/// at the pause and is used once this is out, so it cost nothing while whisper was slower: in the
/// maintainer's first session with hands-free (2026-10-24, `small` on the CPU) a take took 1.4 s
/// to 6.5 s to transcribe, 2.3 s in the median. That session lost the request said after a breath
/// following the name, five times in two minutes. With `PAUSE_MS`, 1.7 s of silence ends a take: a
/// breath between the name and the request, or between two halves of one, is shorter.
///
/// On the GPU whisper takes 0.25 s, and 1.7 s was most of the wait for James: a take whose
/// transcript is `whole` ends at `WHOLE_MS` (`Now::whole`), and only the others wait this out.
const JOIN_MS: u32 = 1_000;
/// The silence that ends a take whose transcript reads `whole`, from its last word. Not less: cut
/// at a pause between words, half a request often reads whole too. Measured with Piper over 13
/// requests cut at each of their 73 pauses (`live_breaths`), whisper closed the half with a full
/// stop or a question mark 36 times with Jarvis's model, 46 with the base one ("James, abre o PR
/// 40."). So this is the longest breath that is never cut; a longer one is kept where the half did
/// not read whole (`JOIN_MS`), and heard as a second take where it did.
const WHOLE_MS: u32 = 900;
/// A take never runs longer.
const MAX_TAKE_MS: u32 = 30_000;
/// The first moments of the window still belong to James: the room's echo of his last word.
const GUARD_MS: u32 = 250;
/// How far back the speaker's level is weighed against the microphone's: the device's buffer and
/// the room both delay him.
const ECHO_SPAN_MS: u32 = 300;
/// Frames read at the start to set the noise floor before anything can start an utterance.
const WARMUP: u32 = 10;

/// The gate: this many times the noise floor, and never under `MIN_GATE`. Under way, an utterance
/// holds while over `HOLD` times the floor. Measured (dictation, `voice::is_silent`): a built-in
/// microphone idles near 0.0013 RMS, faint speech is 0.0024.
const GATE: f32 = 2.5;
const MIN_GATE: f32 = 0.002;
const HOLD: f32 = 1.6;
const MIN_HOLD: f32 = 0.0015;
/// How much louder than his echo someone must be while James speaks.
const ECHO_MARGIN: f32 = 2.0;
/// A frame whose share of the speaker's level is past this many times the gain is learnt slowly.
const RISE_LIMIT: f32 = 1.5;
/// The speaker counts as playing over this RMS.
const OUT_FLOOR: f32 = 0.003;

/// What the ears see of the voice, read each frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Now {
    /// The push-to-talk key is held, or dictation records: hands-free takes nothing.
    pub blocked: bool,
    /// James is speaking.
    pub speaking: bool,
    /// The follow-up window is open.
    pub waiting: bool,
    /// A hands-free take is being transcribed: what is said now is for James.
    pub pending: bool,
    /// The take handed on was transcribed, and what was heard reads as said to its end (`whole`):
    /// no join is waited for, and it ends at `WHOLE_MS`.
    pub whole: bool,
}

/// What the ears tell the voice, and ask of it.
pub trait Host {
    fn now(&self) -> Now;
    /// The first words of `audio` (16 kHz, a second or two from an utterance's start); empty when
    /// nothing was made of it.
    fn check(&self, audio: &[f32]) -> String;
    /// A take began: it opened with the name (`Wake`), or came in the window (`Follow`).
    fn began(&self, via: HeardVia);
    /// The take that began reached its pause: its audio, mono at `rate`, to transcribe. `lead`:
    /// how many words the check heard up to the name and with it, for `request`. What is made of
    /// it is used once the take has `settled`, and never if it `resumed`.
    fn ended(&self, audio: Vec<f32>, rate: u32, via: HeardVia, lead: usize);
    /// The take that ended goes on: speech came back within `JOIN_MS`. It ends again, all of it.
    fn resumed(&self);
    /// The take that ended is over: nothing came back within `JOIN_MS`, its transcript was
    /// `whole`, or the key took over.
    fn settled(&self);
    /// The take that began will not end: the key or dictation took over.
    fn dropped(&self);
    /// The window closed with nothing said in it.
    fn closed(&self);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// Not known yet whether it began with the name.
    Checking,
    /// A take.
    Take(HeardVia),
    /// Not a take: followed to its end, and not kept.
    Ignored,
}

struct Utterance {
    audio: Vec<f32>,
    /// The clock at its first frame of speech.
    began: u64,
    /// `audio`'s length at its last frame of speech.
    voiced: usize,
    /// Frames under the gate since then.
    quiet: u32,
    mode: Mode,
    checks: u8,
    /// Words of the check up to the name and with it.
    lead: usize,
    /// A take handed on at its pause (`Host::ended`), and still open to what comes back.
    handed: bool,
}

pub struct Ears {
    rate: u32,
    frame: usize,
    /// Samples read, at `rate`: the ears' clock.
    clock: u64,
    /// A frame not yet whole.
    partial: Vec<f32>,
    floor: f32,
    /// How much of the speaker's level reaches the microphone.
    gain: f32,
    /// The speaker's level over the last `ECHO_SPAN`, with when it was read.
    outs: VecDeque<(u64, f32)>,
    preroll: VecDeque<f32>,
    /// Frames over the gate in a row, before an utterance.
    run: u32,
    frames: u32,
    utterance: Option<Utterance>,
    /// When the window closes, and until when its start is still James's echo.
    window: Option<(u64, u64)>,
    follow: u64,
    /// A take that ended before its join was out (`Now::whole`): until when it would have been,
    /// on the clock. What starts before then is still for James, a take with no name. It does not
    /// run while the speaker plays: the cue the take plays hides, as James's voice does, what is
    /// said over it.
    grace: u64,
}

impl Ears {
    /// Ears on audio at `rate`, with a window of `follow_ms`.
    pub fn new(rate: u32, follow_ms: u64) -> Self {
        Ears {
            rate,
            frame: (rate as usize * FRAME_MS as usize / 1000).max(1),
            clock: 0,
            partial: vec![],
            floor: MIN_HOLD,
            gain: 1.0,
            outs: VecDeque::new(),
            preroll: VecDeque::new(),
            run: 0,
            frames: 0,
            utterance: None,
            window: None,
            follow: rate as u64 * follow_ms / 1000,
            grace: 0,
        }
    }

    fn samples(&self, ms: u32) -> u64 {
        self.rate as u64 * ms as u64 / 1000
    }

    /// Reads `chunk`, mono at the ears' rate, captured while the speaker's level was `out`.
    pub fn feed(&mut self, chunk: &[f32], out: f32, host: &dyn Host) {
        self.partial.extend_from_slice(chunk);
        let whole = self.partial.len() / self.frame * self.frame;
        let frames: Vec<f32> = self.partial.drain(..whole).collect();
        for frame in frames.chunks(self.frame) {
            self.step(frame, out, host);
        }
    }

    fn step(&mut self, frame: &[f32], out: f32, host: &dyn Host) {
        let now = host.now();
        self.clock += frame.len() as u64;
        self.frames = self.frames.saturating_add(1);
        let level = rms(frame);

        match self.window {
            None if now.waiting => {
                self.window = Some((self.clock + self.follow, self.clock + self.samples(GUARD_MS)));
            }
            Some(_) if !now.waiting => self.window = None,
            _ => {}
        }

        let span = self.samples(ECHO_SPAN_MS);
        self.outs.push_back((self.clock, out));
        while self.outs.front().is_some_and(|&(at, _)| at + span < self.clock) {
            self.outs.pop_front();
        }
        let played = self.outs.iter().map(|&(_, o)| o).fold(0.0f32, f32::max);
        let echo = if played > OUT_FLOOR { self.gain * played } else { 0.0 };
        if played > OUT_FLOOR && self.clock < self.grace {
            self.grace += frame.len() as u64;
        }
        // A take handed on at its pause goes on as an utterance would start.
        let threshold = match self.utterance {
            Some(Utterance { handed: false, .. }) => (self.floor * HOLD).max(MIN_HOLD),
            _ => (self.floor * GATE).max(MIN_GATE),
        };
        let voiced = self.frames > WARMUP && level > threshold && level > ECHO_MARGIN * echo;

        if self.frames <= WARMUP {
            self.floor = if self.frames == 1 { level.max(1e-5) } else { self.floor.min(level.max(1e-5)) };
        } else if played > OUT_FLOOR {
            // James speaks. The gain is the most of him that reaches the microphone: it rises
            // fast to a frame of him that came louder, and falls over a couple of seconds, so that
            // his loudest syllables stay under it and headphones, which let none of him through,
            // bring it down. A frame far louder than the gain says is someone talking over him, or
            // the volume turned up: learnt slowly, so that a voice over his is not learnt as his,
            // and a gain left too low does not stay so. Learnt only while the speaker plays now: in
            // the gaps between his words the microphone hears the room.
            if out > OUT_FLOOR {
                let ratio = level / played;
                let rate = match ratio / self.gain {
                    r if r >= RISE_LIMIT || voiced => 0.005,
                    r if r > 1.0 => 0.5,
                    _ => 0.01,
                };
                self.gain += (ratio - self.gain) * rate;
            }
        } else {
            // Down fast in a pause, up slowly, so that a fan that starts is the floor in a few
            // seconds and speech never is.
            let rate = if level < self.floor { 0.3 } else { 0.003 };
            self.floor = (self.floor + (level - self.floor) * rate).max(1e-5);
        }

        match self.utterance.take() {
            None => {
                self.preroll.extend(frame.iter().copied());
                let keep = self.samples(PREROLL_MS) as usize;
                while self.preroll.len() > keep {
                    self.preroll.pop_front();
                }
                self.run = if voiced { self.run + 1 } else { 0 };
                if self.run >= ONSET {
                    self.utterance = Some(self.start(now, played > OUT_FLOOR, host));
                }
            }
            Some(mut u) if u.handed => {
                u.audio.extend_from_slice(frame);
                self.preroll.extend(frame.iter().copied());
                let keep = self.samples(PREROLL_MS) as usize;
                while self.preroll.len() > keep {
                    self.preroll.pop_front();
                }
                self.run = if voiced { self.run + 1 } else { 0 };
                u.quiet += 1;
                if now.blocked {
                    // The key or dictation took over: the take is what was said up to its pause.
                    self.run = 0;
                    host.settled();
                } else if self.run >= ONSET {
                    self.run = 0;
                    u.handed = false;
                    u.quiet = 0;
                    u.voiced = u.audio.len();
                    host.resumed();
                    self.utterance = Some(u);
                } else if (now.whole && u.quiet * FRAME_MS >= WHOLE_MS) || u.quiet * FRAME_MS >= PAUSE_MS + JOIN_MS {
                    if now.whole {
                        // The join it did not wait out, from where its last word ended.
                        let quiet = self.samples(u.quiet * FRAME_MS);
                        self.grace = (self.clock + self.samples(PAUSE_MS + JOIN_MS)).saturating_sub(quiet);
                    }
                    self.run = 0;
                    host.settled();
                } else {
                    self.utterance = Some(u);
                }
            }
            Some(mut u) => {
                if u.mode != Mode::Ignored {
                    u.audio.extend_from_slice(frame);
                }
                if voiced {
                    u.quiet = 0;
                    u.voiced = u.audio.len();
                } else {
                    u.quiet += 1;
                }
                if now.blocked && u.mode != Mode::Ignored {
                    if matches!(u.mode, Mode::Take(_)) {
                        host.dropped();
                    }
                    u.mode = Mode::Ignored;
                    u.audio = vec![];
                }
                let since = self.clock - u.began;
                let due = match u.checks {
                    0 => self.samples(FIRST_CHECK_MS),
                    1 => self.samples(SECOND_CHECK_MS),
                    _ => u64::MAX,
                };
                if u.mode == Mode::Checking && since >= due {
                    self.check(&mut u, false, host);
                }
                let pause = if u.mode == Mode::Ignored { PAUSE_MS } else { TAKE_PAUSE_MS };
                let paused = u.quiet * FRAME_MS >= pause;
                let full = matches!(u.mode, Mode::Take(_)) && u.audio.len() as u64 >= self.samples(MAX_TAKE_MS);
                self.utterance = if paused || full { self.end(u, full, host) } else { Some(u) };
            }
        }

        if let Some((closes, _)) = self.window {
            let following = self.utterance.as_ref().is_some_and(|u| u.mode == Mode::Take(HeardVia::Follow));
            if self.clock >= closes && !following {
                self.window = None;
                host.closed();
            }
        }
    }

    /// An utterance starts: in the window, while a take is being transcribed, or in the join a
    /// take did not wait out, it is a take at once; else it is checked for the name.
    /// Over James's voice what came before it is his, not the utterance's: it starts at its own
    /// first frame, or it would not begin with the name.
    fn start(&mut self, now: Now, over_james: bool, host: &dyn Host) -> Utterance {
        let began = self.clock - self.run as u64 * self.frame as u64;
        if over_james {
            let own = (self.run as usize * self.frame).min(self.preroll.len());
            self.preroll.drain(..self.preroll.len() - own);
        }
        self.run = 0;
        let audio: Vec<f32> = self.preroll.drain(..).collect();
        let mode = match self.window {
            _ if now.blocked => Mode::Ignored,
            Some((_, guard)) if self.clock >= guard => {
                self.window = None;
                host.began(HeardVia::Follow);
                Mode::Take(HeardVia::Follow)
            }
            // Said after the name alone, before its transcript opens the window, or on after a
            // request that read whole; over James it takes his name, as ever.
            _ if (now.pending || began < self.grace) && !now.speaking => {
                host.began(HeardVia::Follow);
                Mode::Take(HeardVia::Follow)
            }
            _ => Mode::Checking,
        };
        let audio = if mode == Mode::Ignored { vec![] } else { audio };
        Utterance { voiced: audio.len(), audio, began, quiet: 0, mode, checks: 0, lead: 0, handed: false }
    }

    /// Decodes the start of `u` for the name. `last`: the utterance has ended, and an unsure
    /// verdict is a no.
    fn check(&self, u: &mut Utterance, last: bool, host: &dyn Host) {
        u.checks += 1;
        let text = host.check(&hear::to_whisper(&u.audio, self.rate));
        match verdict(&text) {
            Verdict::Call => {
                u.mode = Mode::Take(HeardVia::Wake);
                u.lead = lead(&text).unwrap_or(1);
                host.began(HeardVia::Wake);
            }
            Verdict::Unsure if !last && u.checks < 2 => {}
            _ => {
                u.mode = Mode::Ignored;
                u.audio = vec![];
            }
        }
    }

    /// `u` reached its pause, or its longest (`full`). A take is handed on to be transcribed; at
    /// its pause it stays, open to what comes back within `JOIN_MS`.
    fn end(&mut self, mut u: Utterance, full: bool, host: &dyn Host) -> Option<Utterance> {
        if u.mode == Mode::Checking {
            self.check(&mut u, true, host);
        }
        let Mode::Take(via) = u.mode else { return None };
        let end = (u.voiced + self.samples(TAIL_MS) as usize).min(u.audio.len());
        if full {
            // Cut at thirty seconds: what is said on is another utterance.
            u.audio.truncate(end);
            host.ended(u.audio, self.rate, via, u.lead);
            host.settled();
            return None;
        }
        host.ended(u.audio[..end].to_vec(), self.rate, via, u.lead);
        u.handed = true;
        Some(u)
    }
}

// ---------------------------------------------------------------------------------------
// Words

/// How whisper writes James's name, as `fold` leaves it: "Games" and "Jaime" were seen live, and "Jeans" after a greeting with Jarvis's model over Piper (`wake_tests.rs`, `live_latency`).
const NAMES: &[&str] = &[
    "james", "jame", "jamis", "jaimes", "jaime", "jaimi", "jaimis", "jime", "jeans", "jaymes", "jeimes", "jeims", "jeime", "jeimis", "jemes", "jems", "djeims", "djames",
    "dgeims", "games", "geims", "gemes", "chames",
];
/// Greetings of more than one word that may come before the name in a call, and of one that a
/// first check hearing only them checks again.
const GREETINGS: &[&[&str]] = &[
    &["ei"], &["e"], &["eh"], &["ey"], &["hey"], &["hei"], &["o"], &["oi"], &["ola"], &["alo"], &["fala"], &["opa"], &["psiu"], &["eai"],
    &["eae"], &["e", "ai"], &["bom", "dia"], &["boa", "tarde"], &["boa", "noite"],
];
/// A goodbye is made of these, with `FILLERS` and the name around them.
const GOODBYES: &[&[&str]] = &[
    &["valeu"], &["obrigado"], &["obrigada"], &["brigado"], &["brigada"], &["tchau"], &["falou"], &["chega"], &["para"],
    &["parar"], &["pode", "parar"], &["pode", "ir"], &["era", "so", "isso"], &["so", "isso"], &["ate", "mais"],
    &["ate", "logo"], &["ate", "depois"], &["por", "enquanto"], &["por", "enquanto", "so"], &["por", "hoje"],
    &["por", "hoje", "so"], &["por", "hoje", "isso"],
];
const FILLERS: &[&str] = &["ok", "okay", "beleza", "ta", "bom", "entao", "e", "ai", "muito", "cara", "certo", "show", "ei", "oi"];

/// A word as it is compared: lower case, no accents, letters and digits only.
pub fn fold(word: &str) -> String {
    word.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

fn is_name(folded: &str) -> bool {
    NAMES.contains(&folded)
}

/// When `text` begins with James's name, perhaps after a word ("ei", "ô", "fala", or whatever
/// whisper made of one: "VAR, James" was "Fala, James") or a greeting of two ("bom dia"): what
/// was said after it, as whisper wrote it. The name further into a sentence is not a call.
pub fn call(text: &str) -> Option<String> {
    let words = words(text);
    let (at, last) = name_in(&words)?;
    let before: Vec<&str> = words[..at].iter().map(|(_, _, f)| f.as_str()).collect();
    if before.len() > 1 && !GREETINGS.contains(&before.as_slice()) {
        return None;
    }
    let (start, word, _) = &words[last];
    let rest = text[start + word.len()..].trim_start_matches(|c: char| c.is_whitespace() || ",.!?;:-–—…".contains(c));
    Some(rest.trim_end().to_string())
}

/// The first and last word of the first name in `words`: one word, or two whisper split it
/// into ("Jai mi").
fn name_in(words: &[(usize, &str, String)]) -> Option<(usize, usize)> {
    (0..words.len()).find_map(|i| {
        if is_name(&words[i].2) {
            Some((i, i))
        } else {
            let next = words.get(i + 1)?;
            is_name(&format!("{}{}", words[i].2, next.2)).then_some((i, i + 1))
        }
    })
}

/// How many words of `text`, a call, come up to the name and with it.
fn lead(text: &str) -> Option<usize> {
    call(text)?;
    name_in(&words(text)).map(|(_, last)| last + 1)
}

/// The request in the whole transcript of a take: what follows the name when the transcript has
/// it, else what follows its first `lead` words, which is where the name was when the start was
/// checked. Decoding the whole take, whisper may write the name as something else ("Teams",
/// with the base model) where the check heard it.
pub fn request(text: &str, lead: usize) -> String {
    if let Some(rest) = call(text) {
        return rest;
    }
    let words = words(text);
    match words.get(lead) {
        Some((start, _, _)) => text[*start..].trim().to_string(),
        None if lead == 0 => text.trim().to_string(),
        None => String::new(),
    }
}

/// The words of `text` that `fold` leaves something of, each with where it starts and as folded.
fn words(text: &str) -> Vec<(usize, &str, String)> {
    let mut out = vec![];
    let mut start = None;
    for (i, c) in text.char_indices().chain([(text.len(), ' ')]) {
        match (c.is_whitespace(), start) {
            (false, None) => start = Some(i),
            (true, Some(s)) => {
                let word = &text[s..i];
                let folded = fold(word);
                if !folded.is_empty() {
                    out.push((s, word, folded));
                }
                start = None;
            }
            _ => {}
        }
    }
    out
}

/// Whether `text` only says goodbye: "valeu, James", "obrigado", "tchau", "pode parar", "era só
/// isso", "obrigado por enquanto", "por hoje é isso". "É isso" alone is not one: it is the yes to
/// James's "É isso?".
pub fn goodbye(text: &str) -> bool {
    let words: Vec<String> = text.split_whitespace().map(fold).filter(|w| !w.is_empty() && !is_name(w) && !FILLERS.contains(&w.as_str())).collect();
    if words.is_empty() {
        return false;
    }
    // Whether the words are goodbyes end to end.
    let mut ends = vec![false; words.len() + 1];
    ends[0] = true;
    for i in 0..words.len() {
        if !ends[i] {
            continue;
        }
        for phrase in GOODBYES {
            let j = i + phrase.len();
            if j <= words.len() && words[i..j].iter().zip(phrase.iter()).all(|(w, p)| w == p) {
                ends[j] = true;
            }
        }
    }
    ends[words.len()]
}

/// What whisper writes for a sound that was no speech, as `fold` leaves its words: the credits of
/// the subtitles it learnt from.
const NO_SPEECH: &[&str] = &[
    "legendas pela comunidade amaraorg",
    "legendas pela comunidade do amaraorg",
    "inscrevase no canal",
    "obrigado por assistir",
    "subtitles by the amaraorg community",
    "thank you for watching",
    "thanks for watching",
];

/// Sounds rather than words, as `fold` leaves them with a letter held long written once
/// ("Aaaahhh!" is "ah"): someone hesitating, or whisper's word for a breath.
const INTERJECTIONS: &[&str] = &["ah", "ahn", "an", "e", "eh", "hm", "hum", "oh", "uh", "uhm", "um"];

/// `word` with each run of one letter written once.
fn squeeze(word: &str) -> String {
    let mut out = String::new();
    for c in word.chars() {
        if !out.ends_with(c) {
            out.push(c);
        }
    }
    out
}

/// Whether `text` is no speech: nothing but punctuation ("."), only sounds ("Ah!", "Hmm…"), or
/// what whisper writes for a cough or the keyboard.
pub fn no_speech(text: &str) -> bool {
    let words: Vec<String> = text.split_whitespace().map(fold).filter(|w| !w.is_empty()).collect();
    words.iter().all(|w| INTERJECTIONS.contains(&squeeze(w).as_str())) || NO_SPEECH.contains(&words.join(" ").as_str())
}

/// Under this confidence a take that did not say the name is noise. Seen live (2026-10-24), what
/// whisper made of the room after James spoke came at 0.00 to 0.39, requests at 0.44 and over.
const MIN_CONFIDENCE: f32 = 0.3;

/// Whether `text`, a take that did not say the name, is too unsure to be a request: heard with
/// little confidence, or `only_prompt`.
pub fn unsure(text: &str, confidence: f32) -> bool {
    confidence < MIN_CONFIDENCE || only_prompt(text)
}

/// Whether `text` is only words of whisper's prompt (`hear::prompt`), which it writes back for a
/// sound it cannot make out ("Projetos."). A project's name alone may answer James; the prompt's
/// jargon and its label for the names do not.
pub fn only_prompt(text: &str) -> bool {
    let prompt: Vec<String> = hear::JARGON.split_whitespace().chain([hear::PROJECTS]).map(fold).collect();
    text.split_whitespace().map(fold).filter(|w| !w.is_empty()).all(|w| prompt.contains(&w))
}

/// Whether what James says, `text`, ends by asking the maintainer something: then, and only
/// then, the window stays open for the answer once he falls silent.
pub fn asks(text: &str) -> bool {
    text.trim_end_matches(|c: char| c.is_whitespace() || "!\"'\u{201d}\u{2019}\u{bb})]".contains(c)).ends_with('?')
}

/// Words a request does not end on, as `whole` compares them (lower case, accents kept: "e" is
/// "and", "é" is "is"; "que" goes on, "o quê?" does not): articles, prepositions and their
/// contractions, conjunctions. Whisper, handed half a request at a breath, may still end it with a
/// full stop: "abre o PR do." is not the end of one.
const DANGLING: &[&str] = &[
    "o", "a", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "num",
    "numa", "ao", "aos", "à", "às", "por", "pelo", "pela", "pelos", "pelas", "pra", "pro", "pras", "pros", "para", "com",
    "sem", "sobre", "entre", "até", "desde", "e", "ou", "mas", "que", "se", "nem", "porque", "pois", "the", "and", "or",
    "of", "to", "for", "with",
];

/// Whether `request`, what a take asked once the name is off it, reads as said to its end: a
/// sentence whisper closed (".", "?", "!"), not trailing off ("...") or on a comma, and not on a
/// word that leads into more (`DANGLING`). Then no join is waited for (`Now::whole`).
pub fn whole(request: &str) -> bool {
    let text = request.trim_end_matches(|c: char| c.is_whitespace() || "\"'\u{201d}\u{2019}\u{bb})]".contains(c));
    let Some(stop) = text.chars().last() else { return false };
    if !".?!".contains(stop) || text.ends_with("..") || no_speech(text) {
        return false;
    }
    let last = text.split_whitespace().last().unwrap_or("");
    let last: String = last.chars().flat_map(char::to_lowercase).filter(|c| c.is_alphanumeric()).collect();
    !last.is_empty() && !DANGLING.contains(&last.as_str())
}

/// `text` with each sentence that only repeats the one before it left out: looping on a sound,
/// whisper writes "Projetos. Projetos. Projetos.".
pub fn collapse(text: &str) -> String {
    let mut kept: Vec<&str> = vec![];
    let mut last = String::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let end = i + c.len_utf8();
        let ends = ".!?…".contains(c) && chars.peek().map_or(true, |(_, n)| n.is_whitespace());
        if ends || chars.peek().is_none() {
            let sentence = text[start..end].trim();
            let key = sentence.split_whitespace().map(fold).collect::<Vec<_>>().join(" ");
            if !sentence.is_empty() && key != last {
                kept.push(sentence);
                last = key;
            }
            start = end;
        }
    }
    kept.join(" ")
}

#[derive(Debug, PartialEq, Eq)]
enum Verdict {
    Call,
    Not,
    /// Too little to tell: nothing, a greeting alone, or one word that may be cut short.
    Unsure,
}

fn verdict(text: &str) -> Verdict {
    if call(text).is_some() {
        return Verdict::Call;
    }
    let words: Vec<String> = text.split_whitespace().map(fold).filter(|w| !w.is_empty()).collect();
    let greeting = GREETINGS.iter().any(|g| g.len() == words.len() && g.iter().zip(&words).all(|(a, b)| a == b));
    if words.len() <= 1 || greeting {
        Verdict::Unsure
    } else {
        Verdict::Not
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn a_call_begins_with_the_name_perhaps_after_a_greeting() {
        assert_eq!(call("James, quais PRs estão abertos no desktop?").as_deref(), Some("quais PRs estão abertos no desktop?"));
        assert_eq!(call("Ei, James, o CI passou?").as_deref(), Some("o CI passou?"));
        assert_eq!(call("Ô James, abre o VS Code.").as_deref(), Some("abre o VS Code."));
        assert_eq!(call("Fala, James! Tudo bem?").as_deref(), Some("Tudo bem?"));
        assert_eq!(call("Bom dia, James.").as_deref(), Some(""));
        assert_eq!(call("James.").as_deref(), Some(""));
        // How whisper writes the name: seen live, and its neighbours.
        assert_eq!(call("Games, abre o PR 42.").as_deref(), Some("abre o PR 42."));
        assert_eq!(call("Jaime, o build passou?").as_deref(), Some("o build passou?"));
        assert_eq!(call("Jeimes quais são os PRs").as_deref(), Some("quais são os PRs"));
        assert_eq!(call("Jai mi, abre o VS Code.").as_deref(), Some("abre o VS Code."));
        assert_eq!(lead("Ei, Jai mi, abre"), Some(3));
        // The name in the middle of a sentence is not a call.
        assert_eq!(call("Eu falei com o James ontem."), None);
        assert_eq!(call("Pergunta pro James depois."), None);
        assert_eq!(call("VAR, James, o CI passou?").as_deref(), Some("o CI passou?"));
        assert_eq!(call("Quais PRs estão abertos?"), None);
        assert_eq!(call(""), None);

        // The whole take's text loses what the check heard up to the name.
        assert_eq!(lead("Ei, James, o CI passou?"), Some(2));
        assert_eq!(request("Teams, quais PRs estão abertos?", 1), "quais PRs estão abertos?");
        assert_eq!(request("Ei, Teams, o CI passou?", 2), "o CI passou?");
        assert_eq!(request("Ei, James, o CI passou?", 1), "o CI passou?");
        assert_eq!(request("E o do site?", 0), "E o do site?");
        assert_eq!(request("Teams.", 1), "");
    }

    #[test]
    fn a_goodbye_is_only_a_goodbye() {
        for g in ["Valeu, James.", "Obrigado, James!", "Muito obrigada.", "Tchau.", "Pode parar.", "Era só isso.", "Ok, valeu, tchau!", "É só isso, James, obrigado."] {
            assert!(goodbye(g), "{g}");
        }
        for not in ["Obrigado, e o CI?", "Para o desktop.", "James", "", "Valeu, agora abre o PR 42."] {
            assert!(!goodbye(not), "{not}");
        }
        // Thanks and closings with their fillers.
        for g in ["Beleza, muito obrigado por enquanto, James.", "Obrigado.", "Por enquanto é só.", "Por hoje é isso.", "Por hoje é só, valeu.", "Valeu, por hoje.", "Valeu, James."] {
            assert!(goodbye(g), "{g}");
        }
        // The yes to "É isso?", and a request after thanks.
        for not in ["É isso.", "Isso.", "Obrigado, e por enquanto o CI?", "Por enquanto abre o PR."] {
            assert!(!goodbye(not), "{not}");
        }
    }

    #[test]
    fn he_asks_when_what_he_says_ends_on_a_question() {
        for q in ["Quer que eu mande para um parent?", "O PR passou. Quer ver o CI?", "Era isso?!", "Abro o \u{ab}PR 42?\u{bb} ", "Qual deles? "] {
            assert!(asks(q), "{q}");
        }
        for not in ["O PR passou.", "Tem três PRs abertos: quer ver? Te mostro depois.", "Pronto!", "", "Abri o PR?."] {
            assert!(!asks(not), "{not}");
        }
    }

    #[test]
    fn whispers_words_for_no_speech_are_known() {
        for noise in ["Legendas pela comunidade Amara.org", "Inscreva-se no canal!", "Obrigado por assistir.", "Thank you for watching!"] {
            assert!(no_speech(noise), "{noise}");
        }
        // A dot, and sounds.
        for noise in [".", "", "...", "Ah!", "Aaaahhhhhhh.", "Hmm...", "É...", "Ahn, hum."] {
            assert!(no_speech(noise), "{noise}");
        }
        for said in ["Abre o canal do mnemo no Discord.", "Legendas", "Obrigado.", "Desculpa.", "Uhum.", "Aham.", "Ah, abre o PR."] {
            assert!(!no_speech(said), "{said}");
        }
    }

    #[test]
    fn a_take_without_the_name_is_unsure_with_little_confidence_or_only_whispers_prompt() {
        // Noise in the window, as whisper writes it.
        assert!(unsure("Uóter.", 0.0));
        assert!(unsure("Projetos.", 0.7));
        assert!(unsure("CI, PR, VS Code.", 0.9));
        assert!(unsure("Abre o PR 42.", 0.29));
        assert!(!unsure("Abre o PR 42.", 0.3));
        assert!(!unsure("Desculpa.", 0.44));
        assert!(!unsure("E o CI?", 0.9));
        // A project's name may answer "qual projeto?".
        assert!(!unsure("mnemo-desktop", 0.8));
        assert!(only_prompt("Projetos. Projetos.") && only_prompt("CI, PR, VS Code.") && !only_prompt("Abre o PR."));
    }

    #[test]
    fn a_sentence_whisper_says_again_is_said_once() {
        assert_eq!(collapse("Projetos. Projetos. Projetos. Projetos. Projetos."), "Projetos.");
        assert_eq!(collapse("E o CI? E o CI?"), "E o CI?");
        assert_eq!(collapse("Oi.  oi!"), "Oi.");
        for kept in ["Sim. Não. Sim.", "Abre o PR 42. E o CI?", "Abre o site.com.br agora.", "Projetos.com Projetos.com", "Quais PRs estão abertos", ""] {
            assert_eq!(collapse(kept), kept);
        }
    }

    #[test]
    fn a_request_reads_whole_once_whisper_closed_it_on_a_word_that_ends_one() {
        for done in ["abre o VS Code.", "E o CI?", "Quais PRs estão abertos no desktop?", "Roda os testes!", "O quê?", "Abre o PR 42.", "Por quê?", "abre \u{ab}o site\u{bb}.\u{201d} "] {
            assert!(whole(done), "{done:?}");
        }
        // Not closed, trailing off, on a comma, on a word that leads into more, or no speech.
        for more in ["quais PRs estão", "abre o,", "abre o PR do.", "Então...", "Abre o\u{2026}", "roda os testes e.", "Manda pra.", "E o que.", "Ah.", "", ".", "mnemo-desktop"] {
            assert!(!whole(more), "{more:?}");
        }
    }

    #[test]
    fn a_take_that_reads_whole_ends_without_its_join_and_speech_in_what_was_the_join_is_for_james() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        // A take is handed on sooner than talk ends.
        feed(&mut ears, &noise(0.62, 0.0005, 2), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        // Its transcript reads whole: it ends at `WHOLE_MS`, a breath after its pause.
        host.now.borrow_mut().whole = true;
        feed(&mut ears, &noise(0.24, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        feed(&mut ears, &noise(0.06, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled"]);
        host.now.borrow_mut().whole = false;
        // More said within what was the join: a take at once, with no name and no check.
        feed(&mut ears, &noise(0.5, 0.0005, 4), &host);
        feed(&mut ears, &tone(0.1, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled", "began Follow"]);
        assert_eq!(host.checks.borrow().len(), 1);

        // The cue plays as it ends, and hides what is said over it: its time is not the grace's.
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(0.62, 0.0005, 2), &host);
        host.now.borrow_mut().whole = true;
        feed(&mut ears, &noise(0.3, 0.0005, 3), &host);
        host.now.borrow_mut().whole = false;
        for piece in noise(0.5, 0.0005, 4).chunks(480) {
            ears.feed(piece, 0.03, &host);
        }
        feed(&mut ears, &noise(0.6, 0.0005, 5), &host);
        feed(&mut ears, &tone(0.1, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled", "began Follow"]);

        // Past it, the name is needed again.
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "Então eu falei".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        host.now.borrow_mut().pending = true;
        feed(&mut ears, &tone(1.5, 0.05), &host);
        host.now.borrow_mut().pending = false;
        feed(&mut ears, &noise(0.62, 0.0005, 2), &host);
        host.now.borrow_mut().whole = true;
        feed(&mut ears, &noise(0.3, 0.0005, 3), &host);
        host.now.borrow_mut().whole = false;
        assert_eq!(*host.said.borrow(), ["began Follow", "ended Follow", "settled"]);
        feed(&mut ears, &noise(0.85, 0.0005, 4), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Follow", "ended Follow", "settled"]);
        assert_eq!(host.checks.borrow().len(), 1, "checked for the name");

        // Read whole is no reason to end talk with no name: it ends at its own pause.
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "Então eu falei".into()));
        host.now.borrow_mut().whole = true;
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(0.62, 0.0005, 2), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 3), &host);
        assert!(host.said.borrow().is_empty(), "{:?}", host.said.borrow());
        assert_eq!(host.checks.borrow().len(), 1, "one utterance, its pause a breath");
    }

    #[test]
    fn a_greeting_alone_or_one_word_is_checked_again() {
        assert_eq!(verdict("Ei, James"), Verdict::Call);
        assert_eq!(verdict("Ei,"), Verdict::Unsure);
        assert_eq!(verdict("Bom dia"), Verdict::Unsure);
        assert_eq!(verdict(""), Verdict::Unsure);
        assert_eq!(verdict("Ja"), Verdict::Unsure);
        assert_eq!(verdict("Eu falei com"), Verdict::Not);
    }

    /// A host that writes down what the ears say, and hears in each check what `heard` says of the
    /// audio's length.
    #[derive(Default)]
    pub(crate) struct Notes {
        pub now: RefCell<Now>,
        pub said: RefCell<Vec<String>>,
        pub checks: RefCell<Vec<usize>>,
        pub heard: RefCell<Option<Box<dyn Fn(usize) -> String>>>,
        pub takes: RefCell<Vec<(usize, HeardVia)>>,
    }

    impl Host for Notes {
        fn now(&self) -> Now {
            *self.now.borrow()
        }
        fn check(&self, audio: &[f32]) -> String {
            self.checks.borrow_mut().push(audio.len());
            self.heard.borrow().as_ref().map(|h| h(audio.len())).unwrap_or_default()
        }
        fn began(&self, via: HeardVia) {
            self.said.borrow_mut().push(format!("began {via:?}"));
            if via == HeardVia::Follow {
                self.now.borrow_mut().waiting = false;
            }
        }
        fn ended(&self, audio: Vec<f32>, _rate: u32, via: HeardVia, _lead: usize) {
            self.said.borrow_mut().push(format!("ended {via:?}"));
            self.takes.borrow_mut().push((audio.len(), via));
        }
        fn resumed(&self) {
            self.said.borrow_mut().push("resumed".into());
        }
        fn settled(&self) {
            self.said.borrow_mut().push("settled".into());
        }
        fn dropped(&self) {
            self.said.borrow_mut().push("dropped".into());
        }
        fn closed(&self) {
            self.said.borrow_mut().push("closed".into());
            self.now.borrow_mut().waiting = false;
        }
    }

    const RATE: u32 = 16_000;

    fn noise(seconds: f32, amp: f32, seed: u32) -> Vec<f32> {
        let mut s = seed | 1;
        (0..(seconds * RATE as f32) as usize)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 17;
                s ^= s << 5;
                (s as f32 / u32::MAX as f32 - 0.5) * 2.0 * amp
            })
            .collect()
    }

    /// Speech enough for the gate: syllables of a 220 Hz tone at `amp`, 0.2 s each with 0.08 s
    /// between them, over the room's noise.
    fn tone(seconds: f32, amp: f32) -> Vec<f32> {
        let mut n = noise(seconds, 0.0005, 7);
        for (i, s) in n.iter_mut().enumerate() {
            let t = i as f32 / RATE as f32;
            if t % 0.28 < 0.2 {
                *s += amp * (2.0 * std::f32::consts::PI * 220.0 * t).sin();
            }
        }
        n
    }

    fn feed(ears: &mut Ears, audio: &[f32], host: &Notes) {
        for piece in audio.chunks(480) {
            ears.feed(piece, 0.0, host);
        }
    }

    #[test]
    fn the_room_alone_starts_nothing_and_a_fan_becomes_the_floor() {
        let host = Notes::default();
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(3.0, 0.001, 1), &host);
        assert!(host.checks.borrow().is_empty());
        // A fan comes on, four times as loud as the room: at most one utterance, and then it is
        // the room.
        feed(&mut ears, &noise(20.0, 0.004, 2), &host);
        assert!(host.checks.borrow().len() <= 2, "{:?}", host.checks.borrow());
        let before = host.checks.borrow().len();
        feed(&mut ears, &noise(10.0, 0.004, 3), &host);
        assert_eq!(host.checks.borrow().len(), before);
        // The name said over the fan: an utterance of its own, checked.
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre".into()));
        let fan = noise(1.5, 0.004, 4);
        let over: Vec<f32> = tone(1.5, 0.05).iter().zip(&fan).map(|(s, f)| s + f).collect();
        feed(&mut ears, &over, &host);
        assert_eq!(*host.said.borrow(), ["began Wake"]);
    }

    #[test]
    fn talk_that_never_says_the_name_is_checked_once_per_utterance_never_whole() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "Então eu falei pra ele que".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        // A minute of talk in three utterances, with pauses between them.
        for _ in 0..3 {
            feed(&mut ears, &tone(20.0, 0.05), &host);
            feed(&mut ears, &noise(1.0, 0.0005, 4), &host);
        }
        let checks = host.checks.borrow().clone();
        assert_eq!(checks.len(), 3, "{checks:?}");
        // Each check is of the utterance's first second and its preroll, never of all of it.
        for c in checks {
            assert!(c <= (RATE as usize * 13 / 10) + 320, "{c}");
        }
        assert!(host.said.borrow().is_empty(), "{:?}", host.said.borrow());
    }

    #[test]
    fn the_name_makes_a_take_that_ends_at_the_pause() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, quais".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(0.9, 0.05), &host);
        assert!(host.said.borrow().is_empty(), "not checked before a second of speech");
        feed(&mut ears, &tone(0.2, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake"], "listening while still talking");
        feed(&mut ears, &tone(2.0, 0.05), &host);
        // A breath does not end it.
        feed(&mut ears, &noise(0.4, 0.0005, 5), &host);
        feed(&mut ears, &tone(1.0, 0.05), &host);
        assert_eq!(host.said.borrow().len(), 1);
        feed(&mut ears, &noise(1.0, 0.0005, 6), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        let (len, _) = host.takes.borrow()[0];
        // The preroll, 4.5 s said with its breath, and the tail; never the pause.
        let secs = len as f32 / RATE as f32;
        assert!((4.5..5.1).contains(&secs), "{secs}");
        assert_eq!(host.checks.borrow().len(), 1);
    }

    #[test]
    fn a_greeting_heard_alone_is_checked_again_and_a_take_stops_at_thirty_seconds() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|len| if len < RATE as usize * 2 { "Ei,".into() } else { "Ei, James, olha".into() }));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(31.0, 0.05), &host);
        // Two checks before the take; what is said past its thirty seconds is another utterance,
        // never the take going on.
        assert!(host.checks.borrow()[1] >= RATE as usize * 2, "{:?}", host.checks.borrow());
        assert_eq!(host.said.borrow()[..3], ["began Wake", "ended Wake", "settled"]);
        let (len, _) = host.takes.borrow()[0];
        assert_eq!(len, RATE as usize * 30);
    }

    #[test]
    fn the_window_takes_what_is_said_in_it_and_closes_in_silence() {
        let host = Notes::default();
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        host.now.borrow_mut().waiting = true;
        feed(&mut ears, &noise(1.0, 0.0005, 2), &host);
        feed(&mut ears, &tone(0.1, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Follow"], "a take from its first syllable, no name, no check");
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Follow", "ended Follow"]);
        feed(&mut ears, &noise(1.0, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Follow", "ended Follow", "settled"]);
        assert!(host.checks.borrow().is_empty());

        // The window again, and nothing said in it.
        host.said.borrow_mut().clear();
        host.now.borrow_mut().waiting = true;
        feed(&mut ears, &noise(7.9, 0.0005, 4), &host);
        assert!(host.said.borrow().is_empty());
        feed(&mut ears, &noise(0.2, 0.0005, 5), &host);
        assert_eq!(*host.said.borrow(), ["closed"]);
        // Then only the name starts a take: checked at a second, and at its end since nothing
        // was made of it.
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 6), &host);
        assert_eq!(*host.said.borrow(), ["closed"]);
        assert_eq!(host.checks.borrow().len(), 2);
    }

    #[test]
    fn the_name_said_short_is_checked_at_its_end() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James.".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        // Over before the first check is due.
        feed(&mut ears, &tone(0.25, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 2), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        assert_eq!(host.checks.borrow().len(), 1);
    }

    #[test]
    fn the_windows_first_moments_are_still_james() {
        let host = Notes::default();
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        host.now.borrow_mut().waiting = true;
        // The room's echo of his last word as the window opens: checked for the name like any
        // sound, never a take of the window.
        feed(&mut ears, &tone(0.2, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 2), &host);
        assert!(host.said.borrow().is_empty(), "{:?}", host.said.borrow());
        assert_eq!(host.checks.borrow().len(), 1);
        // The window is still open for what is said after it.
        feed(&mut ears, &tone(0.5, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Follow"]);
    }

    #[test]
    fn the_key_wins_over_a_take_under_way() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        host.now.borrow_mut().blocked = true;
        feed(&mut ears, &tone(1.0, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 2), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "dropped"]);
        // While it is held nothing is checked at all.
        feed(&mut ears, &tone(3.0, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 3), &host);
        assert_eq!(host.checks.borrow().len(), 1);
        assert!(host.takes.borrow().is_empty());
        // Nor is the window's: dictation records while it is open.
        host.now.borrow_mut().waiting = true;
        feed(&mut ears, &noise(0.5, 0.0005, 4), &host);
        feed(&mut ears, &tone(1.0, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "dropped"]);
    }

    #[test]
    fn a_breath_after_the_name_and_the_request_are_one_take() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James.".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        // The name, then a breath past the pause: handed on, and still open.
        feed(&mut ears, &tone(0.25, 0.05), &host);
        feed(&mut ears, &noise(1.55, 0.0005, 2), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        // The request, inside the join: the same take goes on, with no check.
        feed(&mut ears, &tone(1.5, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "resumed"]);
        feed(&mut ears, &noise(1.0, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "resumed", "ended Wake"]);
        feed(&mut ears, &noise(1.0, 0.0005, 4), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "resumed", "ended Wake", "settled"]);
        assert_eq!(host.checks.borrow().len(), 1);
        // Handed on again, it is all of it: the preroll, the name, the breath, the request, the tail.
        let takes = host.takes.borrow();
        let secs = |i: usize| takes[i].0 as f32 / RATE as f32;
        assert!((0.55..0.7).contains(&secs(0)), "{}", secs(0));
        assert!((secs(0) + 3.0..secs(0) + 3.2).contains(&secs(1)), "{}", secs(1));
    }

    #[test]
    fn a_pause_past_the_join_ends_the_take_and_a_click_in_it_does_not_go_on_with_it() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre o PR.".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(0.8, 0.0005, 2), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        // A click, shorter than an onset, and a hum over the room's floor but under the gate that
        // starts an utterance.
        feed(&mut ears, &tone(0.04, 0.05), &host);
        feed(&mut ears, &noise(0.2, 0.0005, 3), &host);
        feed(&mut ears, &tone(0.4, 0.0025), &host);
        feed(&mut ears, &noise(0.2, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake"]);
        feed(&mut ears, &noise(0.1, 0.0005, 4), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled"]);
        // What is said next is an utterance of its own, checked for the name, its first syllable
        // kept with what came before it.
        feed(&mut ears, &tone(1.5, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled", "began Wake"]);
        assert_eq!(host.checks.borrow().len(), 2);
        assert!(host.checks.borrow()[1] >= RATE as usize * 23 / 20, "{:?}", host.checks.borrow());

        // Speech back just past the join is not the take going on either.
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "Então eu falei".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        host.now.borrow_mut().waiting = true;
        feed(&mut ears, &noise(0.5, 0.0005, 2), &host);
        feed(&mut ears, &tone(1.0, 0.05), &host);
        feed(&mut ears, &noise(1.75, 0.0005, 3), &host);
        feed(&mut ears, &tone(1.0, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Follow", "ended Follow", "settled"]);
    }

    #[test]
    fn speech_back_as_short_as_an_onset_goes_on_with_the_take() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre o PR.".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.0, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 2), &host);
        // A syllable no longer than an onset: the take goes on, and it is in it.
        feed(&mut ears, &tone(0.08, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "resumed"]);
        feed(&mut ears, &noise(0.1, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "resumed"], "a breath after it is no pause");
        feed(&mut ears, &noise(0.7, 0.0005, 4), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "resumed", "ended Wake"]);
        let takes = host.takes.borrow();
        let longer = (takes[1].0 - takes[0].0) as f32 / RATE as f32;
        assert!((1.05..1.12).contains(&longer), "{longer}");
    }

    #[test]
    fn the_key_in_the_join_ends_the_take() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, abre".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(0.8, 0.0005, 2), &host);
        host.now.borrow_mut().blocked = true;
        feed(&mut ears, &noise(0.02, 0.0005, 3), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled"]);
        // What is said into the key is its own take.
        feed(&mut ears, &tone(1.0, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 4), &host);
        assert_eq!(*host.said.borrow(), ["began Wake", "ended Wake", "settled"]);
        assert_eq!(host.checks.borrow().len(), 1);
    }

    #[test]
    fn what_is_said_while_a_take_is_transcribed_needs_no_name() {
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "Então eu falei".into()));
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        host.now.borrow_mut().pending = true;
        feed(&mut ears, &tone(0.1, 0.05), &host);
        assert_eq!(*host.said.borrow(), ["began Follow"], "a take from its first syllable");
        feed(&mut ears, &tone(1.0, 0.05), &host);
        feed(&mut ears, &noise(1.8, 0.0005, 2), &host);
        assert_eq!(*host.said.borrow(), ["began Follow", "ended Follow", "settled"]);
        assert!(host.checks.borrow().is_empty());

        // Over James, only his name; and nothing while the key is held.
        host.said.borrow_mut().clear();
        host.now.borrow_mut().speaking = true;
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 3), &host);
        assert!(host.said.borrow().is_empty(), "{:?}", host.said.borrow());
        assert_eq!(host.checks.borrow().len(), 1);
        *host.now.borrow_mut() = Now { pending: true, blocked: true, ..Now::default() };
        feed(&mut ears, &tone(1.5, 0.05), &host);
        feed(&mut ears, &noise(1.0, 0.0005, 4), &host);
        assert!(host.said.borrow().is_empty(), "{:?}", host.said.borrow());
        assert_eq!(host.checks.borrow().len(), 1);
    }

    /// James's voice through the speakers: what the speaker was fed, and the microphone hearing
    /// it at `gain`, 40 ms late, with someone else's `over` added.
    fn on_speakers(ears: &mut Ears, fed: &[f32], gain: f32, over: &[f32], host: &Notes) {
        let delay = RATE as usize * 40 / 1000;
        let piece = 160;
        for (i, out) in fed.chunks(piece).enumerate() {
            let at = i * piece;
            let mic: Vec<f32> = (at..at + out.len())
                .map(|j| gain * j.checked_sub(delay).and_then(|k| fed.get(k)).copied().unwrap_or(0.0) + over.get(j).copied().unwrap_or(0.0))
                .collect();
            ears.feed(&mic, rms(out), host);
        }
    }

    #[test]
    fn his_own_voice_on_speakers_starts_nothing_and_someone_louder_is_heard() {
        // James's reply: syllables of tone with short gaps, as a voice comes.
        let mut reply = vec![];
        for _ in 0..12 {
            reply.extend(tone(0.25, 0.08));
            reply.extend(vec![0.0; RATE as usize / 10]);
        }
        let host = Notes::default();
        *host.heard.borrow_mut() = Some(Box::new(|_| "James, para".into()));
        host.now.borrow_mut().speaking = true;
        let mut ears = Ears::new(RATE, 8_000);
        feed(&mut ears, &noise(0.5, 0.0005, 1), &host);
        on_speakers(&mut ears, &reply, 0.5, &[], &host);
        assert!(host.checks.borrow().len() <= 1, "his voice is learnt as his: {:?}", host.checks.borrow());
        let learnt = host.checks.borrow().len();
        assert!(host.said.borrow().len() <= 1);
        host.said.borrow_mut().clear();

        // Someone talks over him, three times as loud as he reaches the microphone.
        let mut over = vec![0.0; RATE as usize / 2];
        over.extend(tone(1.5, 0.12));
        on_speakers(&mut ears, &reply, 0.5, &over, &host);
        assert_eq!(host.checks.borrow().len(), learnt + 1);
        assert_eq!(host.said.borrow().first().map(String::as_str), Some("began Wake"));
    }
}

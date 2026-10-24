//! Hands-free listening end to end (`wake.rs`), over audio Piper spoke for these tests
//! (`fixtures/voice/wake-*.wav`, made by `make_fixtures`) and whisper's own decoding.

use std::path::{Path, PathBuf};

use super::*;

/// The fixtures, and what Piper was asked to say in each. Piper's PT-BR voice reads "James" as
/// Portuguese ("jâmes"); spelt "Djêims" it says the name as the maintainer does.
const FIXTURES: &[(&str, &str)] = &[
    ("wake-start", "Djêims, quais PRs estão abertos no desktop?"),
    ("wake-fala", "Fala, Djêims, o CI do mnemo passou?"),
    ("wake-middle", "Eu falei com o Djêims ontem sobre o projeto."),
    ("wake-misheard", "Guêims, abre o VS Code no mnemo."),
    ("wake-follow", "E quais estão abertos no site?"),
    ("wake-goodbye", "Valeu, Djêims."),
    ("wake-interrupt", "Djêims, espera, e o CI do desktop?"),
    ("wake-reply", "O PR quarenta e dois passou em todas as verificações, e o CI do desktop está verde."),
    ("wake-talk", "Então eu falei pra ele que o projeto ia atrasar, mas ninguém me ouviu. Depois a gente almoçou e voltou pro trabalho."),
];

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/voice")
}

/// Piper saying `text` at 16 kHz.
fn piper_say(piper: &mut speech::Piper, rate: u32, text: &str) -> Vec<f32> {
    let mut samples = vec![];
    piper
        .say(text, &mut |p| {
            samples.extend_from_slice(p);
            true
        })
        .unwrap();
    voice::resample(&samples, rate, voice::WHISPER_RATE)
}

/// Writes the fixtures, 16 kHz mono 16-bit, with Piper's voice (fetched when missing):
/// `cargo test --lib jarvis_voice::wake_tests::make_fixtures -- --ignored`.
#[test]
#[ignore]
fn make_fixtures() {
    let files = speech::ensure_files(None).unwrap();
    let mut piper = speech::Piper::new(&files);
    let spec = hound::WavSpec { channels: 1, sample_rate: voice::WHISPER_RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    for (name, text) in FIXTURES {
        let audio = piper_say(&mut piper, files.rate, text);
        let mut w = hound::WavWriter::create(fixtures_dir().join(format!("{name}.wav")), spec).unwrap();
        for s in audio {
            w.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap();
        }
        w.finalize().unwrap();
    }
}

/// What whisper makes of spellings of the name, Piper speaking them: the base model (the tests')
/// and `MNEMO_JARVIS_MODEL`, a check and a whole take each. `MNEMO_JARVIS_PROBE`: sentences to
/// try, `;` between them, instead of the spellings.
/// `cargo test --release --lib jarvis_voice::wake_tests::probe -- --ignored --nocapture`.
#[test]
#[ignore]
fn probe() {
    let files = speech::ensure_files(None).unwrap();
    let mut piper = speech::Piper::new(&files);
    let mut models = vec![voice::test_model()];
    if let Some(m) = std::env::var_os("MNEMO_JARVIS_MODEL") {
        models.push(PathBuf::from(m));
    }
    let prompt = hear::prompt(&[]);
    let texts: Vec<String> = match std::env::var("MNEMO_JARVIS_PROBE") {
        Ok(t) => t.split(';').map(str::to_string).collect(),
        Err(_) => ["James", "Djeims", "Djêims", "Dgêims", "Jêimes", "Jeims"].iter().map(|n| format!("{n}, quais PRs estão abertos no desktop?")).collect(),
    };
    for model in models {
        let ctx = voice::load_context(&model).unwrap();
        eprintln!("== {}", model.display());
        for text in &texts {
            let name = text;
            let audio = piper_say(&mut piper, files.rate, &text);
            let head = &audio[..audio.len().min(voice::WHISPER_RATE as usize * 13 / 10)];
            let t = std::time::Instant::now();
            let checked = hear::head(&ctx, head, &prompt).unwrap();
            let check_ms = t.elapsed().as_millis();
            let (whole, _) = hear::hear(&ctx, &audio, &prompt).unwrap();
            eprintln!("{name:>8}: check {check_ms} ms {checked:?} -> {:?}; whole {whole:?}", wake::call(&checked));
        }
    }
}

// ---------------------------------------------------------------------------------------
// The tests

use std::sync::atomic::AtomicUsize;

/// Whisper's base model, as the other voice tests have it, with Jarvis's prompt; a speaker that
/// plays into a buffer.
struct Whisper {
    ctx: WhisperContext,
    prompt: String,
    dictating: Arc<AtomicBool>,
    checks: Arc<AtomicUsize>,
}

impl Backend for Whisper {
    fn warm(&self) {}
    fn hear(&self, take: &Captured) -> Result<(String, f32), String> {
        hear::hear(&self.ctx, &hear::to_whisper(&take.samples, take.rate), &self.prompt)
    }
    fn hear_until(&self, take: &Captured, stop: &Arc<AtomicBool>) -> Result<(String, f32), String> {
        hear::hear_until(&self.ctx, &hear::to_whisper(&take.samples, take.rate), &self.prompt, stop)
    }
    fn check(&self, audio: &[f32]) -> Result<String, String> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        hear::head(&self.ctx, audio, &self.prompt)
    }
    fn dictating(&self) -> bool {
        self.dictating.load(Ordering::SeqCst)
    }
    fn speaker(
        &self,
        held: Arc<AtomicBool>,
        on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<speech::Speaker, String> {
        speech::Speaker::start(22_050, held, speech::tests::fake_synth(), speech::tests::fake_output(Arc::default()), on_speaking, on_error)
    }
}

struct Rig {
    voice: Arc<JarvisVoice>,
    events: Arc<Mutex<Vec<Event>>>,
    dictating: Arc<AtomicBool>,
    checks: Arc<AtomicUsize>,
    _one: std::sync::MutexGuard<'static, ()>,
}

const RATE: usize = voice::WHISPER_RATE as usize;

fn rig(follow_ms: u64) -> Rig {
    rig_with(follow_ms, |v| v)
}

fn rig_with(follow_ms: u64, more: impl FnOnce(JarvisVoice) -> JarvisVoice) -> Rig {
    // Whisper runs for one test at a time (`voice::whisper_turn`), this one's for all of it.
    let one = voice::whisper_turn();
    let events = Arc::new(Mutex::new(vec![]));
    let into = events.clone();
    let (dictating, checks) = (Arc::new(AtomicBool::new(false)), Arc::new(AtomicUsize::new(0)));
    let backend = Whisper {
        ctx: voice::load_context(&voice::test_model()).expect("model"),
        prompt: hear::prompt(&[]),
        dictating: dictating.clone(),
        checks: checks.clone(),
    };
    let voice = more(JarvisVoice::new(Box::new(backend), Arc::new(move |e| lock(&into).push(e))).follow(follow_ms));
    Rig { voice: Arc::new(voice), events, dictating, checks, _one: one }
}

fn fixture(name: &str) -> Vec<f32> {
    hear::wav(&fixtures_dir().join(format!("{name}.wav")))
}

/// The room: noise far under speech. Two seconds of it after a take end it and its join.
fn room(seconds: f32) -> Vec<f32> {
    let mut s = 0x9e37_79b9u32;
    (0..(seconds * RATE as f32) as usize)
        .map(|_| {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            (s as f32 / u32::MAX as f32 - 0.5) * 0.001
        })
        .collect()
}

impl Rig {
    /// Hands-free on without a microphone: the test feeds the ears itself.
    fn ears(&self) -> (wake::Ears, Wired) {
        self.voice.phases.update(|f| f.hands_free = true);
        let wired = Wired { voice: self.voice.clone(), era: self.voice.era.load(Ordering::SeqCst) };
        (wake::Ears::new(RATE as u32, self.voice.follow_ms), wired)
    }

    /// Feeds `audio` in 10 ms pieces, the speaker silent; where in it `listening` was first said.
    fn play(&self, ears: &mut wake::Ears, wired: &Wired, audio: &[f32]) -> Option<usize> {
        self.on_speakers(ears, wired, &[], 0.0, audio)
    }

    /// Feeds what the microphone hears while the speaker plays `fed`, until James is hushed: it
    /// at `gain`, 40 ms late, and `over` on top. Where in it `listening` was first said.
    fn on_speakers(&self, ears: &mut wake::Ears, wired: &Wired, fed: &[f32], gain: f32, over: &[f32]) -> Option<usize> {
        let (delay, piece) = (RATE * 40 / 1000, RATE / 100);
        let before = self.phases().iter().filter(|p| **p == VoicePhase::Listening).count();
        let hushes = self.voice.hushes.load(Ordering::SeqCst);
        let mut fed = fed;
        let mut at = None;
        for start in (0..fed.len().max(over.len())).step_by(piece) {
            let end = start + piece;
            if self.voice.hushes.load(Ordering::SeqCst) > hushes {
                fed = &fed[..start.min(fed.len())];
            }
            let mic: Vec<f32> = (start..end)
                .map(|j| gain * j.checked_sub(delay).and_then(|k| fed.get(k)).copied().unwrap_or(0.0) + over.get(j).copied().unwrap_or(0.0))
                .collect();
            let out = voice::rms(fed.get(start.min(fed.len())..end.min(fed.len())).unwrap_or(&[]));
            ears.feed(&mic, out, wired);
            if at.is_none() && self.phases().iter().filter(|p| **p == VoicePhase::Listening).count() > before {
                at = Some(start);
            }
        }
        at
    }

    fn phases(&self) -> Vec<VoicePhase> {
        lock(&self.events).iter().filter_map(|e| if let Event::Phase(p) = e { Some(*p) } else { None }).collect()
    }

    fn heard(&self) -> Vec<Heard> {
        lock(&self.events).iter().filter_map(|e| if let Event::Heard(h) = e { Some(h.clone()) } else { None }).collect()
    }

    fn levels(&self) -> Vec<VoiceLevel> {
        lock(&self.events).iter().filter_map(|e| if let Event::Level(l) = e { Some(*l) } else { None }).collect()
    }

    fn until(&self, what: &str, done: impl Fn(&Rig) -> bool) {
        // Long: a transcription on a CI runner of few cores can take most of a minute.
        let deadline = Instant::now() + Duration::from_secs(180);
        while !done(self) {
            assert!(Instant::now() < deadline, "{what}: {:?}", said(&self.events));
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    /// Until no take is being transcribed.
    fn settled(&self) {
        self.until("transcribed", |r| lock(&r.voice.phases.flags).transcribing == 0);
    }

    /// James asks something and falls silent by himself: the window opens.
    fn james_speaks(&self) {
        let n = self.phases().len();
        self.voice.say("Tem três PRs abertos. Quer ver algum?").unwrap();
        self.until("the window", |r| r.phases()[n..].contains(&VoicePhase::Waiting));
    }
}

fn said(events: &Mutex<Vec<Event>>) -> Vec<Event> {
    lock(events).iter().filter(|e| !matches!(e, Event::Level(_))).cloned().collect()
}

#[test]
fn the_name_at_the_start_is_a_take_seen_while_still_talking() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    let audio = fixture("wake-start");
    let at = r.play(&mut ears, &wired, &audio).expect("listening");
    // Speech starts 0.2 s in and runs 2.6 s: `listening` came while it went on, at its second.
    assert!(at < RATE * 3 / 2, "listening {:.2} s in", at as f32 / RATE as f32);
    assert_eq!(r.heard(), vec![], "nothing heard before the take ends");
    r.play(&mut ears, &wired, &room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    let h = &r.heard()[0];
    assert_eq!(h.via, HeardVia::Wake);
    assert!(h.text.contains("abertos") && !h.text.to_lowercase().contains("james"), "{h:?}");
    r.settled();
    assert_eq!(r.phases(), [VoicePhase::Listening, VoicePhase::Transcribing, VoicePhase::Idle]);
    assert_eq!(r.checks.load(Ordering::SeqCst), 1, "one check, of its start");
}

#[test]
fn the_name_after_a_greeting_is_a_take_and_in_the_middle_is_not() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    r.play(&mut ears, &wired, &fixture("wake-middle"));
    r.play(&mut ears, &wired, &room(2.0));
    assert!(r.phases().is_empty(), "the name in the middle is not a call: {:?}", r.phases());
    assert!(r.checks.load(Ordering::SeqCst) <= 2);

    assert!(r.play(&mut ears, &wired, &fixture("wake-fala")).is_some());
    r.play(&mut ears, &wired, &room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    let h = &r.heard()[0];
    assert!(h.via == HeardVia::Wake && h.text.contains("passou") && !h.text.to_lowercase().starts_with("fala"), "{h:?}");
}

#[test]
fn a_misheard_name_counts() {
    // Piper says the name so that whisper writes "Games", as it did live.
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    assert!(r.play(&mut ears, &wired, &fixture("wake-misheard")).is_some(), "{:?}", said(&r.events));
    r.play(&mut ears, &wired, &room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    assert!(r.heard()[0].text.contains("VS Code"), "{:?}", r.heard());
}

#[test]
fn the_window_opens_after_james_speaks_takes_a_sentence_and_closes_in_silence() {
    let r = rig(2_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    r.james_speaks();
    let at = r.play(&mut ears, &wired, &room(0.5).into_iter().chain(fixture("wake-follow")).collect::<Vec<_>>());
    // A take from its first syllable: speech starts 0.7 s into what was played.
    assert!(at.is_some_and(|at| at < RATE * 9 / 10), "{at:?}");
    r.play(&mut ears, &wired, &room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    assert_eq!(r.heard()[0].via, HeardVia::Follow);
    assert!(r.heard()[0].text.contains("site"), "{:?}", r.heard());
    assert_eq!(r.checks.load(Ordering::SeqCst), 0, "no name needed");
    r.settled();
    // Nothing said back: no window.
    assert_eq!(r.phases().last(), Some(&VoicePhase::Idle));

    // He answers, and nothing is said: the window closes, and then only the name is a call.
    r.james_speaks();
    r.play(&mut ears, &wired, &room(1.9));
    assert_eq!(r.phases().last(), Some(&VoicePhase::Waiting));
    r.play(&mut ears, &wired, &room(0.2));
    assert_eq!(r.phases().last(), Some(&VoicePhase::Idle));
    r.play(&mut ears, &wired, &fixture("wake-follow"));
    r.play(&mut ears, &wired, &room(2.0));
    r.settled();
    assert_eq!(r.heard().len(), 1);
}

/// `audio` cut at the start of its `nth` pause (from 1): 40 ms or more between words, under a
/// tenth of their level.
fn at_pause(audio: &[f32], nth: usize) -> (&[f32], &[f32]) {
    let frame = RATE / 50;
    let voiced: Vec<bool> = audio.chunks(frame).map(|f| voice::rms(f) > 0.03).collect();
    let mut at = voiced.iter().position(|&v| v).expect("speech");
    for _ in 0..nth {
        at += voiced[at..].windows(2).position(|w| w.iter().all(|v| !v)).expect("a pause");
        if voiced[at..].iter().any(|&v| v) {
            at += voiced[at..].iter().position(|&v| v).unwrap();
        }
    }
    let quiet = voiced[..at].iter().rposition(|&v| v).expect("speech") + 1;
    audio.split_at(quiet * frame)
}

#[test]
fn a_breath_after_the_name_is_the_same_take() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    let audio = fixture("wake-start");
    let (start, rest) = at_pause(&audio, 3);
    // "Djêims, quais PRs estão", a breath of a second, and "abertos no desktop?".
    r.play(&mut ears, &wired, &start.iter().copied().chain(room(1.0)).chain(rest.iter().copied()).collect::<Vec<_>>());
    r.play(&mut ears, &wired, &room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    r.settled();
    let h = &r.heard();
    assert_eq!(h.len(), 1, "{h:?}");
    assert!(h[0].via == HeardVia::Wake && h[0].text.contains("PRs") && h[0].text.contains("abertos"), "{h:?}");
    // What was made of the first part was given up, and that is no error.
    assert!(!said(&r.events).iter().any(|e| matches!(e, Event::Error(_))), "{:?}", said(&r.events));
}

#[test]
fn a_transcript_no_longer_wanted_is_given_up() {
    let _one = voice::whisper_turn();
    // The app's own backend, on the tests' model.
    let local = Local::new(Config { whisper: Some(voice::test_model()), ..Config::default() });
    let take = Captured { samples: fixture("wake-start"), rate: RATE as u32 };
    // Whisper looks at the flag once the audio is encoded, and at each token after: the encoding
    // is the cost of a transcript given up.
    let (text, _) = local.hear_until(&take, &Arc::default()).expect("heard");
    assert!(text.contains("abertos"), "{text}");
    assert!(local.hear_until(&take, &Arc::new(AtomicBool::new(true))).is_err());
}

#[test]
fn what_is_said_while_a_take_is_transcribed_needs_no_name() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    let audio = fixture("wake-start");
    let (start, rest) = at_pause(&audio, 3);
    // A pause past the join, and more said before the take is transcribed: the test plays faster
    // than whisper hears. Said after the name alone, it would be the request.
    r.play(&mut ears, &wired, &start.iter().copied().chain(room(2.5)).chain(rest.iter().copied()).collect::<Vec<_>>());
    r.play(&mut ears, &wired, &room(2.0));
    r.settled();
    let h = &r.heard();
    assert_eq!(h.len(), 2, "{:?}", said(&r.events));
    assert!(h[0].via == HeardVia::Wake && h[1].via == HeardVia::Follow && h[1].text.contains("abertos"), "{h:?}");
}

#[test]
fn a_goodbye_in_the_window_ends_the_conversation() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    r.james_speaks();
    r.play(&mut ears, &wired, &room(0.5));
    assert!(r.play(&mut ears, &wired, &fixture("wake-goodbye")).is_some());
    r.play(&mut ears, &wired, &room(2.0));
    r.settled();
    assert_eq!(r.heard(), vec![], "a goodbye is no take");
    assert_eq!(r.phases().last(), Some(&VoicePhase::Idle));
    assert!(!lock(&r.voice.phases.flags).waiting);
}

#[test]
fn the_name_while_james_speaks_hushes_him_and_his_own_voice_starts_nothing() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    // He speaks on the speakers, and the microphone hears him a third as loud.
    r.voice.phases.update(|f| f.speaking = true);
    let reply = fixture("wake-reply");
    r.on_speakers(&mut ears, &wired, &reply, 0.3, &room(reply.len() as f32 / RATE as f32));
    r.play(&mut ears, &wired, &room(2.0));
    assert_eq!(r.voice.hushes.load(Ordering::SeqCst), 0);
    assert!(!r.phases().contains(&VoicePhase::Listening), "{:?}", r.phases());

    // Someone says his name over him.
    let mut over = room(0.5);
    over.extend(fixture("wake-interrupt"));
    assert!(r.on_speakers(&mut ears, &wired, &reply, 0.3, &over).is_some(), "{:?}", said(&r.events));
    assert_eq!(r.voice.hushes.load(Ordering::SeqCst), 1, "hushed, as by jarvis_hush");
    r.play(&mut ears, &wired, &room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    let h = &r.heard()[0];
    assert!(h.via == HeardVia::Wake && h.text.contains("desktop"), "{h:?}");
}

#[test]
fn the_key_wins_over_hands_free() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.play(&mut ears, &wired, &room(0.5));
    let audio = fixture("wake-start");
    let half = RATE * 8 / 5;
    assert!(r.play(&mut ears, &wired, &audio[..half]).is_some());
    // The key goes down partway: the hands-free take is dropped, and the key's is the take.
    let silent: voice::Input = Box::new(|sink: voice::Sink| {
        sink.push(&vec![0.0f32; 4_800], 1, usize::MAX);
        Ok(voice::Opened { keep: Box::new(()), rate: 48_000, device: "test mic".into(), watch: None })
    });
    r.voice.press(silent, None).unwrap();
    r.play(&mut ears, &wired, &audio[half..]);
    r.play(&mut ears, &wired, &room(2.0));
    assert!(!lock(&r.voice.phases.flags).taking);
    let take = r.voice.release().expect("the key's take");
    r.voice.finish(take);
    r.settled();
    assert_eq!(r.heard(), vec![], "nothing hands-free, and nothing said in the key's take");
    assert_eq!(r.phases(), [VoicePhase::Listening, VoicePhase::Transcribing, VoicePhase::Idle]);
}

#[test]
fn dictation_takes_the_microphone_from_hands_free() {
    let r = rig(8_000);
    let (mut ears, wired) = r.ears();
    r.dictating.store(true, Ordering::SeqCst);
    r.play(&mut ears, &wired, &room(0.5));
    r.play(&mut ears, &wired, &fixture("wake-start"));
    r.play(&mut ears, &wired, &room(2.0));
    assert_eq!(r.checks.load(Ordering::SeqCst), 0);
    assert!(r.phases().is_empty());
}

/// A microphone the test speaks into: what it was handed, and how often it was opened and closed.
#[derive(Clone, Default)]
struct TestMic {
    sink: Arc<Mutex<Option<voice::Sink>>>,
    opened: Arc<AtomicUsize>,
    closed: Arc<AtomicUsize>,
}

impl TestMic {
    fn input(&self) -> voice::Input {
        let me = self.clone();
        Box::new(move |sink| {
            *lock(&me.sink) = Some(sink);
            me.opened.fetch_add(1, Ordering::SeqCst);
            struct Close(Arc<AtomicUsize>);
            impl Drop for Close {
                fn drop(&mut self) {
                    self.0.fetch_add(1, Ordering::SeqCst);
                }
            }
            Ok(voice::Opened { keep: Box::new(Close(me.closed.clone())), rate: RATE as u32, device: "test mic".into(), watch: None })
        })
    }

    fn say(&self, audio: &[f32]) {
        let sink = lock(&self.sink).clone().expect("open");
        for piece in audio.chunks(RATE / 100) {
            sink.push(piece, 1, usize::MAX);
        }
    }
}

#[test]
fn jarvis_listen_turns_hands_free_on_and_off() {
    let mic = TestMic::default();
    let opens = mic.clone();
    let r = rig_with(8_000, move |v| v.mic(move || opens.input()));
    assert_eq!(r.voice.listen(None), Ok(false), "off until turned on");
    assert_eq!(r.voice.listen(Some(true)), Ok(true));
    assert_eq!(r.voice.listen(Some(true)), Ok(true));
    assert_eq!(r.voice.listen(None), Ok(true));
    assert_eq!(mic.opened.load(Ordering::SeqCst), 1);

    mic.say(&room(0.5));
    mic.say(&fixture("wake-start"));
    mic.say(&room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    assert_eq!(r.heard()[0].via, HeardVia::Wake);

    assert_eq!(r.voice.listen(Some(false)), Ok(false));
    r.until("the microphone closed", |_| mic.closed.load(Ordering::SeqCst) == 1);
    assert_eq!(r.voice.listen(None), Ok(false));
    std::thread::sleep(Duration::from_millis(300));
    mic.say(&fixture("wake-start"));
    mic.say(&room(2.0));
    std::thread::sleep(Duration::from_millis(500));
    r.settled();
    assert_eq!(r.heard().len(), 1, "off hears nothing");
    drop(r);

    // A microphone that will not open is the command's error.
    let r = rig_with(8_000, |v| v.mic(|| Box::new(|_| Err("no microphone found".into()))));
    assert_eq!(r.voice.listen(Some(true)), Err("no microphone found".into()));
    assert_eq!(r.voice.listen(None), Ok(false));
}

/// A microphone opened as the system's default is now, watched as the app watches one
/// (`voice::Watch`): it sends a piece of a quiet room every 5 ms until it closes.
fn watched(default: &Arc<Mutex<String>>, opened: &Arc<AtomicUsize>) -> voice::Input {
    let (default, opened) = (default.clone(), opened.clone());
    Box::new(move |sink: voice::Sink| {
        opened.fetch_add(1, Ordering::SeqCst);
        let on = Arc::new(AtomicBool::new(true));
        let feeding = on.clone();
        std::thread::spawn(move || {
            while feeding.load(Ordering::SeqCst) {
                sink.push(&[0.0005f32; RATE / 200], 1, usize::MAX);
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        struct Close(Arc<AtomicBool>);
        impl Drop for Close {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let id = lock(&default).clone();
        let now = default.clone();
        let watch = voice::Watch { id, default: Box::new(move || Some(lock(&now).clone())) };
        Ok(voice::Opened { keep: Box::new(Close(on)), rate: RATE as u32, device: "test mic".into(), watch: Some(watch) })
    })
}

#[test]
fn hands_free_moves_to_a_new_default_microphone_and_a_held_key_stays() {
    let default = Arc::new(Mutex::new("headset".to_string()));
    let opened = Arc::new(AtomicUsize::new(0));
    let (d, o) = (default.clone(), opened.clone());
    let r = rig_with(8_000, move |v| v.mic(move || watched(&d, &o)));
    r.voice.listen(Some(true)).unwrap();
    *lock(&default) = "usb".into();
    r.until("opened again on the new default", |_| opened.load(Ordering::SeqCst) == 2);
    r.until("on again", |r| r.voice.listen(None) == Ok(true));
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(opened.load(Ordering::SeqCst), 2, "the new default is kept");
    r.voice.listen(Some(false)).unwrap();

    // The key's take stays on the microphone it began on.
    let held = Arc::new(AtomicUsize::new(0));
    r.voice.press(watched(&default, &held), None).unwrap();
    *lock(&default) = "headset".into();
    std::thread::sleep(Duration::from_millis(100));
    let take = r.voice.release().expect("a take");
    r.voice.finish(take);
    let events = lock(&r.events).clone();
    assert!(!events.iter().any(|e| matches!(e, Event::Error(_))), "{events:?}");
}

#[test]
fn a_lost_microphone_is_opened_again_and_one_that_never_opens_is_said() {
    let errors = |r: &Rig| lock(&r.events).iter().filter(|e| matches!(e, Event::Error(_))).count();
    let mic = TestMic::default();
    let opens = mic.clone();
    let r = rig_with(8_000, move |v| v.mic(move || opens.input()));
    r.voice.listen(Some(true)).unwrap();
    lock(&mic.sink).clone().unwrap().lose("the device was removed");
    r.until("opened again", |_| mic.opened.load(Ordering::SeqCst) == 2);
    r.until("on again", |r| r.voice.listen(None) == Ok(true));
    mic.say(&room(0.5));
    mic.say(&fixture("wake-start"));
    mic.say(&room(2.0));
    r.until("heard", |r| r.heard().len() == 1);
    assert_eq!(errors(&r), 0, "nothing to say: it listens as before");
    drop(r);

    // Unplugged for good: no microphone opens again, and that is said once the tries are over.
    let mic = TestMic::default();
    let (opens, tries) = (mic.clone(), Arc::new(AtomicUsize::new(0)));
    let counted = tries.clone();
    let r = rig_with(8_000, move |v| {
        v.mic(move || if counted.fetch_add(1, Ordering::SeqCst) == 0 { opens.input() } else { Box::new(|_| Err("no microphone found".into())) })
    });
    r.voice.listen(Some(true)).unwrap();
    lock(&mic.sink).clone().unwrap().lose("the device was removed");
    r.until("said", |r| errors(&r) == 1);
    assert_eq!(tries.load(Ordering::SeqCst), 1 + REOPEN_TRIES as usize);
    assert_eq!(r.voice.listen(None), Ok(false));
    assert!(matches!(&lock(&r.events).iter().find(|e| matches!(e, Event::Error(_))), Some(Event::Error(m)) if m.contains("the device was removed")));
    drop(r);

    // Turned off while it tries: it stays off.
    let mic = TestMic::default();
    let (opens, tries) = (mic.clone(), Arc::new(AtomicUsize::new(0)));
    let counted = tries.clone();
    let r = rig_with(8_000, move |v| {
        v.mic(move || if counted.fetch_add(1, Ordering::SeqCst) == 0 { opens.input() } else { Box::new(|_| Err("no microphone found".into())) })
    });
    r.voice.listen(Some(true)).unwrap();
    lock(&mic.sink).clone().unwrap().lose("the device was removed");
    r.until("a try", |_| tries.load(Ordering::SeqCst) >= 2);
    r.voice.listen(Some(false)).unwrap();
    let after = tries.load(Ordering::SeqCst);
    std::thread::sleep(REOPEN_EVERY * 4);
    assert!(tries.load(Ordering::SeqCst) <= after + 1, "it stopped trying");
    assert_eq!(r.voice.listen(None), Ok(false));
    assert_eq!(errors(&r), 0);
}

#[test]
fn no_levels_while_idle_and_the_microphones_while_waiting() {
    let mic = TestMic::default();
    let opens = mic.clone();
    let r = rig_with(8_000, move |v| v.mic(move || opens.input()));
    r.voice.listen(Some(true)).unwrap();
    mic.say(&room(0.5));
    mic.say(&fixture("wake-talk"));
    mic.say(&room(2.0));
    std::thread::sleep(Duration::from_millis(600));
    r.settled();
    assert!(r.phases().is_empty(), "talk without the name is no call: {:?}", r.phases());
    assert!(r.levels().is_empty(), "{:?}", r.levels());

    // The window opens: the microphone's level, and none of the speaker's.
    r.voice.phases.update(|f| f.waiting = true);
    mic.say(&fixture("wake-talk")[..RATE / 2]);
    r.until("levels", |r| r.levels().len() >= 3);
    assert!(r.levels().iter().all(|l| l.out == 0.0 && (0.0..=1.0).contains(&l.mic)), "{:?}", r.levels());
    r.voice.listen(Some(false)).unwrap();
    r.until("idle", |r| r.phases().last() == Some(&VoicePhase::Idle));
    let n = r.levels().len();
    std::thread::sleep(Duration::from_millis(200));
    assert!(r.levels().len() <= n + 1, "levels stop with idle");
}

// ---------------------------------------------------------------------------------------
// Live: the numbers the PR reports, on this machine, with Jarvis's own model and Piper.
// `cargo test --release --lib jarvis_voice::wake_tests::live_ -- --ignored --nocapture --test-threads 1`

/// A room the microphone hears in real time, 10 ms at a time: its noise, what the speaker plays
/// coming back at `ECHO_GAIN` 40 ms late, and what is said in it.
#[derive(Default)]
struct Room {
    echo: Mutex<std::collections::VecDeque<f32>>,
    said: Mutex<std::collections::VecDeque<f32>>,
    /// When the last thing said began to be heard.
    began: Mutex<Option<Instant>>,
}

/// James on the speakers, as loud at the microphone as -10 dB of what he is fed.
const ECHO_GAIN: f32 = 0.3;

impl Room {
    /// Says `audio` (16 kHz) into the room; returns once it has begun to be heard.
    fn say(&self, audio: &[f32]) -> Instant {
        *lock(&self.began) = None;
        lock(&self.said).extend(audio.iter().copied());
        loop {
            if let Some(t) = *lock(&self.began) {
                return t;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    /// A microphone on the room.
    fn mic(self: &Arc<Self>) -> voice::Input {
        let room = self.clone();
        Box::new(move |sink: voice::Sink| {
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = stop.clone();
            std::thread::spawn(move || {
                let noise = room_noise();
                let mut n = 0usize;
                let start = Instant::now();
                let mut pieces = 0u32;
                while !stopped.load(Ordering::SeqCst) {
                    let mut piece = vec![0f32; RATE / 100];
                    {
                        let (mut echo, mut said) = (lock(&room.echo), lock(&room.said));
                        if !said.is_empty() && lock(&room.began).is_none() {
                            *lock(&room.began) = Some(Instant::now());
                        }
                        for s in piece.iter_mut() {
                            *s = noise[n % noise.len()] + ECHO_GAIN * echo.pop_front().unwrap_or(0.0) + said.pop_front().unwrap_or(0.0);
                            n += 1;
                        }
                    }
                    sink.push(&piece, 1, usize::MAX);
                    pieces += 1;
                    // Paced against the clock, not the sleeps.
                    let due = start + Duration::from_millis(10 * pieces as u64);
                    std::thread::sleep(due.saturating_duration_since(Instant::now()));
                }
            });
            struct Stop(Arc<AtomicBool>);
            impl Drop for Stop {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::SeqCst);
                }
            }
            Ok(voice::Opened { keep: Box::new(Stop(stop)), rate: RATE as u32, device: "the room".into(), watch: None })
        })
    }

    /// A speaker into the room: pulls James's voice in real time and sends it back to the
    /// microphone, 40 ms late.
    fn speaker(self: &Arc<Self>) -> speech::Output {
        let room = self.clone();
        Box::new(move |rate, shared| {
            lock(&room.echo).extend(std::iter::repeat(0.0).take(RATE * 40 / 1000));
            let stop = Arc::new(AtomicBool::new(false));
            let stopped = stop.clone();
            let room = room.clone();
            std::thread::spawn(move || {
                let per = rate as usize / 100;
                let start = Instant::now();
                let mut pieces = 0u32;
                while !stopped.load(Ordering::SeqCst) {
                    let mut out = vec![0f32; per];
                    shared.pull(&mut out, 1.0);
                    lock(&room.echo).extend(voice::resample(&out, rate, RATE as u32));
                    pieces += 1;
                    let due = start + Duration::from_millis(10 * pieces as u64);
                    std::thread::sleep(due.saturating_duration_since(Instant::now()));
                }
            });
            struct Stop(Arc<AtomicBool>);
            impl Drop for Stop {
                fn drop(&mut self) {
                    self.0.store(true, Ordering::SeqCst);
                }
            }
            Ok(Box::new(Stop(stop)) as Box<dyn std::any::Any>)
        })
    }
}

/// A second of a quiet room, looped.
fn room_noise() -> Vec<f32> {
    room(1.0)
}

/// Jarvis's voice on this machine, its speaker into `room`.
struct InRoom {
    local: Local,
    room: Arc<Room>,
}

impl Backend for InRoom {
    fn warm(&self) {
        self.local.warm()
    }
    fn hear(&self, take: &Captured) -> Result<(String, f32), String> {
        let heard = self.local.hear(take);
        eprintln!("  whole take of {:.2} s: {heard:?}", take.samples.len() as f32 / take.rate as f32);
        heard
    }
    fn done(&self) {
        self.local.done()
    }
    fn check(&self, audio: &[f32]) -> Result<String, String> {
        let started = Instant::now();
        let heard = self.local.check(audio);
        // The test's own output: the app never writes what it heard.
        eprintln!("  check of {:.2} s in {} ms: {heard:?}", audio.len() as f32 / RATE as f32, started.elapsed().as_millis());
        heard
    }
    fn load(&self) -> Result<(), String> {
        self.local.load()
    }
    fn speaker(
        &self,
        held: Arc<AtomicBool>,
        on_speaking: Arc<dyn Fn(bool) + Send + Sync>,
        on_error: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<speech::Speaker, String> {
        let files = speech::ensure_files(None)?;
        let piper = speech::Piper::new(&files);
        speech::Speaker::start(files.rate, held, piper.into_synth(), self.room.speaker(), on_speaking, on_error)
    }
}

type Stamped = Arc<Mutex<Vec<(Instant, Event)>>>;

/// The voice in `room`, hands-free on, its events stamped; once the model has loaded.
fn live_voice(room: &Arc<Room>) -> (Arc<JarvisVoice>, Stamped) {
    let events: Stamped = Arc::default();
    let into = events.clone();
    let backend = InRoom { local: Local::new(Config::default()), room: room.clone() };
    backend.load().unwrap();
    let mic = room.clone();
    let voice = Arc::new(JarvisVoice::new(Box::new(backend), Arc::new(move |e| lock(&into).push((Instant::now(), e)))).mic(move || mic.mic()));
    voice.listen(Some(true)).unwrap();
    std::thread::sleep(Duration::from_secs(2));
    (voice, events)
}

/// When `what` happened at or after `since`, waiting up to 30 s for it.
fn when(events: &Stamped, since: Instant, what: impl Fn(&Event) -> bool) -> Option<(Instant, Event)> {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if let Some(found) = lock(events).iter().find(|(t, e)| *t >= since && what(e)).cloned() {
            return Some(found);
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    None
}

/// Where speech starts and ends in `audio`, in seconds.
fn speech_in(audio: &[f32]) -> (f32, f32) {
    let frame = RATE / 50;
    let voiced: Vec<bool> = audio.chunks(frame).map(|f| voice::rms(f) > 0.004).collect();
    let first = voiced.iter().position(|&v| v).unwrap_or(0);
    let last = voiced.iter().rposition(|&v| v).unwrap_or(0);
    let s = |i: usize| (i * frame) as f32 / RATE as f32;
    (s(first), s(last + 1))
}

/// `to - from` in ms, negative when `to` came first.
fn ms_between(from: Instant, to: Instant) -> i64 {
    match to.checked_duration_since(from) {
        Some(d) => d.as_millis() as i64,
        None => -(from.duration_since(to).as_millis() as i64),
    }
}

#[cfg(windows)]
fn cpu_time() -> Duration {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    let zero = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
    let (mut a, mut b, mut kernel, mut user) = (zero, zero, zero, zero);
    // SAFETY: this process's pseudo-handle, and four FILETIMEs to fill.
    unsafe { GetProcessTimes(GetCurrentProcess(), &mut a, &mut b, &mut kernel, &mut user) };
    let ticks = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
    Duration::from_nanos((ticks(kernel) + ticks(user)) * 100)
}

#[cfg(not(windows))]
fn cpu_time() -> Duration {
    Duration::ZERO
}

/// This process's CPU over `secs` of `run`, in percent of one core.
fn cpu_over(secs: u64, run: impl FnOnce()) -> f32 {
    let (wall, cpu) = (Instant::now(), cpu_time());
    run();
    let (wall, cpu) = (wall.elapsed(), cpu_time() - cpu);
    assert!(wall >= Duration::from_secs(secs));
    100.0 * cpu.as_secs_f32() / wall.as_secs_f32()
}

#[test]
#[ignore]
fn live_latency() {
    let room = Arc::new(Room::default());
    let (_voice, events) = live_voice(&room);
    let files = speech::ensure_files(None).unwrap();
    let mut piper = speech::Piper::new(&files);
    // Each request, and what of it comes up to the name and with it: Piper saying that alone
    // says where the name ends.
    for (text, lead) in [
        ("Djêims, quais PRs estão abertos no desktop?", "Djêims."),
        ("Djêims, o CI do PR quinhentos e vinte passou?", "Djêims."),
        ("Fala, Djêims, abre o VS Code no mnemo.", "Fala, Djêims."),
        ("Djêims, o que tem no log do mnemo desde ontem?", "Djêims."),
        ("Ei Djêims, quantas issues abertas tem o site?", "Ei Djêims."),
        ("Djêims, roda os testes do desktop e me diz se passou.", "Djêims."),
    ] {
        let audio = piper_say(&mut piper, files.rate, text);
        let (start, end) = speech_in(&audio);
        let name_end = speech_in(&piper_say(&mut piper, files.rate, lead)).1;
        let began = room.say(&audio);
        let at = |s: f32| began + Duration::from_secs_f32(s);
        let listening = when(&events, began, |e| *e == Event::Phase(VoicePhase::Listening)).map(|(t, _)| t);
        let heard = when(&events, began, |e| matches!(e, Event::Heard(_)));
        let ms = |t: Option<Instant>, from: Instant| t.map_or("never".into(), |t| format!("{} ms", ms_between(from, t)));
        eprintln!(
            "speech {start:.2}-{end:.2} s, name ends {name_end:.2} s | name -> listening {} | end of speech -> heard {} | {:?}",
            ms(listening, at(name_end)),
            ms(heard.as_ref().map(|(t, _)| *t), at(end)),
            heard.map(|(_, e)| e)
        );
        std::thread::sleep(Duration::from_secs(1));
    }
}

#[test]
#[ignore]
fn live_idle_cpu() {
    let room = Arc::new(Room::default());
    let (voice, events) = live_voice(&room);
    let files = speech::ensure_files(None).unwrap();
    let mut piper = speech::Piper::new(&files);
    let silence = cpu_over(60, || std::thread::sleep(Duration::from_secs(60)));
    // Someone talking nearby for a minute, never saying the name: sentences with pauses between.
    let lines = [
        "Então eu falei pra ele que o projeto ia atrasar, mas ninguém me ouviu.",
        "Depois a gente almoçou e voltou pro trabalho, e a reunião durou a tarde inteira.",
        "Amanhã eu passo no mercado e compro o que falta pra semana.",
        "O jogo de ontem foi bom, mas o juiz errou bastante no segundo tempo.",
    ];
    let mut talk = vec![];
    while talk.len() < RATE * 62 {
        for line in lines {
            talk.extend(piper_say(&mut piper, files.rate, line));
            talk.extend(vec![0.0; RATE * 6 / 10]);
        }
    }
    talk.truncate(RATE * 60);
    let checks_before = lock(&events).len();
    let talking = cpu_over(60, || {
        room.say(&talk);
        std::thread::sleep(Duration::from_secs(60));
    });
    let phases: Vec<_> = lock(&events)[checks_before..].iter().filter(|(_, e)| matches!(e, Event::Phase(_))).map(|(_, e)| e.clone()).collect();
    eprintln!("hands-free idle, {} threads: silence {silence:.2}% of a core, talk without the name {talking:.2}%; phases during talk {phases:?}", num_threads());
    voice.listen(Some(false)).unwrap();
}

/// The same on the default microphone, as the app has it: whatever the room is.
#[test]
#[ignore]
fn live_idle_cpu_on_the_microphone() {
    let events: Stamped = Arc::default();
    let into = events.clone();
    let local = Local::new(Config::default());
    local.load().unwrap();
    let voice = Arc::new(JarvisVoice::new(Box::new(local), Arc::new(move |e| lock(&into).push((Instant::now(), e)))));
    voice.listen(Some(true)).unwrap();
    std::thread::sleep(Duration::from_secs(2));
    let cpu = cpu_over(60, || std::thread::sleep(Duration::from_secs(60)));
    let phases = lock(&events).iter().filter(|(_, e)| matches!(e, Event::Phase(_))).count();
    eprintln!("hands-free on the default microphone, 60 s: {cpu:.2}% of a core; {phases} phase changes");
    voice.listen(Some(false)).unwrap();
}

/// What a name check costs with Jarvis's model, by threads: wall time and CPU time per check,
/// over the start of a sentence with no name.
#[test]
#[ignore]
fn live_check_cost() {
    let model = hear::fetch(None).unwrap();
    let ctx = voice::load_context(&model).unwrap();
    let prompt = hear::prompt(&[]);
    let audio = &fixture("wake-talk")[..RATE * 122 / 100];
    for threads in [2, 4, 6, 8] {
        let shape = voice::Shape { prompt: Some(&prompt), threads: Some(threads), head: Some(6), stop: None };
        let _ = voice::transcribe_scored(&ctx, audio, voice::Language::Pt, &shape);
        let (wall, cpu) = (Instant::now(), cpu_time());
        for _ in 0..10 {
            voice::transcribe_scored(&ctx, audio, voice::Language::Pt, &shape).unwrap();
        }
        let (wall, cpu) = (wall.elapsed() / 10, (cpu_time() - cpu) / 10);
        eprintln!("{threads} threads: {} ms a check, {} ms of CPU (audio_ctx {})", wall.as_millis(), cpu.as_millis(), voice::audio_ctx(RATE * 3 / 2));
    }
}

fn num_threads() -> usize {
    std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0)
}

/// Five turns, James answering each through speakers the microphone hears: no take may start in
/// his own voice.
#[test]
#[ignore]
fn live_conversation_on_speakers() {
    let room = Arc::new(Room::default());
    let (voice, events) = live_voice(&room);
    let files = speech::ensure_files(None).unwrap();
    let mut piper = speech::Piper::new(&files);
    // The two before a turn in the window ask something: only a question opens it.
    let replies = [
        "Tem três PRs abertos no desktop. O quinhentos e vinte e três é o mais novo. Quer ver o CI de algum?",
        "O CI do quinhentos e vinte passou nos três sistemas. Quer que eu abra o PR?",
        "Abri o PR quinhentos e vinte no navegador. Está na sua tela agora.",
        "O log do mnemo tem quatro commits desde ontem, todos do mantenedor, sobre o painel.",
    ];
    let turns: [(&str, Option<HeardVia>); 5] = [
        ("Djêims, quais PRs estão abertos no desktop?", Some(HeardVia::Wake)),
        ("E o CI do PR quinhentos e vinte?", Some(HeardVia::Follow)),
        ("Abre ele no navegador.", Some(HeardVia::Follow)),
        ("Djêims, o que tem no log do mnemo desde ontem?", Some(HeardVia::Wake)),
        ("Valeu, Djêims.", None),
    ];
    let mut replies = replies.iter();
    for (i, (line, via)) in turns.iter().enumerate() {
        // The fourth turn waits out the window: the name is needed again.
        let wait = if i == 3 { 9_000 } else { 700 };
        std::thread::sleep(Duration::from_millis(wait));
        let phase = lock(&events).iter().rev().find_map(|(_, e)| if let Event::Phase(p) = e { Some(*p) } else { None });
        let began = room.say(&piper_say(&mut piper, files.rate, line));
        match via {
            Some(via) => {
                let (_, e) = when(&events, began, |e| matches!(e, Event::Heard(_))).expect("heard");
                let Event::Heard(h) = e else { unreachable!() };
                eprintln!("turn {} (phase before: {phase:?}): heard {:?} via {:?}", i + 1, h.text, h.via);
                assert_eq!(h.via, *via);
                let reply = replies.next().unwrap();
                let speaking_from = Instant::now();
                voice.say(reply).unwrap();
                when(&events, speaking_from, |e| *e == Event::Phase(VoicePhase::Speaking)).expect("speaking");
                let silent = if wake::asks(reply) { VoicePhase::Waiting } else { VoicePhase::Idle };
                let (t, _) = when(&events, speaking_from, |e| *e == Event::Phase(silent)).expect("silent");
                let during: Vec<_> = lock(&events).iter().filter(|(at, e)| *at >= speaking_from && *at < t && !matches!(e, Event::Level(_))).map(|(_, e)| e.clone()).collect();
                eprintln!("  James spoke {:.1} s: {:?}", t.duration_since(speaking_from).as_secs_f32(), during);
                assert!(!during.contains(&Event::Phase(VoicePhase::Listening)), "a take started in his own voice");
            }
            None => {
                std::thread::sleep(Duration::from_secs(5));
                let after: Vec<_> = lock(&events).iter().filter(|(t, e)| *t >= began && !matches!(e, Event::Level(_))).map(|(_, e)| e.clone()).collect();
                eprintln!("turn {} (phase before: {phase:?}): {after:?}", i + 1);
            }
        }
    }
    let heard = lock(&events).iter().filter(|(_, e)| matches!(e, Event::Heard(_))).count();
    assert_eq!(heard, 4, "four takes, and the goodbye none");
    assert_eq!(lock(&events).iter().rev().find_map(|(_, e)| if let Event::Phase(p) = e { Some(*p) } else { None }), Some(VoicePhase::Idle));
    voice.listen(Some(false)).unwrap();
}

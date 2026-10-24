---
feature: jarvis-hands-free
created: 2026-10-24
verdict: parallel
---

James without the push-to-talk key (#503, #506). The maintainer asked for this after the first
live test: "trocar ideia com ele sem precisar ficar fazendo push to talk, simplesmente chamando
ele", in a voice-only view rather than a chat, with Siri as the inspiration. They answered three
questions:
- the name is just "James";
- they use both headphones and speakers;
- Claude may be the brain, which is the jarvis-brain contract, in review beside this one.

Read #503 first. Everything heard stays on this machine: whisper is local, and only a take (an
utterance that began with James's name, or came in the follow-up window) reaches the brain.

**The seam is PR #523, stacked on #522, which is stacked on #521. Your branch starts on it;
build on it, do not move it.** In `src/jarvis/client.ts`:
- `VoicePhase` gains `waiting`: the follow-up window is open.
- `Heard` gains `via: 'key' | 'wake' | 'follow'`. Absent means the key.
- `jarvis://level` is `VoiceLevel { mic, out }`, each 0–1, some 20 a second while not `idle`.
- `jarvis_listen(enabled: Option<bool>) -> Result<bool, String>` turns hands-free on or off, or with
  none only reads it.

`docs/jarvis.example.json`'s `voice` gains `"wake": { "followMs": 8000 }` and `"orb": true`.
`client.test.ts` pins the names.

**Rules.** Windows first. CI stays green on all three OSes, where a piece may answer "not on this
OS" with a clear error.
- Public text never names a private repository (`~/mnemo/.mnemo/private-names.tsv`; the hook
  enforces it).
- No real recording, transcript or request in a fixture: generate them, e.g. with Piper, which
  the app already ships.
- Every process starts through `proc.rs`, and the home dir is read through `app_dir::home()`.
- Build in your own target, `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-jarvis-<piece>`.
- Before your first push, `git fetch`, then rebase: onto `origin/main` once #523 has landed
  there, onto `origin/jarvis/hands-free` until then. Your PR targets main; until #523 lands, its
  diff shows the seam's commits too.
- A piece that changes what is on screen shows it through an isolated dev instance, and its PR
  says what was seen.
- Never stop the maintainer's own llama-server on port 8091, nor the installed app.

The two pieces share only `src-tauri/src/lib.rs`, where each adds its own `// -- jarvis <piece> --`
blocks, and may land in either order; whoever lands second rebases. The live check of both
together comes after they land: a spoken conversation, hands-free, on speakers, then on headphones.

## wake

- **files:** src-tauri/src/jarvis_voice.rs, src-tauri/src/jarvis_voice/*, src-tauri/src/voice.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/fixtures/voice/*
- **exposes:** `jarvis_listen(enabled: Option<bool>) -> Result<bool, String>`, `event jarvis://voice: VoicePhase`, `event jarvis://heard: Heard { text: String, confidence: f32, window: Option<String>, via: HeardVia }`, `event jarvis://level: VoiceLevel { mic: f32, out: f32 }`
- **consumes:** nothing
- **effort:** high

Hands-free listening, decided with the maintainer:

1. **On and off.**
   - With the config's `voice.wake` set (`true`, or `{ "followMs": n }`), hands-free starts on
     at launch. Without it, it is off until `jarvis_listen(Some(true))`.
   - `jarvis_listen` changes it for this run only, and stops or starts the microphone.
   - The push-to-talk key works as it does now, either way. While it is held, hands-free hears
     nothing.
2. **The name.** An utterance is a take when it begins with "James", allowing a word before it
   ("ei", "ô", "fala"). Whisper writes the name in other ways: "Games" and "Jaime" were seen
   live, and whisper's prompt already carries the name. Those count.
   - A take's text comes without the name.
   - The name in the middle of a sentence is not a call.
3. **Seen while still talking.** Once the name has been said, the phase is `listening` within
   about a second, while the maintainer is still talking: the orb appears then, not after the
   sentence. Measure this, from the name to `listening`.
4. **The end of a take** is the end of speech, a pause of under a second (measure what ends a
   sentence without cutting a breath), or 30 s at most. Then `transcribing`, then one
   `jarvis://heard` with `via: wake`.
5. **The follow-up window.** When James stops speaking, the phase is `waiting` for `followMs`
   (default 8000 ms). Whatever is said in that time is a take, with no name needed and
   `via: follow`.
   - Silence until the window ends goes back to `idle`, still listening for the name.
   - A take that gets no reply (nothing said back within the window) also ends in `idle`.
   - A goodbye in the window ("valeu, James", "obrigado, James", "tchau", "pode parar", "era só
     isso") ends the conversation: back to `idle`, and no take.
6. **Speakers without an echo canceller.** While James speaks, only an utterance that begins with
   his name counts. It hushes him (the same as `jarvis_hush`) and is a take: James never starts
   a reply with his own name, so his own voice through the speakers starts nothing. The window
   opens only after he stops.
7. **Levels.** `jarvis://level` carries the microphone's loudness while `listening` or `waiting`,
   and the speaker's while `speaking`, smoothed for an animation. None is sent while `idle`.
8. **Dictation** (`voice.rs`, ⌘E) works exactly as it does now. While it records, hands-free
   takes nothing.
9. **Cost.** Listening for the name runs all day. Measure, in the PR, the app's CPU while `idle`
   with hands-free on: in silence, and with someone talking nearby who never says the name.
   Name-checking must not decode whole utterances that never had the name.
10. **Nothing leaves the machine.** No audio and no text is written to disk or logged except what
    the voice logs now (timings, never words). Only takes become `jarvis://heard`.

**Tests**, over audio generated for them (Piper's voice, silence, noise):
- the name at the start, after "ei", and in the middle;
- a misheard name;
- the window opening after speech, taking a sentence, and closing in silence;
- a goodbye;
- the name during speech hushing James, and other speech then not counting;
- the key winning over hands-free;
- `jarvis_listen` on and off;
- no levels while `idle`.

**Live (Windows), in the PR:**
- latency from the name to `listening`, and from the end of speech to `jarvis://heard`;
- CPU while idle, in silence and with talk;
- a five-turn conversation on speakers, with no take started by James's own voice.

## orb

- **files:** src-tauri/src/jarvis_orb.rs, src-tauri/src/lib.rs, src-tauri/capabilities/*, src-tauri/tauri.conf.json, vite.config.ts, orb.html, src/jarvis/orb/*, src/jarvis/view.tsx
- **exposes:** `jarvis_orb(show: bool) -> Result<(), String>`
- **consumes:** `jarvis_listen(enabled: Option<bool>) -> Result<bool, String>` from wake, `event jarvis://level: VoiceLevel { mic: f32, out: f32 }` from wake

James on screen while a conversation is on, without the panel: a floating orb, inspired by Siri.

1. **Its own window**, made only when first shown:
   - transparent, frameless, always on top, with no taskbar entry;
   - **it never takes focus** and lets clicks through, so typing goes on in whatever was in
     front;
   - about 220 px, at the bottom centre of the monitor that holds the window in front, above the
     taskbar.
2. **It loads none of the app.** Its page is its own entry (`orb.html`), with none of the views,
   terminals or stores the main window starts.
3. **When it shows.** It appears while a conversation is on: the voice not `idle`, or James
   working on a request. It fades 1.5 s after both are over. It shows for takes by the key too.
   With the config's `voice.orb` set to `false` there is no orb, and the voice behaves as now.
4. **What it shows**, one look per state, moving with `jarvis://level`:
   - `listening`: alive with the microphone's level;
   - `transcribing` and thinking: a calm swirl;
   - `speaking`: moving with the speaker's level;
   - `waiting`: a slow breath.

   Under it, a short caption: what was heard, then what James is saying (the spoken text,
   `forSpeech`), fading. Draw it on a canvas or WebGL. Nothing animates while it is hidden.
5. **What it knows.** The voice's events reach every window. What only the main window knows
   (James working on a request, what was heard, what he said) goes from `view.tsx` to the orb as
   an event of the piece's own.
6. **The panel stays** for typing and the history. With the orb on, a take no longer opens the
   panel; the panel's chord and launcher do. A palette action, "James: hands-free on/off",
   calls `jarvis_listen`.

**Tests:**
- the show and hide rules over a sequence of phases and busy states, as a pure function;
- the caption's order and fade;
- the window builder's options (no focus, click-through, no taskbar, on top);
- the orb page loading nothing from the app's views;
- a take not opening the panel while the orb is on.

**Live (Windows), in the PR:**
- a recording or screenshots of each state;
- that typing in another app goes on while the orb shows;
- its CPU while shown and while hidden.

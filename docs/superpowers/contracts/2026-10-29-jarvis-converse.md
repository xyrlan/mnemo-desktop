---
feature: jarvis-converse
created: 2026-10-29
verdict: parallel
---

James as a partner to talk with (#503). The maintainer asked for this wave after resuming James:
an assistant that knows mnemo's workflow, the vault and the projects, answers questions of any
kind, searches the web when it needs a precise fact, and discusses and judges ideas. They kept
Kokoro for the voice, and kept Claude as the brain over a local model: a local model would answer
a second sooner and think much worse.

Read #503 first. The live tests of 2026-10-24 measured where the time goes, from the end of the
maintainer's speech to James's first sound, in the median:

| Step | Today |
|---|---|
| Silence before a hands-free take ends | 1.7 s (`PAUSE_MS` 700 + `JOIN_MS` 1000) |
| whisper, on the GPU | 0.25 s, during that silence |
| Claude's whole reply | 2.3 s (p90 4.9 s) |
| Kokoro's first sound | 0.27 s |

That comes to about 4.3 s hands-free. This wave aims for 2–2.5 s without making James think less.
- **brain-stream** and **speaker** start speaking while Claude still writes.
- **turn** ends a take sooner and lets the maintainer hear at once that they were heard.
- **situation** answers "como tá tudo?" with no tool call.
- **parent-report** closes the loop: on 2026-10-24 a parent reached its answer in under five
  minutes, and was closed before anyone heard it.

**The seam is the PR from `jarvis/converse`. Your branch starts on it; build on it, do not move
it.** The seam holds:
- In `src/jarvis/client.ts`: `brainStream`, which is
  `jarvis_brain_stream(system: String, text: String, on: Channel<String>) -> Result<String, String>`.
  The Rust stub in `jarvis_brain.rs` sends the whole reply once, when the turn ends.
- `src/jarvis/speaker.ts`, `src/jarvis/situation.ts` and `src/jarvis/parent/report.ts`. Their types
  and stubs keep today's behaviour.
- The loop wired to all three in `src/jarvis/loop.ts`:
  - one speaker per brain message, fed every piece;
  - `rest` said once the message is whole;
  - a newer request hushes the request being answered;
  - the panorama in the turn text when it changed;
  - a parent's report told to the brain, and said aloud for a parent asked for aloud.

  `loop.test.ts` pins the wiring with fakes (`conversing (jarvis-converse)`). `createJarvis` takes
  `situation`, `speaker` and `report` for that.
- `RULES` in `src/jarvis/routing.ts`, rewritten:
  - James knows mnemo's workflow;
  - he talks about anything;
  - he discusses ideas as an experienced colleague;
  - he may say up to about five sentences in a discussion;
  - he answers from the panorama when it is enough.

**Rules.**
- **Platform:** Windows first. CI stays green on all three OSes.
- **Public text:** never name a private repository (`~/mnemo/.mnemo/private-names.tsv`; the hook
  enforces it).
- **Fixtures:** no real recording, transcript, log row or request. Generate them, e.g. with
  Piper, which the app ships.
- **Processes and paths:** every process starts through `proc.rs`. The home dir is read through
  `app_dir::home()`.
- **Builds:** build in your own target,
  `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-jarvis-<piece>`, with `VULKAN_SDK` set
  (`C:/VulkanSDK/1.4.363.0` on the maintainer's machine; CI installs it).
- **Branches:**
  - Before your first push, `git fetch`, then rebase. Rebase onto `origin/main` once the seam has
    landed there; until then, rebase onto `origin/jarvis/converse`.
  - Your PR targets main. Until the seam and the stack under it (#521–#533) land, its diff shows
    their commits too.
- **Do not stop:** the maintainer's own llama-server on port 8091, the installed app, or any
  Claude session that is not yours.
- **Measuring:** a piece that changes what is heard or when measures it. Its PR says what was
  run and the numbers. A piece that changes what is on screen shows it through an isolated dev
  instance.

The pieces share no file. They may land in any order. The live check of the whole wave comes after
they land: a spoken conversation, hands-free, on speakers.

## brain-stream

- **files:** src-tauri/src/jarvis_brain.rs, src-tauri/src/jarvis_brain/tests.rs
- **exposes:** `jarvis_brain_stream(system: String, text: String, on: Channel<String>) -> Result<String, String>`
- **consumes:** nothing
- **effort:** medium

Claude's reply, sent on `on` in pieces, in order, as Claude writes it.
- **The pieces:** joined, they are exactly the string the command resolves with. That string is
  the turn's `result`, as `jarvis_brain_ask` returns it today.
- **What stays as it is:** `jarvis_brain_ask` keeps working, and both commands share the one
  conversation, as the module doc describes. The timeout, the errors and the restart of a dead
  process stay too.
- **The CLI:** it is Claude Code's, on the maintainer's subscription. The installed one is 2.1.312.
  Pin what you rely on in tests over recorded stream-json lines that you write yourself.
- **To measure and log:** the time to the first piece next to the existing "claude answered in".
  Report both, from the real CLI, in the PR.

## speaker

- **files:** src/jarvis/speaker.ts, src/jarvis/speaker.test.ts
- **exposes:** `createSpeaker(say: (sentence: string) => void): Speaker`
- **consumes:** `jarvis_brain_stream(system: String, text: String, on: Channel<String>) -> Result<String, String>` from brain-stream

The loop makes one speaker per brain message and hands it every piece. Read the loop's
`runClaude` and `meanwhile`, and `readReply` in `src/jarvis/brain.ts`.
- **When it speaks:** it says each sentence through `say` once the sentence is whole, as early as
  that can be known. Pieces split anywhere: mid-word, mid-number, mid-JSON.
- **The call is never said.** A tool call the brain writes after its words is a JSON object naming
  a `tool`, a fence before it, or Claude's own `<function_calls>`/`<invoke>` markup. Nothing from
  the call on is said, and nothing is said that later turns out to be part of one.
- **Sentence ends:** a period inside "7h38", "v2.1", "1.5", "PR 524." or "Sr." does not end a
  sentence wrongly.
- **What `rest(words)` returns:** what of `words` (the message's words as `readReply` read them)
  is still to be said, or '' when all of it was. Never a sentence twice. The loop says what
  `rest` returns, then ends there.
- **`say` and `forSpeech`:** `say` applies `forSpeech` and queues; the speaker hands it raw text.
- **Tests:** test over the same replies split at every position.

## situation

- **files:** src/jarvis/situation.ts, src/jarvis/situation.test.ts
- **exposes:** `createSituation(client: JarvisClient, now: () => number): Situation`
- **consumes:** nothing

The state of every known project, kept fresh in the background, so the brain answers "como tá
tudo?" and "tem algum filho rodando?" with no tool call.
- **What goes in:** what runs (the sessions, and the children mnemo dispatched), what waits (open
  PRs with their CI, open issues), and what needs the maintainer.
- **How it is read:** through the read tools `client.tool` already runs. Read their output in
  `src-tauri/src/jarvis_tools/`.
- **Size:** it goes into the conversation each time it changes, so keep it short: a few lines, a
  budget you state and test.
- **`changedAt`:** it changes only when `text` does, so an unchanged panorama is not sent again.
- **Refresh:** `refresh` never rejects. A tool that fails leaves its part out or marked unknown,
  never a stale part shown as current. `start` refreshes at once, then on a cadence you choose and
  justify against GitHub's rate limits. Its stop function stops it.

## parent-report

- **files:** src/jarvis/parent/report.ts, src/jarvis/parent/report.test.ts, src/jarvis/parent/follow.ts, src/jarvis/parent/follow.test.ts, src/jarvis/parent/parents.ts, src/jarvis/parent/parents.test.ts, src/jarvis/parent/fixtures.ts, src/jarvis/parent/index.ts
- **exposes:** `reportOf(e: ParentEvent): ParentReport | null`
- **consumes:** nothing

What James does when a parent he opened says something. The loop tells the brain `tell` with the
next request. For a parent asked for aloud, it says `say` at a quiet moment.
- **A turn that ended:** the maintainer hears the outcome in a sentence or two, without asking.
- **What the brain is told:** enough to answer "e aí, o que ele achou?". That is more than today's
  one-sentence `summary`. `ParentEvent` may carry the parent's last message for it, within a
  stated bound.
- **Asking or waiting for approval:** said aloud too, since only the maintainer can answer.
- **Exited:** told to the brain only.
- **Repeats:** an event that repeats one already reported is not said again.

## turn

- **files:** src-tauri/src/jarvis_voice.rs, src-tauri/src/jarvis_voice/wake.rs, src-tauri/src/jarvis_voice/wake_tests.rs, src-tauri/src/jarvis_voice/speech.rs, src-tauri/src/jarvis_voice/hear.rs, src-tauri/fixtures/voice/*, docs/jarvis.example.json
- **exposes:** `event jarvis://heard: Heard { text: String, confidence: f32, window: Option<String>, via: HeardVia }`
- **consumes:** nothing
- **effort:** high

The end of a turn, heard sooner, and the maintainer hearing that they were heard.

1. **Sooner.** A hands-free take ends 1.7 s after speech stops. That was set while whisper ran on
   the CPU and took 2.3 s in the median. Read `JOIN_MS`'s doc in `wake.rs`: it exists because a
   breath between the name and the request, or within a request, lost five requests in two
   minutes.
   - Bring the median from the end of speech to `jarvis://heard` under about a second.
   - Do not cut a breath within a request.
   - Measure both on generated speech with pauses of the lengths that matter.
2. **A cue.** When a take is heard and goes to the brain (a key take or a hands-free one, and not
   one dropped as junk), a short, soft sound plays at once. It is not speech, and it does not
   take the queue from what James says.
   - `voice.cue: false` in `jarvis.json` turns it off.
   - Document that key in `docs/jarvis.example.json`.

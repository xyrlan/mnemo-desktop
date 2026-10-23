---
feature: jarvis-b
created: 2026-10-23
verdict: parallel
---

Wave B of Jarvis (#503): steps 2–5 (#505–#508) built at once, against the seam that wave A put on
main. Read #503 and your step's issue first: their decisions are made, not open. The model is
picked (#504, #511): NVIDIA Nemotron 3.5 Bolt E4B under llama-server, reasoning on with
`--reasoning-budget 64`.

**The seam is on main; build on it, do not move it.**
- `src/jarvis/routing.ts`: James's name, tools, system prompt, request body and reply parsing,
  shared with `scripts/jarvis-bench.mjs`. A change here changes what the benchmark measured, so no
  piece edits it: one that needs to stops and says so.
- `src/jarvis/client.ts`: every command and event between the panel and Rust, by name and type.
  The Rust pieces implement exactly these; the panel calls only this client. `client.test.ts` pins
  the names.
- `src/jarvis/parent/index.ts`: `ParentsApi`, with a placeholder body that `parent` replaces.
- `src-tauri/src/jarvis.rs`: `jarvis.json` (`config`, `section`), the projects Jarvis knows
  (`projects() -> Vec<JarvisProject>`, `find(&[JarvisProject], &str) -> Option<&JarvisProject>`),
  and the local log.
- `docs/jarvis.example.json`: the config's shape. Each piece reads only its own section.
- `src-tauri/Cargo.toml` already has what this wave needs: `tauri-plugin-global-shortcut` (2.3;
  2.4 needs tauri 2.12), and windows-sys `Win32_Graphics_Gdi`, `Win32_System_JobObjects` and
  `Win32_UI_WindowsAndMessaging`. No piece adds a crate or a feature; one that needs to stops and
  says so.

**Shared files.** In `src-tauri/src/lib.rs` a piece adds only its own `// -- jarvis <piece> --`
module block and command block, after the seam's `jarvis` ones. Whoever lands second rebases. Every
process starts through `proc.rs`; the home dir is read through `app_dir::home()` (the convention
tests enforce both).

**This machine.** Windows 11, RTX 4070 Ti SUPER (16 GB), 128 GB RAM.
- Cargo finds libclang through `~/.cargo/config.toml`. Build in your own target,
  `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-jarvis-<piece>`; landing prunes it
  (`pnpm targets prune jarvis-<piece>`).
- `~/.cache/jarvis-bench/` holds llama.cpp b11756 (`llama/llama-server.exe`) and the model
  (`models/Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf`). The maintainer may have a llama-server of their own
  on port 8091: never stop it, and use another port.
- Run every llama-server with `-fa off`: flash attention crashes these runs on Windows
  (ggml-org/llama.cpp#30436).

**Rules.** Windows first; CI stays green on all three OSes, where a piece may answer "not on this
OS" with a clear error. Public text never names a private repository
(`~/mnemo/.mnemo/private-names.tsv`; the hook enforces it). No real transcript, request or
recording in a fixture. Before your first push, `git fetch && git rebase origin/main`. A piece that
changes what is on screen shows it through an isolated dev instance, and the PR says what was seen.

Landing order: `llm`, `tools`, `screen`, `apps`, `voice`, `parent`, then `panel`. The end-to-end
live check of #505 (a read, a delegation answered from an approval card, a follow-up) comes after
`panel` lands.

## llm

- **files:** src-tauri/src/jarvis_llm.rs, src-tauri/src/lib.rs
- **exposes:** `jarvis_llm_ensure(on: Channel<LlmSetup>) -> Result<(), String>`, `jarvis_llm_chat(body: serde_json::Value, on: Channel<serde_json::Value>) -> Result<(), String>`, `jarvis_llm_stop() -> ()`
- **consumes:** nothing
- **effort:** high

The local model, running. `LlmSetup` serializes exactly as `client.ts` types it, tagged by `kind`: `download {file, done,
total}`, `verifying {file}`, `starting`, `ready {vision}`.

- **Files.** Under `~/.mnemo-desktop/models/jarvis/` (`app_dir::shared_dir_in`, shared by the debug
  and release builds), each checked against its sha256 before first use; a partial download
  resumes:
  - `nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB` / `Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf`, 6180446208
    bytes, sha256 `5442bfb3b1384ff3774c9989e9457dad81bbb5830fbcf96adfdde40078831d5a`.
  - The vision projector, `unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF` / `mmproj-Q8_0.gguf`,
    559875776 bytes, sha256 `6e0602540b342560e0ec62b182e8ea3bf54cc8e352b5e912f20cbb7a847cf23d`.
    NVIDIA publishes no projector for this model; the PR says so. With it, the same model reads
    screenshots (#507), so no second vision model loads.
  - Windows only: llama.cpp b11756, `llama-b11756-bin-win-cuda-12.4-x64.zip`
    (sha256 `bfb275464b8ef633a12d96f454e5fcf2efc642d926043208ce95d33449dad0e0`) and
    `cudart-llama-bin-win-cuda-12.4-x64.zip`
    (sha256 `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6`), from
    `github.com/ggml-org/llama.cpp/releases/download/b11756/`. Elsewhere, `llama-server` comes from
    the config or the PATH, and its absence is a clear error.
  - The config's `model` section (`llamaServer`, `model`, `mmproj`; `~` is home) points at files
    already on disk and skips their download.
- **The server.** `--jinja -ngl 999 -c 16384 -fa off --reasoning-budget 64`, plus `--mmproj` when
  the projector is there; listening on 127.0.0.1 only, on a free port no one else learns. One
  server per app. It never outlives the app, a crash or a kill of the app included.
- **`jarvis_llm_chat`** POSTs `body` as given to `/v1/chat/completions` and streams every `data:`
  object back parsed, in order, until `[DONE]`; an HTTP error is the command's error.
- **Tests:** the download's resume and checksum refusal against a local stand-in server; the
  argument list; the stream reader over a canned SSE body. **Live (Windows):** ensure from the
  maintainer's files through the config, one chat, the server gone after the app is killed from
  Task Manager.

## tools

- **files:** src-tauri/src/jarvis_tools.rs, src-tauri/src/jarvis_tools/*, src-tauri/src/lib.rs, src-tauri/fixtures/jarvis/*
- **exposes:** `jarvis_tool(name: String, args: serde_json::Value) -> Result<String, String>`, `jarvis_focused_window() -> Option<String>`
- **consumes:** nothing
- **effort:** high

The read tools of #505 decision 1, exactly `READ_TOOLS` in `client.ts`, with the arguments
`TOOLS` declares in `routing.ts`. The returned text is for the model: at most 12 000 characters,
saying where it was cut.

- **The project** is resolved through `jarvis::projects()` and `jarvis::find`; an unknown one is an
  error that lists the known names. `gh_pr_list` and `list_sessions` without one cover every
  project.
- **Never a shell**, and nothing outside the closed set: `gh` only as `pr list`, `pr view`,
  `pr checks`, `run list`, `issue view`, with every argument built from validated values (a
  number is a number). A write subcommand is refused.
- **Paths** stay inside the project's root, `..` and links that leave it included.
- **Secrets are refused** even inside a project: `.env*`, `~/.ssh`, `*.pem`, `*.key`, credential
  files, the same list for reading, listing and search results.
- `read_briefings` reads `<vault>/bots/<project>/briefings/sessions/`; `query_rules` reads mnemo's
  rules for the project; `list_sessions` reads what the desktop already knows of running sessions.
- `jarvis_focused_window`: the title of the last window in front that was not this app, through
  the Windows API, never a screenshot; None on other OSes.
- **Tests:** the secret list, a path escape, the `gh` allowlist (a write refused), the cap, an
  unknown project. **Live (Windows):** each tool once against a real project, in the PR.

## screen

- **files:** src-tauri/src/jarvis_screen.rs, src-tauri/src/lib.rs
- **exposes:** `jarvis_screenshot() -> Result<String, String>`
- **consumes:** nothing
- **effort:** medium

The screen the maintainer is looking at (#507): the monitor holding the window in front, as a
`data:image/png;base64,…` or `data:image/bmp;base64,…` URL, at most 1600 px on its longer side.
Taken only when the command is called; held in memory and never written to disk or logged. Other
OSes return a clear error. **Tests:** the scaling and the encoding over a synthetic bitmap.
**Live (Windows):** one capture, its size and time in the PR.

## apps

- **files:** src-tauri/src/jarvis_apps.rs, src-tauri/src/lib.rs
- **exposes:** `jarvis_apps() -> Result<Vec<AppEntry>, String>`, `jarvis_open_app(app: String, project: Option<String>) -> Result<String, String>`, `jarvis_open_in_browser(project: String, page: String, number: Option<u64>) -> Result<String, String>`, `jarvis_open_url(url: String) -> Result<(), String>`
- **consumes:** nothing
- **effort:** medium

#508's decisions. `AppEntry` is `{ name, project }`. The config's `apps` section lists
`{ name, aliases?, exe, project? }`; an app is found by name or alias, ignoring case.

- An app not on the list is refused, with the list in the error.
- A project is the only parameter, only for an entry with `project: true`, and only a known
  project (`jarvis::find`), passed as its root. Nothing else reaches the command line.
- `jarvis_open_in_browser` builds the GitHub URL from the project's `origin` remote: `repo`,
  `pr` and `issue` (with a number), `actions`.
- `jarvis_open_url`: `http` and `https` only, in the default browser (`browser.rs` already
  refuses the rest).
- **Tests:** the refusals of #508, an alias, the URL building. **Live (Windows):** VS Code on a
  project, a PR page.

## voice

- **files:** src-tauri/src/jarvis_voice.rs, src-tauri/src/jarvis_voice/*, src-tauri/src/voice.rs, src-tauri/src/lib.rs, src-tauri/capabilities/default.json, src-tauri/fixtures/voice/*
- **exposes:** `jarvis_say(text: String) -> Result<(), String>`, `jarvis_hush() -> ()`, `event jarvis://voice: VoicePhase`, `event jarvis://heard: Heard { text: String, confidence: f32, window: Option<String> }`
- **consumes:** nothing
- **effort:** high

#506's decisions.

- **The key.** A global push-to-talk key (the config's `voice.key`, a default when absent) that
  works with the app unfocused or minimized, through the global-shortcut plugin. It is not
  dictation's key, and it never types into a terminal. Held: listening; released: transcribing,
  then one `jarvis://heard`.
- **Speech in** is whisper.cpp in Portuguese. `voice.rs` is dictation's: share its capture and
  model code without changing what dictation does. Dictation's `base` model is weak in
  Portuguese: pick the model for Jarvis on measured accuracy and latency, and say what was
  measured. `confidence` comes from the decoder's own probabilities.
- `window` is the title of the window in front when the key went down.
- **Speech out** is Piper with a PT-BR voice, local, its files downloaded and checked like
  `llm`'s. Queued; never while the key is held; `jarvis_hush` drops the queue.
- `jarvis://voice` reports `idle`, `listening`, `transcribing` and `speaking` as they change.
- **Tests** over synthetic audio: the key routes to Jarvis, not to dictation; speech waits while
  the key is held; confidence is in 0–1. **Live (Windows):** latency from key release to
  `jarvis://heard`, and from `jarvis_say` to the first sound.

## parent

- **files:** src/jarvis/parent/*, src/nexus/drawer/open.ts, src/nexus/drawer/start.ts, src/nexus/drawer/open.test.ts, src/nexus/drawer/start.test.ts
- **exposes:** `createParents(): ParentsApi`, `handoff(request: string, gathered: string): string`
- **consumes:** nothing
- **effort:** high

`ParentsApi` as `src/jarvis/parent/index.ts` types it, for #505 decisions 3, 5 and 6.

- **Opening.** Open a parent the way *New session* does, in a drawer tab. It runs **never with
  `--dangerously-skip-permissions`**, whatever `settings.skipPermissions` says (it defaults to
  true): the parent's permission mode is the only guard between a misheard sentence and a write.
  The host is the request's, else the config's `host`, else Claude.
- **The handoff** is typed into it once its prompt is up, as one paste, in three marked parts:
  the request verbatim; what Jarvis gathered, labelled "gathered by Jarvis, may be wrong"; "you
  decide how to do this: yourself, or with `mnemo dispatch`".
- **Following.** On Windows there is no hook socket: follow through what the desktop already
  polls (`claude agents`) and the session's transcript. Emit `turn-ended` with one sentence on the
  last message, `asking`, `approval` and `exited`. Never report children.
- `answer` answers the parent's permission prompt from the desktop; `send` types a follow-up;
  `cancel` stops it.
- **Tests:** the handoff's three parts; skip-permissions forced off with the setting on;
  end-of-turn, a question and a waiting approval detected over synthetic transcript lines and
  `claude agents` rows. **Live (Windows):** a parent opened on a scratch repo, its approval
  answered through `answer`.

## panel

- **files:** src/jarvis/panel/*, src/jarvis/view.tsx, src/jarvis/loop.ts, src/jarvis/loop.test.ts, src/jarvis/store.ts, src/jarvis/store.test.ts, src/jarvis/infer.ts, src/jarvis/infer.test.ts, src/shell/mounts.test.ts, src/actions/chords.ts, src/actions/keys.test.ts
- **exposes:** nothing
- **consumes:** `createParents(): ParentsApi` from parent, `jarvis_llm_ensure(on: Channel<LlmSetup>) -> Result<(), String>` from llm, `jarvis_llm_chat(body: serde_json::Value, on: Channel<serde_json::Value>) -> Result<(), String>` from llm, `jarvis_tool(name: String, args: serde_json::Value) -> Result<String, String>` from tools, `jarvis_focused_window() -> Option<String>` from tools, `jarvis_screenshot() -> Result<String, String>` from screen, `jarvis_open_app(app: String, project: Option<String>) -> Result<String, String>` from apps, `jarvis_say(text: String) -> Result<(), String>` from voice, `event jarvis://heard: Heard { text: String, confidence: f32, window: Option<String> }` from voice
- **effort:** high

James on screen, and the loop that runs him. Everything goes through `tauriJarvis` and
`createParents()`; tests use a fake client.

- **The panel** opens and closes from an action with its own chord. It shows the conversation,
  the model's setup (the first download is about 7 GB), the running parents with their state, and
  a parent's waiting approval with allow and deny (`ParentsApi.answer`).
- **The loop.** A request (typed, or a `jarvis://heard`) goes to the model with `requestBody`
  (reasoning on), the projects and apps, and the current state (running parents, the focused
  window, the project of the last few minutes). Replies pass through `recoverBareCall`. A read
  tool's output goes back to the model for the answer, a few steps at most. James answers in
  short Portuguese sentences, spoken through `jarvis_say` when the request was spoken.
- **Routing** (#505–#508): `delegate_to_parent` opens a parent, or sends to the running one when
  the request follows up on it; `parent_status` reads it; `ask_user` shows the question and the
  next request answers it; `look_at_screen` sends the screenshot to the model with the question
  and keeps only the words; `open_*` go to `apps`. "cancela" right after a delegation cancels it.
- **Which project** (#505 decision 2): the one named (names and aliases), else the focused
  window's title, else the one of the last few minutes; none of them, or more than one, asks.
- **Safety:** a screenshot never enters a handoff, only its description, in the gathered part
  (#507). A heard request under the confidence threshold is repeated back as a question before
  anything acts (#506). No confirmation otherwise (#505 decision 4).
- Parent events become a line in the panel and, with the app unfocused, a notification
  (`agent_notify`). Every turn goes to the local log (`tauriJarvis.log`).
- **Tests:** project inference (named, window, recent, ambiguous); routing per tool, a follow-up
  going to the right parent; a screenshot kept out of the handoff; low confidence asking.

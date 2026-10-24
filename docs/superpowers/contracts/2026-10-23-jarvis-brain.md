---
feature: jarvis-brain
created: 2026-10-23
verdict: parallel
---

James's brain (#503), after the first live test. James heard well and his tools worked, but he
could not hold a conversation:
- he gave empty replies to opinions ("Tudo bem.", "Entendido.");
- he forgot the last sentence;
- he answered "Não" about a running child without asking `list_sessions`;
- he did not know the date;
- he read markdown, commit hashes and session ids aloud;
- he ran a read on the window's project while the model had asked for the project meant.

Part of that is the model. Bolt E4B was picked on a routing benchmark (#504, #511), which measured
tool choice, not conversation. Part is the loop, which sends every request alone.

This wave makes the brain swappable and fixes the loop. Read #503 first: James reads through a
closed tool set, never runs a shell, and every write goes to a parent that never skips its
permission prompts. None of that changes.

**The seam is on main; build on it, do not move it.**
- `src/jarvis/client.ts` holds three new commands and their docs:
  - `BrainConfig`;
  - `jarvis_brain() -> Result<BrainConfig, String>`;
  - `jarvis_brain_ask(system: String, text: String) -> Result<String, String>`;
  - `jarvis_brain_reset() -> ()`.

  `client.test.ts` pins their names.
- `src/jarvis/routing.ts` holds two things:
  - `RULES`: who James is and how he works, for whichever model plays him. It now includes the
    rules this test called for: never say how something stands without the tool that knows;
    "filho" means `list_sessions`; names arrive misheard; remember the conversation; give a
    real opinion; replies are spoken.
  - `listed(projects, apps)`: the projects and apps as the prompts list them.

  `systemPrompt` is `RULES` plus the local model's tool-calling line. No piece edits this file.
- `src/jarvis/speech.ts` holds `forSpeech(text)`: what is said aloud of a reply, with markdown,
  code, hashes, ids and addresses taken out, and the reply cut at a sentence past 320 characters.
- `docs/jarvis.example.json`'s `brain` section reads `{ "kind": "claude", "model": "sonnet",
  "effort": "low" }`. With no section, the brain is `local`. For `claude`, the model defaults
  to `sonnet` and the effort to `low`.

**What was measured** with a throwaway probe on this machine, Claude Code 2.1.310, on a long-lived
`claude -p --input-format stream-json --output-format stream-json` with no tools:
- **Haiku:** the first reply arrives in 2.2 s, about 1 s of which is the process starting. Each
  later turn takes 0.9–1.1 s.
- **Sonnet:** 2.5 s, then 1.2 s. One turn that thought reached 7.5 s.
- **Memory:** the second turn remembered the first.
- **`--json-schema`:** adds 1–2 s a turn. It forces a `StructuredOutput` tool and thinking, so
  Claude answers in words or with one JSON line instead.
- **`--system-prompt-file`:** works.
- **`claude agents`:** **lists such a process**, as an interactive session in its cwd.

**Rules.** Windows first. CI stays green on all three OSes.
- Public text never names a private repository (`~/mnemo/.mnemo/private-names.tsv`; the hook
  enforces it).
- No real transcript, request or log row in a fixture. James's log is private.
- Every process starts through `proc.rs`, and the home dir is read through `app_dir::home()`.
- Build in your own target, `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-jarvis-<piece>`.
- Before your first push, `git fetch && git rebase origin/main`.
- A piece that changes what is on screen shows it through an isolated dev instance, and its PR
  says what was seen.
- Never stop the maintainer's own llama-server on port 8091.

The two pieces touch no file in common and may land in either order. The live check of both
together comes after both land: the maintainer's real session is replayed through each brain,
side by side, locally.

## brain

- **files:** src-tauri/src/jarvis_brain.rs, src-tauri/src/jarvis_llm.rs, src-tauri/src/lib.rs, src-tauri/src/mission.rs, src-tauri/src/jarvis_tools.rs, src-tauri/src/jarvis_tools/mnemo.rs
- **exposes:** `jarvis_brain() -> Result<BrainConfig, String>`, `jarvis_brain_ask(system: String, text: String) -> Result<String, String>`, `jarvis_brain_reset() -> ()`
- **consumes:** nothing
- **effort:** high

Claude as James's brain, on the maintainer's own Claude subscription, through Claude Code's CLI.

- **Config.** `jarvis_brain` reads the config's `brain` section on every call:
  - no section means `local`;
  - `kind` is `local` or `claude`;
  - `model` and `effort` are taken as given, defaulting to `sonnet` and `low`;
  - anything else is an error that names `jarvis.json`.

  `BrainConfig` serializes exactly as `client.ts` types it, tagged by `kind`. A test pins this
  against `client.ts`, the way `jarvis_llm`'s `LlmSetup` test does.
- **One conversation per app.** The first ask starts it, and it lives across asks. Its memory is
  what makes later turns take about a second.
  - It restarts when `system`, the model or the effort differ from what it runs with.
  - `jarvis_brain_reset` ends it.
  - Asks run one at a time.
  - An ask with no result within 120 s ends the conversation and fails.
  - If the process dies, its last stderr lines are the error, and the next ask starts afresh.
  - It never outlives the app, the same way llama-server does not (`jarvis_llm`'s tie, shared,
    plus a stop on exit).
- **Nothing but words.** Claude gets:
  - no tool of its own (`--tools ""`);
  - no MCP server (`--strict-mcp-config`);
  - no hooks, plugins, skills or CLAUDE.md (`--safe-mode`);
  - no session saved (`--no-session-persistence`).

  So James's conversation reaches neither `claude --resume` nor mnemo's briefings. Its cwd is the
  app's own dir, never a project.
- **The subscription, not a key.** It runs on the active account when that is a Claude account,
  else on the default one (`CLAUDE_CONFIG_DIR` set or removed, as a pane's `on_account` does).
  `ANTHROPIC_API_KEY` is removed from its environment.
- **Not a session.** `claude agents` lists this process. It must never show:
  - as a session in the desktop's mission view;
  - in `list_sessions`'s output;
  - as a parent James could follow.
- `jarvis_brain_ask` resolves with the reply text of the turn's `result`. A `result` that is an
  error is the command's error.
- **Tests:**
  - the argument list and environment;
  - the config's defaults and refusals;
  - the stream reading over a fake `claude` (the `translate_tests` pattern in `mission.rs`):
    two asks on one process, a restart on a new `system`, a timeout, a crash's stderr;
  - the brain's process filtered out of a session list.

  **Live (Windows), in the PR:** two asks where the second remembers the first, with the time of
  each; a reset; the process gone after the app is killed from Task Manager; the mission view
  while a conversation runs.

## loop

- **files:** src/jarvis/brain.ts, src/jarvis/brain.test.ts, src/jarvis/loop.ts, src/jarvis/loop.test.ts, src/jarvis/store.ts, src/jarvis/store.test.ts, src/jarvis/panel/Panel.tsx, src/jarvis/panel/Panel.test.tsx, src/jarvis/panel/panel.css
- **exposes:** `createJarvis(deps: LoopDeps): Jarvis`
- **consumes:** `jarvis_brain() -> Result<BrainConfig, String>` from brain, `jarvis_brain_ask(system: String, text: String) -> Result<String, String>` from brain, `jarvis_brain_reset() -> ()` from brain
- **effort:** high

The loop, holding a conversation, with either brain behind it. Each decision below was made with
the maintainer.

1. **The brain is chosen per request** by `client.brain()`.
   - `local` is today's path: llama-server and OpenAI-style messages.
   - `claude` goes through `brainAsk`. With Claude, no request starts the local model, so it
     takes no VRAM. Only `look_at_screen` starts it, because the screen stays local: a
     screenshot is described by the local model and never sent to Claude (#507).
2. **Memory.** A conversation is the requests with less than 30 minutes between them. A longer
   pause starts a new one, which for Claude means `brainReset`.
   - With the local model, the conversation's last 8 exchanges go before the request, each as
     the request and James's final reply.
   - Claude's conversation remembers on its own. Some of what James says is not Claude's own
     words: a question about the project, "Mandei para o …", a parent's status, a repeated-back
     take. Claude is told those with the next request, so its conversation matches the panel's.
3. **The moment.** Every request carries the date and time in Portuguese words ("sexta-feira, 23
   de outubro de 2026, 21:50") with what it carries now: the window, the parents and the recent
   project.
4. **Claude's tools** are `TOOLS`, described in its system prompt, which is `RULES`, then the
   tools, then `listed()`.
   - It answers either in words or with one JSON object naming one tool and its arguments. The
     loop runs that tool and sends the output back as the next message.
   - Words written before a call are said at once, so the maintainer hears something while the
     tool runs.
   - Routing is the same for both brains: reads, the parent, the screen, the apps.
5. **Speech.** What is said aloud is `forSpeech(reply)`. The panel and the log keep the reply
   whole.
6. **Which project a tool runs on** (amends #505 decision 2). First, the project the words name,
   as now. Then the model's own pick, when it is a known project and, if the words name several,
   one of them. Then the window in front, then the recent project. Otherwise, ask. In the live
   test, `gh_pr_list` ran on the window's project while the model had named the right one.
7. **Yes and no** take the maintainer's ways of saying them:
   - yes: "é esse mesmo", "isso mesmo", "é isso", "aham", "pode ser", "claro", "beleza";
   - no: "não é isso", "nada disso".

   A bare "e" ("and") never counts as yes.
8. **Low confidence holds acting, not reading** (amends #506). A take under `CONFIDENT` is
   answered like any other. Only a call that acts is held and repeated back first: delegating,
   or opening an app, a page or an address. A yes then runs it.
9. The log row says which brain answered.
10. **The panel** shows which brain answers: `claude · sonnet` in the bar, or the local model's
    state as now. With Claude, the local model's setup card appears only once the screen starts
    it.

**Tests:**
- the second request's body holds the first exchange, and holds nothing after the pause;
- with Claude: a JSON call parsed, run, and its output sent back; James's own words told with the
  next request; a reset after the pause; the local model never started for a request;
- the moment in the request;
- the model's project beating the window;
- a low-confidence read running, while a low-confidence delegation waits for a yes;
- the yes and no forms;
- `forSpeech` used for speech only;
- the brain shown in the panel.

**Live (Windows), in the PR:** a few requests typed in an isolated dev instance with each brain,
with what each answered. Use generated requests, never the maintainer's log.

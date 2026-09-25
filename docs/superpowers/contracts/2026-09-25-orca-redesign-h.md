---
feature: orca-redesign-h
created: 2026-09-25
verdict: parallel
---

The maintainer's first day on v0.4.0 (spec `docs/superpowers/specs/2026-09-24-orca-redesign-design.md`;
waves A–G are on `main`). They like the conversation face. Four things get in the way: sending a
message lags, dictation takes too long to process, `!` bash mode does nothing in the chat, and
they could not find Design Mode at all. Each piece below starts from what was measured on their
Mac (Apple M5, Claude Code 2.1.282). `CLAUDE.md` and the memory
`see-the-app-through-an-isolated-dev-instance` say how to see the app. A piece that changes what is
on screen describes what it saw in its PR.

This contract reaches `main` as its own squash. Before your first push, run
`git fetch && git rebase origin/main` (memory `rebase-a-piece-before-its-first-push`).

## chat-send

**Lag.** From Enter to the message on screen, the chat takes more than a second:

1. `paneAgent` (`src/conversation/agent.ts`) asks `chrome_claude_running` first. Then
   `makeChatPty`'s `guarded` (`src/chat-input/pty.ts`) asks it again. Each call runs
   `claude agents --json`, measured at 0.12–0.23 s, plus a `pgrep` walk.
2. The keystrokes wait `KEY_GAP_MS` (150) and then `SUBMIT_GAP_MS` (500) before Enter.
3. Until all of that ends, the composer keeps the text and stays disabled.
4. The user's own bubble shows only once Claude writes the transcript and the watcher reads it.

What should happen:

- The message shows in the chat and the composer clears the moment the user sends. If delivery
  fails, the message is marked failed and its text comes back to the composer. The optimistic
  bubble is replaced by the transcript's record, never shown twice.
- One guard per send, and a cheap one. It must still refuse once Claude has exited, because the
  Enter would otherwise run in the shell. `chrome.rs` already caches the agent map for 3 s. A
  live check that the cached pid is still alive and still under the pane may be enough. Keep the
  command's name so Design Mode (`src/browser/`) gets faster too.
- Gaps only as long as a real pty proves safe for the current Claude Code. Test in a real pty,
  following the memories `claude-tui-keys-need-gaps` and `probe-claude-agents-states-from-a-job`.
  Put the numbers in the PR.

**Bash mode.** A composer draft of `!git status` goes out as one write. Claude Code enters bash
mode only on a `!` typed alone on an empty line, so the text most likely reaches Claude as a
prompt. Confirm this in a real pty. Then make `!cmd` run as Claude Code's bash mode, and show that
mode in the composer the way Claude Code's own input does. The transcript already turns
`<bash-input>` into a command card (`src/conversation/parse.ts:285`). Check that the command's
output shows too.

A dispatched child's chat replies through its mission and has no bash mode. Its composer must not
offer `!`.

- **files:** src/chat-input/, src/conversation/, src-tauri/src/chrome.rs
- **effort:** high

## dictation-speed

Dictation (⌘E) is accurate but slow. The maintainer says they will go back to Claude Code's own
voice input if it stays like this. whisper-rs builds without the `metal` feature, so
`GGML_METAL` is OFF and the whole model runs on the CPU. Measured on their M5 with the app's model
(`ggml-base-q5_1.bin`), same params as `transcribe`:

| audio | CPU (today) | Metal |
|---|---|---|
| 25 s speech, room hiss, pauses | 3–5 s | 0.9–1.4 s |
| 20 s clean speech | 0.8–1.2 s | 0.5–0.6 s |
| 8 s looped (decoder repeats, falls back to higher temperatures) | 7–33 s | 1.8–5.9 s |

The first Metal model load on the machine took 10.9 s, compiling the shaders; after that it took
0.6 s. On that looped audio, Metal also returned garbage once.

What should happen: a normal take of up to 30 s is typed about a second after the second ⌘E.

- Use Metal on macOS only, with a target-specific feature. Linux and Windows stay on the CPU.
- The build must still work with `CLAUDE.md`'s `DEVELOPER_DIR` and on the macOS CI runner.
- The first ⌘E after launch must not pay the shader compile. Warm the model in the background
  when its file is already on disk.
- A noisy take must not run away. Bound the decode (tokens for the audio's length, the
  temperature fallback) so no take takes tens of seconds, and check the text is still right.
- If you still cannot get near a second, transcribe while the user speaks, splitting at pauses.
  Use your judgment.

Put the before/after timings in the PR.

- **files:** src-tauri/src/voice.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/src/lib.rs, src/voice/, .github/workflows/ci.yml
- **effort:** high

`src-tauri/src/lib.rs`: this piece touches only the voice blocks. Only this piece edits Cargo files.

## design-mode-entry

The maintainer did not know where to turn Design Mode on:

- It needs a browser pane. The only way to open one is ⌘K → "Open URL…". The tab strip's `+`
  (`src/tabs/TabStrip.tsx`) opens only a terminal.
- Its toggle is an unlabeled icon in the browser pane's bar.
- ⌘K "Design Mode: pick an element…" silently does nothing when no browser pane is open
  (`designPane` returns null, `src/browser/view.tsx:176`).

What should happen:

- The `+` offers a terminal or a browser, the way Orca's does, with Orca's new-browser chord. Orca
  is in git history: `git show 9ca69ed^:vendor/orca/<path>`; search it for `tab.newBrowser`.
- A blank browser page says what the pane can do, Design Mode included.
- The toggle is findable: labelled, or explained on first use.
- ⌘K Design Mode never does nothing. With no browser pane open, it opens one and arms Design Mode
  once a page loads.

Popper menus are not opened in jsdom tests (memory `opening-a-popper-menu-hangs-vitest`). Test the
trigger and the handler, and look at the open menu in a screenshot.

- **files:** src/browser/, src/tabs/, src/actions/, src-tauri/src/lib.rs, tools/preview/scenarios/design-mode-entry.mjs
- **effort:** medium

`src-tauri/src/lib.rs`: this piece touches only the macOS menu block, for a "New Browser Tab" item
(one menu tuple per line).

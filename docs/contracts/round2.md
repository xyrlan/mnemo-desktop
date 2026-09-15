---
feature: round2
created: 2026-09-15
verdict: parallel
---

Second dispatch round of the mnemo ADE: sub-project 6 (voice, marketplace)
plus two fixes surfaced by using the app. Every piece owns its own directory
and its own anchor block in `src-tauri/src/lib.rs`; the wiring rules from
`docs/contracts/panes.md` still hold (views auto-import from
`src/<view>/view.tsx`, palette actions register from inside the view file).

Build note for every piece: `.cargo/config.toml` points all worktrees at one
shared target dir. If you run the app to test, build with a private target
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece>`) and a private Vite port
(`pnpm tauri dev --port 14xx`) so you do not clobber a sibling's binary.

## voice

- **files:** src/voice/, src-tauri/src/voice.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, Cargo.lock
- **exposes:** `voice_start() -> Result<(), String>`, `voice_stop() -> Result<String, String>` (returns the transcript), palette action `voice.dictate`
- **consumes:** nothing

Issue #10. Local whisper transcription, push-to-talk ⌥Space, insertion into
the focused text field, Monaco or terminal PTY. Cargo.toml and Cargo.lock are
in the boundary because this piece adds crates; the other three add none.
Only the `// -- voice` anchor blocks of `lib.rs` and the `bundle.macOS.infoPlist`
key of `tauri.conf.json`.

## marketplace

- **files:** src/marketplace/, src-tauri/src/marketplace.rs, src-tauri/src/lib.rs, src-tauri/fixtures/marketplace/
- **exposes:** `openView('marketplace', {}, place)`, `marketplace_list() -> Vec<RuleSet>`, `marketplace_import(path: String, cwd: String) -> Result<String, String>`, `marketplace_add_source(url: String)`
- **consumes:** nothing

Issue #11. Reads `.mnemo-shared/` trees from git sources listed in
`~/.mnemo-desktop/marketplace.json`, imports through `mnemo import`. Only the
`// -- marketplace` anchor blocks of `lib.rs`.

## shortcuts

- **files:** src-tauri/src/lib.rs, src/actions/keys.ts, src/actions/keys.test.ts, src/browser/
- **exposes:** event `app://action` with `{ id: string }`, event `browser://focused/<paneId>`
- **consumes:** nothing

Issue #12. Native menu accelerators so chords work while a browser webview
has focus; focus follows a click into the page. In `lib.rs` only a
`// -- menu` block inside `setup`, blank-line separated from the anchors the
other two pieces touch. In `src/browser/` only the focus event.

## placement

- **files:** src/layout/, src/actions/registry.ts, src/actions/registry.test.ts
- **exposes:** `openView(view, props, place: 'auto' | 'tab' | 'split-row' | 'split-col', title?)`, `paneRects()` moved to `src/layout/rects.ts`
- **consumes:** nothing

Issue #13. `place: 'auto'` reuses a same-view pane, else splits by available
size, else opens a tab; `tab.close` and `pane.close-others`. Existing callers
in `src/mission/`, `src/editor/` and `src/browser/` keep passing
`'split-row'` and stay outside this boundary; the parent flips them to
`'auto'` at landing (one-word edits) so this piece never overlaps the
shortcuts piece, which owns `src/browser/`.

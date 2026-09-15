---
feature: panes
created: 2026-09-14
verdict: parallel
---

Sub-projects 3 and 4 of the mnemo ADE roadmap, each a pane view over the
registry that PR #2 landed (`src/panes/registry.ts`). They share nothing
but that registry and the store's `openView`, both already on `main`.

Wiring rules the boundary depends on:

- A pane view registers itself from `src/<view>/view.tsx`; `App.tsx` imports
  every `src/*/view.tsx` automatically, so no piece edits `App.tsx`.
- Rust modules and commands go in the anchored blocks of
  `src-tauri/src/lib.rs` (`// -- editor ... --`, `// -- browser ... --`).
  Touch only your own block.
- Palette actions register through `src/actions/registry.ts`'s `register()`
  from inside your own `view.tsx`; do not edit the registry file.

## editor

- **files:** src/editor/, src-tauri/src/fs.rs, src-tauri/src/lib.rs, package.json, pnpm-lock.yaml
- **exposes:** `openView('editor', { path: string, root?: string }, place)`, `fs_read(path: String) -> Result<String, String>`, `fs_write(path: String, contents: String) -> Result<(), String>`, `fs_list(dir: String) -> Result<Vec<Entry>, String>`
- **consumes:** nothing

Issue #3. Monaco editor pane with a worktree file tree, ⌘S save, palette
actions `editor.open` and `editor.toggle-tree`. The Rust file commands must
refuse paths outside the user's home. `package.json` is in the boundary
because Monaco is a new dependency; the browser piece adds no npm package.

## browser

- **files:** src/browser/, src-tauri/src/browser.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml
- **exposes:** `openView('browser', { url: string }, place)`, `browser_create(id, url, x, y, w, h)`, `browser_navigate(id, url)`, `browser_set_bounds(id, x, y, w, h)`, `browser_destroy(id)`
- **consumes:** nothing

Issue #4. A Tauri child webview positioned over the pane rectangle (an
iframe cannot render most sites), address bar with back/forward/reload,
palette actions `browser.open` and `browser.open-pr`. `Cargo.toml` is in the
boundary because the child-webview API may need a Tauri feature flag; the
editor piece adds no crate.

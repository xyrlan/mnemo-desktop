---
feature: orca-redesign-g
created: 2026-09-24
verdict: parallel
---

The leftovers of the Orca redesign (spec `docs/superpowers/specs/2026-09-24-orca-redesign-design.md`;
waves A–F are on `main`). Each was found by looking at the running app or by the last pieces'
reports. `CLAUDE.md` and the memory `see-the-app-through-an-isolated-dev-instance` say how to see
the app; a piece that draws describes what it saw in its PR.

## workbench-empty

Seen in the running app: the worktree on screen had no tab, the tab strip still showed a tab from
elsewhere (a shell adopted after a restart whose folder matched no known worktree), and the
workbench was plain black — no empty state (New terminal / Launch agent). The workbench must always
show either the active worktree's tabs or its empty state, and the strip only that worktree's tabs;
a tab that belongs to no known worktree must stay reachable somewhere sensible rather than float.

- **files:** src/shell/Workbench.tsx, src/shell/Workbench.test.tsx, src/shell/EmptyWorkbench.tsx, src/tabs/, src/layout/store.ts, src/layout/store.test.ts, src/layout/persist.ts, tools/preview/scenarios/workbench-empty.mjs
- **effort:** high

## projects-outside-home

The editor, Explorer and Search refuse any path outside `$HOME` ("refusing path outside the home
directory", `src-tauri/src/fs.rs:43`, and the same rule in `search.rs`). A saved project
(`Settings['projects']`) outside `$HOME` — `/Volumes/…`, `/opt/src/…` — cannot be browsed or
searched, and neither can its worktrees, which sit beside it (`<repo>-wt-<name>`). Keep the guard,
widen what it allows: inside `$HOME`, inside a saved project's root, or inside one of that project's
worktrees as git lists them. Nothing else — never `/` or a system folder.

- **files:** src-tauri/src/fs.rs, src-tauri/src/search.rs, src-tauri/src/settings.rs
- **effort:** medium

## preview-fixtures

`pnpm --dir tools/preview test` fails two tests (`empty-workspace`, `terminal-pane`): the launch
fixture answers nothing to `pty_list` and `memory_feed`, commands the app has called since waves B
and D (memory `preview-shot-tests-fail-on-main`). Bring the fixtures up to what the app asks at
launch, and run the harness's tests in CI so they cannot drift silently again (the Linux job is
enough; keep the added time reasonable).

- **files:** tools/preview/, .github/workflows/ci.yml
- **model:** sonnet
- **effort:** medium

## stale-refs

Comments that still describe the old `.app` stylesheet scope, which #248 removed
(`src/chrome/PaneBar.tsx:69`, `src/diff/zone-card.tsx:32`, `src/new-workspace/SetupProgress.tsx:20`,
`src/notify/NotificationStack.tsx:19`), dev gallery pages that read the old tokens, and
`repoAccent` / `paneAccent`, which nothing on screen calls any more. Make the comments true (the
`data-ui` attributes themselves are harmless and may stay), point the galleries at the current
tokens, and delete the dead accent code with its tests.

- **files:** src/chrome/PaneBar.tsx, src/diff/zone-card.tsx, src/new-workspace/SetupProgress.tsx, src/notify/NotificationStack.tsx, src/home/repo-color.ts, src/home/repo-color.test.ts, src/layout/tabs.ts, src/layout/tabs.test.ts, src/avatar/gallery.html, src/vaultlevel/gallery.html
- **model:** sonnet
- **effort:** low

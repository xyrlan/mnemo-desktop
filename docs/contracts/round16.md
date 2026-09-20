---
feature: round16
created: 2026-09-20
verdict: parallel
---

Sixteenth round, one piece: the PR view the lens has been missing since round
15. Clicking a PR in the stream opens it in a browser pane today
(`src/home/Home.tsx:121`), which leaves behind everything the lens knows —
which child opened it, whether that child is still alive, and what can be done
about it.

One piece because the work does not divide further. A navigation stack, a
detail pane and the webview beside it are one seam: the stack holds which PR
is open, the pane reads it, and the webview's bounds follow the pane's own
layout. Cutting them apart would mean two children in `src/home/` agreeing on
state that does not exist yet.

Spec: `docs/superpowers/specs/2026-09-17-shell-and-lens-design.md`, which
called for "the PR view with its diff" and deferred it out of round 15. Wiring
rules from `docs/contracts/panes.md` hold.

## pr-view

- **files:** src/home/Home.tsx, src/home/Home.test.tsx, src/home/store.ts, src/home/store.test.ts, src/home/types.ts, src/home/types.test.ts, src/home/home.css, src/home/pr-pane.tsx, src/home/pr-pane.test.tsx
- **exposes:** `openPr(repo: string, pr: Pr): void` and `closePr(): void` on the home store, with `openedPr: { repo: string; pr: Pr } | null` in its state
- **consumes:** nothing
- **model:** opus
- **effort:** high

**The diff is GitHub's, not ours.** `monaco.editor.createDiffEditor` exists in
the installed package and is called nowhere in this repo, and
`src-tauri/src/github.rs` wraps no `gh pr diff` or `gh pr files`. Building a
diff renderer means a new Tauri command, a new editor mode, and then competing
with a mature viewer that already has inline comments, review and suggestions.
What GitHub cannot show is the child that opened the PR, so that is what this
piece adds beside it.

The view is two columns. On the left, native: the PR's number, title, check
state and draft badge, the child that opened it with its live state, and the
actions that child allows — take over, and stop behind a confirmation. On the
right, the PR on github.com in a webview.

Clicking a PR pushes the view over the stream, with a breadcrumb
(`‹ mnemo / PR #372`) and `⌘←` or the breadcrumb to return. The stream is
still there underneath, with its scroll position, when it comes back.

**The stack is Home's own state, not the layout's.** Today's "← back"
(`Home.tsx:270`) is a hardcoded `goToTab(0)`, which is a tab switch and not a
pop; do not build on it. `openedPr` on the home store is the whole stack this
round needs — one level deep, because a PR is as deep as the stream goes.

For the webview, reuse `makeWebviews` from `src/browser/lifecycle.ts`: it is
keyed by a number, knows nothing about the layout tree, and already keeps a
webview alive across React remounts. Give it an id that cannot collide with
the layout's synthetic ids, which start at `-1` and decrement
(`src/layout/store.ts:108`) — a constant far from that counter, named and
commented where it is defined. Release the webview when the PR view closes, so
a lens left on the stream holds no webview.

`src/browser/` and `src/layout/store.ts` are **read-only**: consume
`makeWebviews` and the browser client as they are, and reach the layout store
through `store.getState()` for the child actions, exactly as Home does today.
`src-tauri/` is read-only — this piece adds no Rust.

Keep the stream working as it is: `refreshGithub()` on becoming visible and
from the refresh button, the repo accents, the child badges, and the pin/hide
toggles that land without waiting for a reload (#123).

Two things the suite must pin:

- **A PR with no child still opens.** `child: null` is ordinary — a PR a human
  opened — and the left column must show the PR without a child section, never
  an error or an empty slot where the actions were.
- **Closing the view releases the webview.** A stream with no PR open must
  hold none, or a lens left open keeps a webview alive on GitHub forever.

Verify against the real app, not only the suite: run `tauri dev` in the
background with a private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r16-pr
pnpm tauri dev --port 2210`), kill leftover `vite` first, and open a real PR
from the stream — this repo has several with a resolvable child.

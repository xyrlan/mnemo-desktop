# Contract — the card drawer, and what stops opening a terminal

Three pieces. Two of them share one component, so that component is specified here
rather than invented twice.

## Why

Three complaints, one session:

1. The avatar's trail (`●8 ⊙`) reads as a notification badge, not as history. Its
   colour encodes a kind with no legend anywhere, and the caption above it already
   says what just happened.
2. `merge` and `land` spawn a PTY, open a tab and type the command — after the user
   already confirmed twice (the armed state). Clicking `merge` means merge; moving
   the user to another screen to watch it is a cost with no return.
3. Talking to a child means either an inline box that only exists while the child is
   `blocked`, or `take over`, which opens a full terminal. Nothing in between.

## Shared component — `<CardDrawer>`

Pieces B and C both need a panel anchored to a card row. One component, two contents.
Built once, in `src/cockpit/CardDrawer.tsx`, before either piece uses it.

```tsx
type CardDrawerProps = {
  open: boolean
  onClose: () => void
  title: string          // "merge · PR #412" | "mnemo-desktop/103"
  children: ReactNode
  onPromote?: () => void // renders the "open in pane" affordance when given
}
```

Behaviour, pinned by tests in `CardDrawer.test.tsx`:

- Slides in from the right of the board, does **not** cover it: the card list stays
  visible and clickable. It is not a modal — no backdrop, no focus trap, no
  `palette-overlay`.
- Escape closes. Clicking another card's drawer trigger swaps the content, it does
  not stack: **at most one drawer is open at a time**, state lives in the cockpit
  store, keyed by row.
- `onPromote` given → a button in the header that hands the content to a real pane
  (`openView`), then closes the drawer. Absent → no button.
- Closing never cancels the work behind it. A drawer is a window onto something, not
  its lifetime.

## Piece A — kill the trail

Independent. Touches nothing the others touch.

- `src/vaultlevel/Square.tsx:129–135` — the `<ol className="vl-trail">` goes.
- `src/vaultlevel/recent.ts` — `recentPulses` loses its only caller. Delete it and its
  tests; keep `toneOfKind` if the overlay still uses it (check before deleting).
- `src/vaultlevel/vaultlevel.css:64–71` — `.vl-trail`, `.vl-dot`, `.vl-count` go.

In its place, band 3 becomes an **activity texture**: a fixed-width row of thin bars,
one per bucket of recent time, height by pulse count in that bucket, colour by the
dominant kind's tone. It is texture, not data — no number, no tooltip, no legend. It
answers "has he been busy" and nothing else, which is the only question the dots ever
actually answered.

- New: `src/vaultlevel/texture.ts` — pure. `activityTexture(log, now, buckets)` →
  `{ height: number /* 0..1 */, tone: Scene['tone'] }[]`, oldest first, always
  `buckets` long (empty buckets are height 0). Unit-tested against a synthetic log.
- The band keeps its current height (15px) so the square's layout does not move.

## Piece B — merge and land run headless, with the log in a drawer

The heaviest piece: there is no existing Rust path for "run a process and stream it".
`github.rs` only reads (`gh_auth`, `gh_issues`, `gh_project`); `pty.rs` exposes no
generic streaming.

### Rust — `src-tauri/src/job.rs` (new)

Follows the `pulse.rs` emit pattern: spawn a thread, `app.emit` per line.

```rust
#[tauri::command]
pub fn job_run(app: AppHandle, id: String, cwd: String, argv: Vec<String>) -> Result<(), String>
```

- `argv` is a **list, never a shell string** — no `sh -c`, nothing to quote-escape.
  The caller builds `["gh", "pr", "merge", …]`.
- Emits `job-line` `{ id, stream: "out" | "err", line }` per line, and `job-exit`
  `{ id, code }` once. Both streams are read; interleaving order is not guaranteed
  and the drawer does not pretend it is.
- Registered in `lib.rs`'s `invoke_handler` — an unregistered command does not exist
  to the front end, and `lib.rs:300`'s test sweeps for exactly this.
- A second `job_run` with a live `id` is rejected, not queued.

### Front — `src/cockpit/actions.ts`, `InboxRow.tsx`

- `mergePr` and `landMission` stop calling `openCommandTab`. They call `job_run` and
  register the row's job id.
- The row shows its own state inline: `merging…` → `merged ✓` / `failed ✗`. The armed
  confirmation (`useArm`, `actions.ts:31–46`) stays exactly as it is — this piece
  removes a pane, not a confirmation.
- A `log` affordance on the row opens `<CardDrawer>` with the streamed lines. On
  failure the drawer **opens by itself**; on success it does not. Success is silence.
- `onPromote` hands the log to a pane for anyone who wants the full screen.
- Job state (lines, exit code, running) lives in the cockpit store keyed by row, so
  closing the drawer or scrolling the list does not lose the log.

`mnemo land --merge` is long and talkative; `gh pr merge --squash` is quick. Same
mechanism, and the drawer is what makes the long one bearable without a pane.

## Piece C — the chat drawer

- `take over` is unchanged. It attaches to a child's real terminal and needs a real
  xterm; a drawer is the wrong shape for it.
- What moves into the drawer is **sending a message to a child** — today only possible
  through `ReplyBox` (`src/mission/rows.tsx:100–150`), and only while the child is
  `blocked`.
- A `chat` affordance on every live child row opens `<CardDrawer>` with the reply
  history and an input. `QuestionBox` / `PermissionBox` keep working inline when the
  child is blocked: an answer that is being *waited for* belongs on the card, not
  behind an affordance.
- `onPromote` → `take over`, so the drawer is the small end of a path that already
  exists.

## Order

`<CardDrawer>` first, alone, merged before B and C start — they both build on it and
would otherwise ship two divergent drawers. A goes in parallel with it, touching
nothing they touch.

## What stays true

- No action loses its confirmation.
- No pane is created for an action the user already confirmed.
- `take over` still opens a terminal.
- The square's layout does not move.

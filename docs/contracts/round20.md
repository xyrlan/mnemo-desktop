---
feature: round20
created: 2026-09-23
verdict: parallel
---

Twentieth round (#162), four pieces: the **conversation view**. A Claude pane gets a second face that
renders its session's live transcript as cards (tool calls, diffs, the mnemo rules that reached
each turn), laid over the xterm; the real `claude` TUI keeps running underneath, untouched. A
`--bg` child's mission pane shows the same view instead of its timeline. v1 is read-only: typing,
approving and answering still happen in the terminal (a pane) or through the existing reply box
(a child).

**Read `docs/superpowers/specs/2026-09-23-conversation-view-design.md` first.** It holds every
decision (Q1–Q17) and the transcript facts, read off real Claude Code 2.1.280 transcripts. Where
this contract and the spec disagree, ask.

**Every seam is already on `main`**, so each piece compiles and tests alone and the four merge in
any order. Nobody writes a stand-in for another piece's signature, in the worktree or the PR:

- `src/conversation/types.ts` — every shared type (`TranscriptRecord`, `Card`, `RuleChip`,
  `ToolOutcome`, `Conversation`, `SessionStatus`, `StatusMarker`, `FollowEvent`, `Chunk`).
  **No piece edits it.** A type that does not fit is a question for the parent, not an edit.
- `src/conversation/client.ts` — `tauriConversation` (`follow`, `earlier`, `logUsage`) and
  `makeConversationClient` for fakes. No piece edits it.
- `src/conversation/parse.ts` — `parseRecord` (done) and a stub `deriveConversation`.
- `src/conversation/ConversationView.tsx` (props final, body a stub) and `Face.tsx` (stub).
- `Pane.face`, `setFace(id, face)`, face saved and restored; action `pane.toggle-face` (⌘⇧C, also
  a native menu accelerator); `src/terminal/view.tsx` already renders `<ConversationFace>` over
  the xterm when `pane.face === 'conversation'`.
- `src-tauri/src/conversation.rs` — the three commands, **registered in `lib.rs`**, with stub
  bodies; `FollowEvent` and `Chunk` serialise as `types.ts` reads them (test on main).
- `src-tauri/src/usage.rs` — `usage_log(row)` appends to `~/.mnemo-desktop/usage.jsonl`. Done.

**No piece edits `src-tauri/src/lib.rs`, `Cargo.toml`, `src/App.tsx`, `src/layout/`,
`src/actions/` or `src/terminal/`.**

The repo is **public**. Nothing from a real transcript is committed except through the parser's
scrub script. Transcripts hold secrets (a 2026-09-22 audit found production passwords in vault
rules, which reach transcripts through injection) and base64 screenshots.

Suite: `pnpm test && pnpm build` and
`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r20-<piece> cargo test --manifest-path src-tauri/Cargo.toml`.
Look at the real app with `tauri dev` on a private target and port
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r20-<piece> pnpm tauri dev --port 22NN`). The
full view only works once all four pieces are merged; the parent checks it on screen at landing.

## parser

- **files:** src/conversation/parse.ts, src/conversation/parse.test.ts, src/conversation/fixtures/, scripts/scrub-transcript.mjs
- **exposes:** `deriveConversation(records: TranscriptRecord[]): Conversation`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Turns a transcript's records into the cards the spec lists. Pure and deterministic: the same
records give the same cards with the same ids (a record `uuid`, or a `tool_use` id).

- **Cards** (spec Q4, Q13):
  - `user`: typed prompts, with images and the reflex chips of that prompt. `queued: true` for a
    `queued_command` attachment.
  - `assistant`: text blocks. Thinking is dropped.
  - `tool`: one per `tool_use`, joined to its result by `tool_use_id` when the result arrives.
    `outcome` is set as follows:
    - `diff`: Edit/Write, from `structuredPatch`, with `created` set for a Write that created
      the file.
    - `bash`: Bash's `stdout`, `stderr` and `interrupted`.
    - `denied`: a result whose record has `toolDenialKind`, plus the user's feedback text.
    - `answers`: AskUserQuestion.
    - `error`: `is_error`.
    - `text`: everything else, flattened.
    - `null`: no result yet.

    `summary` is one line: the command, the path or the pattern.
  - `agent`: the Agent/Task tool, with the report from its result when there is one.
  - `peer`: a user record with `origin.kind: peer`.
  - `notification`: `origin.kind: task-notification`.
  - `command`: `<command-name>`.
  - `session`: the SessionStart block.
  - `unknown`: a record type this parser has never seen. Consecutive records of the same unknown
    type collapse into one card.
- **Metadata:** the last `ai-title` is `title`. `pr-link` records become `prs`, one per number.
- **Hidden:**
  - Every attachment that is neither mnemo's `hook_additional_context` nor `queued_command`: the
    token, task and silent reminders, `hook_success`, `edited_text_file` and the rest.
  - `isMeta` user records that are not peer messages, such as `<local-command-caveat>`.
  - Top-level records: `mode`, `last-prompt`, `atis-latch`, `permission-mode`,
    `file-history-*`, `cost-state` and `system`.

  A hidden type is known, so it never makes an `unknown` card.
- **Rule chips** (spec Q9), all from the transcript alone:
  - `reflex`: `[[slug]]` in a UserPromptSubmit `hook_additional_context`, on the user card of the
    prompt it answered (follow `parentUuid`).
  - `enrichment`: a PreToolUse one, on the tool card with that `toolUseID`.
  - `briefing` / `learned`: from the SessionStart text, on the `session` card. The briefing body
    goes between `[last-briefing` and `[/last-briefing]`, and the learned slugs come from the
    `• <slug> —` lines.
  - `mcp`: the `slug` argument of a `mcp__mnemo__read_mnemo_rule` call.

  Only text that is mnemo's counts, recognised by its envelope (`mnemo://v1`,
  `mnemo reflex context:`, `• mnemo rule [[`). Another hook's context is not a chip.
- **Fixtures, public repo:**
  - `scripts/scrub-transcript.mjs <in.jsonl> > <out.jsonl>` keeps every key, record type and
    subtype, id, timestamp, tool name, `hookName`/`hookEvent`, `toolDenialKind`, `origin.kind`
    and the `structuredPatch` shape.
  - It replaces every other string with neutral text of similar length, rewrites slugs to fake
    ones, and swaps every base64 image for one tiny valid PNG. It keeps mnemo's envelopes, so
    chips still parse.
  - The committed fixtures come from real transcripts through it. Cover:
    - a pane session with reflex and enrichment chips, a `/clear` start, a denial, an
      AskUserQuestion, an image and a subagent;
    - a `--bg` child session;
    - a peer message and a queued one.
  - A test fails if a fixture contains a long base64 run or any string from a small list of
    secret shapes (`sk-`, `ghp_`, `-----BEGIN`, `password`).
- **Real-machine check:**
  - `CONVERSATION_REAL=1 pnpm vitest run src/conversation/parse.test.ts` parses every transcript
    under `~/.claude/projects` and prints the count of `unknown` cards by type. It is skipped
    without the variable.
  - Run it before opening the PR and put the numbers in the PR body. Every type it finds is
    either rendered or deliberately hidden.
- `deriveConversation` over 2000 records takes under ~50 ms (test on a generated set).

## tailer

- **files:** src-tauri/src/conversation.rs
- **exposes:** `conversation_follow(session_id: String, cwd: String, tail: usize, on_event: Channel<FollowEvent>) -> Result<u32, String>`, `conversation_unfollow(id: u32)`, `conversation_earlier(session_id: String, cwd: String, before: u64, count: usize) -> Result<Chunk, String>`
- **consumes:** nothing
- **model:** opus
- **effort:** high

Streams one transcript file to the front-end as raw lines and never parses a record. The
signatures and serialisation are on `main`; this piece writes the bodies. State lives in this
module (a static registry); `lib.rs` is not touched.

- **Finding the file:** `crate::mission::transcript_path(cwd, session_id)`. No file yet sends
  `Missing`, and the follow keeps looking about once a second until it appears or is
  unfollowed.
- **First send:** the last `tail` complete lines as one `Lines` event with their byte `start`
  and `end`. Read backwards from the end in blocks; never read a whole 50 MB file to take 200
  lines. One line can be ~500 KB (inline images).
- **Then:** each complete line appended, via `notify` on the file's directory plus a ~1 s
  fallback poll (FSEvents coalesces, and Windows differs). A partial trailing line waits for its
  newline. Lines are sent without the newline; a trailing `\r` is stripped.
- **Batching:** lines arriving within ~50 ms go in one event. No event carries more than ~4 MB,
  so a burst is split.
- **Shrink or replace:** when the length drops below the offset, or the file is a different
  file, send `Reset`, then lines from 0.
- **Stopping:** `conversation_unfollow(id)` stops the follow's thread and watch. So does a
  Channel send failing (the webview is gone). No thread outlives its follow; there is a test for
  that.
- **`conversation_earlier`:** the `count` complete lines ending right before byte `before`.
  `start == 0` means the top of the file.
- **Tests:** temp files for every case above: tail N of M, a partial then a completed line,
  shrink → `Reset`, missing → appears, earlier up to the top, a 1 MB line, and many follows at
  once.
- **Real transcript:** an `#[ignore]` test follows the newest real transcript under
  `~/.claude/projects` for 2 s and prints its line count and timing. Run it with `--ignored`
  before opening the PR.

## view

- **files:** src/conversation/ConversationView.tsx, src/conversation/Face.tsx, src/conversation/cards/, src/conversation/conversation.css, src/conversation/usage.ts, src/conversation/view.test.tsx, src/chrome/PaneBar.tsx, src/chrome/chrome.css, scripts/usage-summary.mjs, package.json, pnpm-lock.yaml
- **exposes:** `ConversationView(props: ConversationViewProps)`, `ConversationFace({ paneId }: { paneId: PaneId })`
- **consumes:** `deriveConversation(records: TranscriptRecord[]): Conversation` from parser, `conversation_follow(session_id: String, cwd: String, tail: usize, on_event: Channel<FollowEvent>) -> Result<u32, String>` from tailer, `conversation_earlier(session_id: String, cwd: String, before: u64, count: usize) -> Result<Chunk, String>` from tailer
- **model:** opus
- **effort:** high

The face itself. `ConversationView`'s props are final on `main`; this piece writes its body and
`Face.tsx`'s. It reaches the parser and the tailer only through `deriveConversation` and
`tauriConversation`. Test against hand-built `Card`/`Conversation` values and a fake
`ConversationClient`, since the real ones are stubs until those pieces merge.

- **Cards** (spec Q4, Q13):
  - Text: through `Markdown` from `src/vault/Markdown.tsx`.
  - Edit/Write: an inline diff from `hunks`, collapsed past ~20 lines. Reuse the review diff's
    look (`src/home/review/`) where it fits.
  - Bash: the command, with its output collapsed.
  - Other tools: a one-line chip, expandable.
  - `agent`: collapsed, showing the report.
  - `peer`: "from <session>".
  - `notification`: a thin line.
  - `command`: a chip.
  - `session`: a block at the top. The briefing is collapsible, and the learned chips sit on it.
  - `unknown`: a grey chip `unknown <type>`.
  - Images: thumbnails decoded only when on screen; click to enlarge.
- **Rule chips:**
  - Placement: on the user card (reflex), inside the tool card (enrichment, mcp) and on the
    session block.
  - Click runs `openRule(slug)` (`src/pulse/open.ts`).
  - **Veto** arms on the first click and runs on the second, like the health table's disable.
    It calls the vault client's `run('disable-rule', [slug], '')`.
- **Status** (`status` prop):
  - `busy` shows a `working… m:ss` row at the bottom.
  - A `tool` card with `outcome === null` while `waiting` is set becomes the pending card:
    "waiting for approval" or "waiting for your answer", with an **open terminal** button that
    calls `onOpenTerminal`.
- **`/clear`:** when `sessionId` changes, what was shown stays above a `── /clear ──` divider and
  the new session follows below.
- **Loading:**
  - Follow with `tail` 200. Scrolling to the top calls `earlier`.
  - The list is virtualised; one small dependency is fine.
  - The view stays at the bottom while you are at the bottom. It never yanks you down after you
    scroll up; a "↓ new" pill appears instead.
  - `Reset` drops everything and starts again. `Missing` shows "waiting for the transcript…".
- **`markers`:** merged into the stream by `at`, as thin lines.
- **`footer`:** pinned under the stream.
- **`Face.tsx`:**
  - Takes the pane's `sessionId` and `cwd` from the layout store.
  - Takes `status` from the mission snapshot's parent with that `session_id`: busy when
    `status` is busy, waiting when it matches `/wait|permission|input|approv/`. When waiting,
    the kind is question if the pending card is AskUserQuestion, permission otherwise.
  - `onOpenTerminal` is `setFace(paneId, 'terminal')` plus focus back on the xterm.
  - With no session, it shows "no Claude session in this pane" and a hint to press ⌘⇧C.
- **Pane bar:** on terminal panes only, a toggle button showing the current face, titled
  "Toggle conversation (⌘⇧C)".
- **Usage counter** (spec Q8), through `tauriConversation.logUsage`, started once at module
  import (never from `App.tsx`):
  - `{event: 'face', face, session: boolean}` on every face change.
  - `{event: 'beat', face}` every 60 s while the window has focus and the focused pane is a
    terminal.
  - `scripts/usage-summary.mjs [days]` prints the share of beats per face and the toggle count.
    Its counting is a pure, unit-tested function.
- Labels are in English.

## children

- **files:** src/mission/view.tsx, src/mission/view.test.tsx, src/mission/timeline.ts, src/mission/timeline.test.ts, src/mission/mission.css
- **exposes:** `statusMarkers(lines: TimelineLine[]): StatusMarker[]`
- **consumes:** `ConversationView(props: ConversationViewProps)` from view
- **model:** opus
- **effort:** medium

A `--bg` child's mission pane shows its conversation instead of the timeline (spec Q3, Q6).

- **Replaced:** `.mission-timeline` becomes `<ConversationView>`, with these props:
  - `sessionId={child.session_id}`, `cwd={child.cwd}`.
  - `status` from the child: busy when `childWord` is active, waiting when BLOCKED, with the
    kind from `needKind`.
  - `markers={statusMarkers(lines)}`: one marker per state change, not per poll. Repeats
    collapse, and the label reads like `blocked · <detail>` or `done`.
  - `footer={<ReplyBox c={child} rows={3} className="mission-reply" />}`, the reply/approve box
    the pane has today.
  - `onOpenTerminal={() => attachChild(id, 'split-col')}`.
- **Kept:** the head (title, meta, take over, stop), the memory panel, and the looked/markLooked
  bookkeeping.
- **Dropped:** the "you" rows and the final "report" block. What was sent and the report are
  both in the transcript now.
- **Cleanup:** `timeline.ts` keeps only what `statusMarkers` and `clock` need. Delete the dead
  code and its tests.
- A child with no `session_id` yet still gets the view (it shows its empty state) and its
  markers.
- `src/mission/view.test.tsx` checks the timeline this piece removes: rewrite those tests for the
  new pane (conversation, markers, footer), keep the rest. The `tl-*` rules in `src/theme.css`
  become dead; leave them (not in this boundary), the parent removes them at landing.

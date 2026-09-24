---
feature: orca-redesign-e
created: 2026-09-24
verdict: parallel
---

Wave E of the Orca redesign: what the spec still asked for after v0.3.0 — the surfaces that kept
their old look, and the Checks panel. Read first:

1. `docs/superpowers/specs/2026-09-24-orca-redesign-design.md` (*Where everything lives*, *Visual
   system*).
2. `vendor/orca/README.md` and `vendor/orca/MANIFEST.md` — Orca's native chat (bridge mode),
   checks panel and PR page, vendored for this wave (MIT, authorized). Adapt from there; do not
   fetch Orca from the network.
3. What is on `main`: waves A–D (v0.3.0). `@/ui`, the shell and its slots, the fleet, the layout,
   `registerRightbarPanel` (`src/rightbar/panels.ts`), Design Mode's agent routing
   (`resolveAgent` / `deliver` in `src/browser/grab-agent.ts`, and the `chrome_claude_running`
   check before pressing Enter).

Decided with the maintainer on 2026-09-24:
- **Conversation face = Orca's bridge mode on our architecture.** It stays an overlay on the live
  terminal, fed by the transcript JSONL, replies typed into the PTY; ⌘⇧C keeps toggling it and the
  terminal stays the default. What changes is how it looks and what it can do: Orca's message
  list, tool runs, diff cards, thinking, working status, context ring, approval and question cards
  answered in one click, and a composer with `/` and `@file` autocomplete. No Agent SDK.
- **A dispatched child's session uses the same chat**, fed by its timeline; replies go through the
  mission reply, permissions through the same approval card.
- **Checks**: the worktree PR's CI checks with expandable logs, **Fix** sending the failing checks
  to the worktree's agent (or starting one), the PR header with its actions (merge, ready), and
  review comments read-only with "send to agent".
- **PR pane, vault, learned, editor**: the new look only, no new behaviour.

Removing the old stylesheet scope (`.app` in `src/theme.css`) and the monospace UI font waits for
all of this and is not a piece here. The transcript format is parsed only in
`src/conversation/parse.ts`. Every screen a piece draws gets a preview scenario and is described in
its PR; store selectors return stored values or use `useShallow` (#212); popper content is not
opened in jsdom.

`src-tauri/src/lib.rs`: only `checks` adds a block, after `// -- github (src/github.rs) --` and
`// -- github commands --`. No piece edits `Cargo.toml`, `tauri.conf.json` or `package.json`.

## chat-input

The interactive parts of Orca's chat (MANIFEST), usable from any surface that talks to an agent:
the composer (multi-line, ⌘↵/Enter to send, `/` slash commands and `@file` autocomplete over the
worktree's files), the approval card (allow / deny, with what is being allowed), the question card
(pick an option or answer in words), and the PTY side of them — how a prompt, an approval and an
answer are typed into a live Claude Code TUI.

- **files:** src/chat-input/, tools/preview/scenarios/chat-input.mjs
- **exposes:** `ChatComposer(props: { onSend(text: string): Promise<void>; cwd: string | null; placeholder?: string; disabled?: boolean }): JSX.Element` from `src/chat-input/Composer.tsx`, `ApprovalCard(props: { tool: string; summary: string; detail?: string; onAllow(): Promise<void>; onDeny(): Promise<void> }): JSX.Element` from `src/chat-input/ApprovalCard.tsx`, `QuestionCard(props: { question: string; options: string[]; onAnswer(index: number): Promise<void>; onOther?(text: string): Promise<void> }): JSX.Element` from `src/chat-input/QuestionCard.tsx`, `ptySendPrompt(pane: number, text: string): Promise<void>` from `src/chat-input/pty.ts`, `ptyAnswerApproval(pane: number, allow: boolean): Promise<void>` from `src/chat-input/pty.ts`, `ptyAnswerQuestion(pane: number, index: number): Promise<void>` from `src/chat-input/pty.ts`
- **effort:** high

## chat-view

The conversation face in Orca's native-chat look (MANIFEST): message list and rows, tool runs,
diff cards, thinking, working status, context ring. While Claude waits on a permission or a
question, the matching card shows at the foot and answers it; otherwise the composer does. Every
PTY write is guarded as Design Mode's is: nothing is typed unless the pane still runs Claude.
`ConversationView` keeps its props, so the mission pane keeps working through it.

- **files:** src/conversation/, tools/preview/scenarios/chat-view.mjs
- **consumes:** `ChatComposer(props: { onSend(text: string): Promise<void>; cwd: string | null; placeholder?: string; disabled?: boolean }): JSX.Element` from chat-input, `ApprovalCard(props: { tool: string; summary: string; detail?: string; onAllow(): Promise<void>; onDeny(): Promise<void> }): JSX.Element` from chat-input, `QuestionCard(props: { question: string; options: string[]; onAnswer(index: number): Promise<void>; onOther?(text: string): Promise<void> }): JSX.Element` from chat-input, `ptySendPrompt(pane: number, text: string): Promise<void>` from chat-input
- **exposes:** `ConversationView(props: ConversationViewProps): JSX.Element` from `src/conversation/ConversationView.tsx`
- **effort:** xhigh

## mission-session

A dispatched child's pane (`src/mission/view.tsx`) in the same chat: the header (take over, stop)
in the new look, `ConversationView` for the timeline, `ChatComposer` sending through the mission
reply, and a pending permission shown with `ApprovalCard` answered through the mission's
permission path. The child's memory panel restyled to match.

- **files:** src/mission/view.tsx, src/mission/view.test.tsx, src/mission/rows.tsx, src/mission/mission.css, src/mission/memory/, tools/preview/scenarios/mission-session.mjs
- **consumes:** `ConversationView(props: ConversationViewProps): JSX.Element` from chat-view, `ChatComposer(props: { onSend(text: string): Promise<void>; cwd: string | null; placeholder?: string; disabled?: boolean }): JSX.Element` from chat-input, `ApprovalCard(props: { tool: string; summary: string; detail?: string; onAllow(): Promise<void>; onDeny(): Promise<void> }): JSX.Element` from chat-input
- **effort:** high

## checks

The right sidebar's Checks tab (MANIFEST): for the active worktree's branch, its PR header and
actions (open, merge, mark ready), its CI checks with expandable details and the failing job's log
tail, and its review comments read-only. **Fix** sends the failing checks and their log tails to
the worktree's agent (through Design Mode's routing and guard) or, with none, starts one in that
worktree; a comment's "send to agent" does the same with the comment. With no PR it says so and
offers to open one. Data from `gh`; polled only while the tab is open. It registers its tab with
`registerRightbarPanel` (on `main`), after Source Control.

- **files:** src/checks/, src-tauri/src/checks.rs, src-tauri/src/lib.rs, tools/preview/scenarios/checks.mjs
- **effort:** xhigh

## pr-pane-restyle

The PR pane Tasks opens (`src/home/pr-pane.tsx`, `src/home/review/`) in the new look, adapted from
Orca's PR page (MANIFEST): header, checks summary, files and diff, merge. Same behaviour. The
GitHub bits it uses (`src/github/`) follow.

- **files:** src/home/pr-pane.tsx, src/home/pr-pane.test.tsx, src/home/review/, src/home/home.css, src/github/, tools/preview/scenarios/pr-pane.mjs
- **effort:** high

## vault-restyle

The vault pane (health, pages, inbox — opened from ⌘K) in the new look: `@/ui` primitives,
tokens, Orca's table and list styles. Same behaviour.

- **files:** src/vault/, tools/preview/scenarios/vault.mjs
- **effort:** high

## learned-restyle

The "what mnemo learned" pane (`src/learned/`, opened from ⌘K and the vault's inbox) in the new
look, matching onboarding's consent step. Same behaviour.

- **files:** src/learned/, tools/preview/scenarios/learned.mjs
- **model:** sonnet
- **effort:** medium

## editor-restyle

The editor pane's chrome (file tree, open-file prompt) and the browser pane's address bar in the
new look; Monaco itself keeps its theme. Same behaviour.

- **files:** src/editor/, src/browser/address.tsx, src/browser/browser.css, tools/preview/scenarios/editor.mjs
- **model:** sonnet
- **effort:** medium

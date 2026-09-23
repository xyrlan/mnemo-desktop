# Conversation view — design (round 20)

2026-09-23. Decided with the maintainer in a grilling session (Q1–Q17 below). Contract:
`docs/contracts/round20.md`. Issue #162.

## Why

A Claude pane today is a TUI inside a PTY. Everything the app has had to work around comes from
that: Shift+Enter needs `ESC CR` (#33), image paste needed a round (#53), approving a prompt means
scraping the xterm buffer and typing a digit (#83), a typed prompt cannot be translated, the
session id is guessed from the process tree (#73). Claude Desktop and Devin render the session as
structured UI instead. We want that, adapted to mnemo: the rules the vault injected shown on the
turn they reached, with a veto next to them.

**Hybrid, not headless.** The TUI stays the engine, in the PTY, untouched. The app renders the
session's transcript as cards on top. Headless (`claude -p --input-format stream-json`) was
rejected: every TUI feature (slash commands, plan mode, AskUserQuestion, `/context`, `--bg`,
`claude agents`) would have to be rebuilt and kept at parity with a CLI that ships weekly, and a
public app driving a subscription login headless is a terms question. With the hybrid, the raw
terminal is one key away, so nothing Claude Code does is ever lost.

## Facts it stands on (read 2026-09-23, Claude Code 2.1.280)

- **Transcript:** `~/.claude/projects/<escaped cwd>/<session>.jsonl`, one JSON object per line.
  `mission::transcript_path` finds it (scans every project when the cwd guess misses).
- **Assistant messages land whole.** One line per content block, all written when the message
  finishes; no partial text is ever on disk. A tool_use line is on disk before the tool runs.
- **Everything mnemo injects is in the transcript:** `type: attachment`,
  `attachment.type: hook_additional_context`, with `hookName`/`hookEvent`/`toolUseID`:
  - UserPromptSubmit reflex: `mnemo reflex context:\n• [[slug]]: …`;
  - PreToolUse enrichment: `• mnemo rule [[slug]]:` tied to the tool call by `toolUseID`;
  - SessionStart: `mnemo://v1 …`, `[last-briefing …]…[/last-briefing]`,
    `[mnemo learned since your last session]\n• <slug> — …`;
  - MCP reads are ordinary `mcp__mnemo__*` tool calls.
  `reflex-log.jsonl` adds only scores/judge/silence reason (joinable by session id + sha256 of the
  prompt, 75/75) — not used in v1.
- **Tool results** (`toolUseResult`): Edit/Write carry `structuredPatch` hunks; Bash
  `{stdout, stderr, interrupted}`; errors are strings with `is_error`; denials carry
  `toolDenialKind`; AskUserQuestion carries `answers`.
- **Nothing is written while a permission prompt waits**: a tool_use with no result. Only
  `claude agents --json` (`status`, `waitingFor`) says it is parked.
- **Thinking is not stored** (signature only). Images are inline base64 (up to ~500 KB a line).
- **`/clear` starts a new file and a new session id; the same pid keeps running.** Verified: after
  a `/clear`, `claude agents --json` reports the new id for the old pid, so the pane's existing
  5 s `useSessionLearn` poll re-tags the pane.
- **Subagents** write their own files (`<project>/<session>/subagents/agent-*.jsonl`); the main
  transcript has the Agent tool call and its result.
- **Socket messages** (`/tmp/cc-socks/<pid>.sock`) land as `isMeta` user records with
  `origin.kind: peer`, or as a `queued_command` attachment when the session is busy — distinct
  from typed input. Works for interactive sessions too (not used in v1).

## Decisions

| # | Question | Decision |
|---|---|---|
| Q1 | First pain | **Following** (read-only). Writing (composer) is piece 2, later. |
| Q2 | Where | **One pane, two faces.** The conversation is laid over the xterm, which stays mounted. |
| Q3 | Which sessions | **Pane sessions and `--bg` children.** Children: in the mission pane. |
| Q4 | Cards | Markdown text; Edit/Write inline diff (collapsed past ~20 lines); Bash command + collapsed output; Read/Grep/Glob/others one-line chip, expandable; thinking hidden (not stored anyway); subagent collapsed card with its report; mnemo rule chips. |
| Q5 | Default face | **Terminal** while there is no composer. Toggle with ⌘⇧C / palette / pane bar. Flips to conversation when the composer ships. |
| Q6 | Children | The mission pane's timeline is replaced by the conversation; status transitions become thin markers in the stream; head, memory panel and reply/approve stay (footer); "take over" stays the terminal route. |
| Q7 | Pipeline | Rust tails bytes (offset + `notify`) and sends raw lines over a Channel; one TS module parses, with fixtures from real transcripts; unknown record types show as a grey `unknown <type>` chip. |
| Q8 | Success | Local counter `~/.mnemo-desktop/usage.jsonl` (face toggles + 60 s heartbeats of the focused pane's face). Reviewed after one week with the maintainer's verdict. Conversation face on screen < ~30 % of the time → the composer does not pay. |
| Q9 | Rule chips | From the transcript only. Click opens the rule in the vault pane; veto runs `mnemo disable-rule <slug>` after a confirm. Log join (scores, silence reason) is a later piece. |
| Q10 | Text lag | Accepted. A `working… 0:42` row from the session's busy status. |
| Q11 | Pending prompt (pane) | A card "waiting for approval / your answer" with **open terminal** (flips the face). Children keep their existing Approve/Deny/reply. |
| Q12 | `/clear` | Old conversation stays above a `── /clear ──` divider; the new one continues below. |
| Q13 | Noise | Own card: peer messages ("from session X"), task notifications (thin marker), `queued_command` ("queued" bubble). Metadata: `ai-title` → title, `pr-link` → PR chips. Images: thumbnails, click to enlarge. Hidden: token/task/silent reminders, `hook_success`, `mode`, snapshots, `cost-state`, … |
| Q14 | Build | Round 20 contract, seams pre-cut on `main`, four children in parallel. |
| Q15 | Fixtures | The repo is public. A scrub script keeps the real shape (keys, types, `structuredPatch`, ids) and replaces text and base64; committed fixtures come from it. A local, opt-in test parses every transcript on the machine and counts unknown types. |
| Q16 | Large transcripts | Open with the last ~200 lines; "load earlier" on scroll-up; virtualised list; images decoded only on screen. |
| Q17 | Piece 2 (composer) | Not designed here. Grilled again after the week's number. |
| — | Labels | English, like the rest of the app. |
| — | Platforms | v1 uses nothing Unix-only (no socket), so it runs on Windows too. |

## Architecture

```
PTY (claude TUI) ──writes──▶ ~/.claude/projects/…/<sid>.jsonl
                                   │ conversation.rs: offset tail + notify, raw lines
                                   ▼ Channel<FollowEvent>
                     client.ts ──▶ parse.ts: parseRecord → deriveConversation → Card[]
                                   ▼
            ConversationView (cards, chips, working row, pending card, /clear divider)
              ▲ Face.tsx (terminal pane, over the xterm)   ▲ mission pane (a child)
```

Seams on `main` before dispatch (commit that adds this spec): `src/conversation/types.ts`,
`client.ts`, stub `parse.ts` / `ConversationView.tsx` / `Face.tsx`, `Pane.face` + `setFace` +
save/restore, action `pane.toggle-face` (⌘⇧C, menu accelerator), the overlay in
`src/terminal/view.tsx`, `src-tauri/src/conversation.rs` (registered stubs) and `usage.rs` (done).

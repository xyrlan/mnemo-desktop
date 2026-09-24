# Manifest — wave E

Paths under `src/renderer/src/` unless noted.

| Area | Where | What it carries |
|---|---|---|
| Native chat, bridge mode | `components/native-chat/` (the structured/Agent-SDK parts left out) | A Claude session as a chat over its live terminal: message list and rows (user bubbles, quieter thinking, notices), tool runs (`NativeChatToolRun`), diff cards (`NativeChatDiffCard`), approval and question cards (`NativeChatApprovalCard`, `NativeChatQuestionCard`, `NativeChatInteractiveCard` — how they answer the TUI with keystrokes), working status and context-usage ring, the composer with `/` and `@file` autocomplete (`NativeChatComposer*`, `NativeChatAutocompleteMenus`), and how a reply is typed into the PTY (`native-chat-runtime-send.ts`) |
| Claude transcript decoding | `src/main/native-chat/transcript-line-decoders-claude.ts` | Which Claude Code JSONL records map to which chat items |
| Checks panel | `components/right-sidebar/ChecksPanel.tsx`, `components/right-sidebar/checks-panel/`, `components/right-sidebar/check-job-log-tail.tsx`, `lib/fix-checks-agent-launch.ts`; `src/main/github/client/check/{get-pr-checks,get-pr-check-details,check-job-log-tails}.ts` | The worktree PR's header and actions, CI checks with expandable details, annotations and log tail, review comments, "Fix" building an agent prompt from failing checks, and the `gh` calls behind them |
| PR page | `components/pull-request-page/` | Orca's full PR view: header, checks, files and diff, merge — for restyling mnemo's PR pane |

/** The conversation face (round 20): a Claude Code session's transcript
 *  (`~/.claude/projects/<escaped cwd>/<session>.jsonl`) rendered as cards while the real TUI
 *  keeps running in the pane's PTY. Four pieces meet only on the types in this file:
 *
 *  - the tailer (Rust `conversation.rs`) streams raw JSONL lines, never parsed;
 *  - the parser (`parse.ts`) turns records into a `Conversation`;
 *  - the view (`ConversationView.tsx`, `Face.tsx`) renders one;
 *  - the mission pane shows a child's through `ConversationView` too.
 *
 *  Shapes were read off real 2.1.280 transcripts on 2026-09-23 (spec: docs/superpowers/specs/
 *  2026-09-23-conversation-view-design.md). */

/** One JSONL line as `JSON.parse` gave it. The parser is the only reader of its fields. */
export type TranscriptRecord = { type: string; uuid?: string; timestamp?: string; [k: string]: unknown }

/** Where a rule reached the session. `reflex`: UserPromptSubmit `hook_additional_context`
 *  (`• [[slug]]`); `enrichment`: PreToolUse context tied to a tool call by `toolUseID`;
 *  `briefing` / `learned`: the SessionStart block; `mcp`: a `mcp__mnemo__*` tool call. */
export type RuleChannel = 'reflex' | 'enrichment' | 'briefing' | 'learned' | 'mcp'
export type RuleChip = { slug: string; channel: RuleChannel }

/** A pasted or tool-returned image, still base64: the view decodes it only on screen. */
export type ImageRef = { mediaType: string; data: string }

/** One hunk of `toolUseResult.structuredPatch`; `lines` keep their ' ', '-', '+' prefix. */
export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

/** What a finished tool call returned. `null` on a `tool` card means no result yet: running,
 *  or parked on a permission prompt (the transcript cannot tell which; `SessionStatus` can). */
export type ToolOutcome =
  | { kind: 'diff'; filePath: string; created: boolean; hunks: DiffHunk[] }
  | { kind: 'bash'; stdout: string; stderr: string; interrupted: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'error'; text: string }
  /** `toolDenialKind` (user-rejected, permission-rule, interrupted…); `feedback` is what the
   *  user typed with the denial, when anything. */
  | { kind: 'denied'; reason: string; feedback: string | null }
  /** AskUserQuestion: question → the label picked. */
  | { kind: 'answers'; answers: Record<string, string> }

/** `id` is stable across re-derivations (a record uuid, or a tool_use id), so React keys and
 *  expanded/collapsed state survive new lines. `at` is the record's ISO timestamp. */
export type Card =
  | { kind: 'user'; id: string; at: string; text: string; images: ImageRef[]; rules: RuleChip[]; queued: boolean }
  | { kind: 'assistant'; id: string; at: string; text: string }
  | {
      kind: 'tool'
      id: string
      at: string
      toolUseId: string
      name: string
      /** One line: the command, the file path, the pattern — what a chip shows collapsed. */
      summary: string
      input: Record<string, unknown>
      outcome: ToolOutcome | null
      images: ImageRef[]
      rules: RuleChip[]
    }
  /** An Agent/Task call. `report` is the subagent's final text once it is back. */
  | { kind: 'agent'; id: string; at: string; toolUseId: string; description: string; agentType: string | null; report: string | null }
  /** A message another session sent over the inbox socket (`origin.kind: peer`). */
  | { kind: 'peer'; id: string; at: string; from: string; text: string }
  | { kind: 'notification'; id: string; at: string; text: string }
  /** A slash command the user ran (`/clear` never shows: it starts a new transcript). */
  | { kind: 'command'; id: string; at: string; name: string; args: string }
  /** The SessionStart block: mnemo's briefing and what it learned, as chips. */
  | { kind: 'session'; id: string; at: string; source: string; briefing: string | null; rules: RuleChip[] }
  /** A record type this parser does not know: shown as a grey chip so a Claude Code format
   *  change is visible at once instead of silently dropped. */
  | { kind: 'unknown'; id: string; at: string; type: string }

export type PrLink = { number: number; url: string }

/** Everything a transcript says, derived from its records alone. */
export type Conversation = { sessionId: string | null; title: string | null; prs: PrLink[]; cards: Card[] }

/** What the transcript cannot say and the caller knows from `claude agents` / the mission
 *  snapshot: whether the session is generating, and what it is parked on. */
export type SessionStatus = { busy: boolean; waiting: 'permission' | 'question' | null }

/** A thin line in the stream at `at` (a child's `blocked 12:03`, `done`). */
export type StatusMarker = { at: string; label: string }

/** What the tailer sends over its Channel. `start`/`end` are byte offsets of the batch in the
 *  file; `lines` are complete lines only, without the newline. `reset`: the file shrank or was
 *  replaced, drop what you have and wait for lines from 0. `missing`: no transcript yet (a
 *  session that has not written its first line); the tailer keeps looking. */
export type FollowEvent =
  | { kind: 'lines'; start: number; end: number; lines: string[] }
  | { kind: 'reset' }
  | { kind: 'missing' }

/** Earlier lines, for "load earlier": the `count` complete lines ending right before `before`.
 *  `start === 0` means the top of the file was reached. */
export type Chunk = { start: number; end: number; lines: string[] }

# Transcript fixtures

Real Claude Code 2.1.280 transcripts from the maintainer's machine, put through
`scripts/scrub-transcript.mjs --clip 100` and cut to a window of consecutive lines (line numbers
as `sed` counts them). Every string that is not structure is lorem; the ids, types, tool names,
hook names, `structuredPatch` shape and mnemo's envelopes are real. `parse.test.ts` fails if a
long base64 run or a secret shape gets in, or any real word in any case (a class name, another
plugin's tag) outside the keys kept as structure and the envelopes the parser reads.

| file | session | lines | covers |
|---|---|---|---|
| `pane.jsonl` | a pane session | 1–193 | SessionStart briefing + learned, a pasted image, an automode denial, an async subagent and the notification carrying its report, a queued peer message |
| `pane-enrichment.jsonl` | the same session, later | 296–403 | PreToolUse enrichment chips, Write/Edit diffs, an AskUserQuestion left unanswered, a resume, an answered one |
| `clear.jsonl` | a pane session started by `/clear` | 1–156 | the `/clear` command, reflex chips, two subagents, a peer message, queued peers |
| `denial.jsonl` | a pane session started by `/clear` | 1–83 | an interrupt, a subagent, a user-rejected AskUserQuestion with the user's feedback, a slug in the briefing |
| `bg-child.jsonl` | a `--bg` child (`sessionKind: bg`) | 1–41 | reflex chips and a `mcp__mnemo__read_mnemo_rule` call |
| `peer-queued.jsonl` | a pane session | 1–121 | a peer message, a prompt queued while busy (with its reflex chips), `!` commands |

To add one: `node scripts/scrub-transcript.mjs --clip 100 <transcript.jsonl> | sed -n '<a>,<b>p'`,
read the output, then add a row here.

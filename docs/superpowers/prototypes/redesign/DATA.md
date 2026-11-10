# The capture: `window.MNEMO`

What `capture.py` writes to `data.js` from this machine, and `sample.py` to `data.sample.js`
with invented content. `check.py` holds the two to one shape. Times are ISO-8601 UTC strings;
token counts are integers; a field the source did not have is `null` or an empty list, never
missing.

`base/load.js` adds `data.byId` (sessions by id) and `data.now` (the capture time in ms).

## Top level

| field | what it is | source |
| --- | --- | --- |
| `synthetic` | `true` in the sample | |
| `capturedAt`, `windowHours` | when, and how far back ended children were kept | |
| `machine` | `{platform, claude, mnemo}` version strings | `claude --version`, `mnemo --version` |
| `accounts[]` | `{id, label, kind, configDir, active, accountUuid, plan, limits[], usageReadAt}` | `~/.mnemo-desktop/accounts.json`, `plan-usage/*.json` |
| `accounts[].limits[]` | `{kind: session \| weekly_all \| weekly_scoped \| credits, group, model, percent, severity, resetsAt, active}`: the plan's windows as the app last read them | the app's cache of `/api/oauth/usage` |
| `projects[]` | `{name, sessions[ids], xp}`, most sessions first; a worktree's session belongs to its repo's project | `git rev-parse --git-common-dir` |
| `sessions[]` | below, newest activity first | |
| `pending[]` | what waits for the maintainer, oldest first | derived, below |
| `vault` | `{xp, projectXp{name: xp}, rules, reflex{prompts, outcomes{reason: n}}, learned[{at, slug, name, projects}]}` | mnemo's vault logs |

## A session

Identity and place:

| field | notes |
| --- | --- |
| `id`, `short` | the Claude Code session id and its first 8 characters |
| `role` | `parent` (a session the maintainer talks to) or `child` (one mnemo dispatched) |
| `parent`, `children[]` | ids; `parentMissing: true` when the parent is outside the capture |
| `agentKind` | `interactive` or `background` |
| `live` | a process is running it now |
| `project`, `cwd`, `branch`, `worktree{name, branch, path, from}` | |
| `title` | Claude Code's own title for the session (`ai-title`), else the child's name |
| `name` | the short name `claude agents` lists |
| `account` | an `accounts[].id` |
| `model`, `effort`, `advisor`, `permissionMode` | the last main-chain call's model; `advisor` only on children |
| `startedAt`, `lastAt` | |

State: `state` is one of

| state | meaning | from |
| --- | --- | --- |
| `need` | waits for the maintainer: an unanswered question, a permission prompt, a block | `AskUserQuestion` with no result in the transcript; `claude agents` `blocked`/`waitingFor`; mnemo's `needs`/`is_blocked` |
| `working` | acting on its own right now | `claude agents` `busy`; mnemo's `tempo: active` on a live child |
| `ready` | over, and a pull request it opened is still open: a merge waits | transcript `pr-link` + `gh pr view` |
| `stalled` | stopped without finishing | mnemo's `stall` |
| `idle` | live, its turn is over: the maintainer's move, with no question asked | |
| `ended` | no process, nothing waiting | |

`abandoned: true` marks a `need` nobody has answered for so long that mnemo gave up on it.

What it is doing, in words it wrote itself (no model is asked to summarise anything):

| field | notes |
| --- | --- |
| `recap{at, text}` | Claude Code's own "while you were away" summary, the newest one |
| `lastPrompt` | the maintainer's last typed prompt |
| `said{at, text}` | the last thing the session said |
| `intent`, `detail`, `needs`, `suggestedReply`, `may[]` | children only: the dispatch prompt's opening, mnemo's status line, what it waits for, what it may publish |
| `pendingAsk{id, at, question, options[{label, description}]}` | the unanswered question, with its choices |
| `turns`, `turnMs` | prompts typed, and time spent inside turns |

Tokens. One API message is counted once (its last transcript record wins); each row is
`{input, output, cacheRead, cacheCreation, thinking}`, where `thinking` is the part of
`output` spent thinking.

| field | notes |
| --- | --- |
| `tokens.main` | the session's own calls |
| `tokens.sidechain` | calls made on a side chain inside the same transcript |
| `tokens.subagents[]` | `{id, description, type, model, calls, tokens}`, one per sub-agent transcript beside the session's |
| `tokens.byModel{model: row}` | main and side chain together |
| `totals.own` | main + sidechain + every sub-agent |
| `totals.tree` | `own` plus the `own` of every child in the capture |
| `cost{usd, apiMs, toolMs, linesAdded, linesRemoved}` | what Claude Code itself recorded, when it did (mostly at exit, so a live parent is often `null`) |

Context:

| field | notes |
| --- | --- |
| `context.tokens` | the size of the context now: input + both caches + output of the last main-chain call. Measured against Claude Code's own `preTokens` at 108 compactions: median error 0.00%, largest 0.4% (`measure_context.py`) |
| `context.window` | 1,000,000 when the session asked for the 1M beta or has ever passed 200k, else 200,000 |
| `context.percent` | |
| `context.series[[at, tokens]]` | the curve, call by call, thinned to about 240 points |
| `context.compactions[{at, pre, post, trigger}]` | each time the context was compacted |

Activity:

| field | notes |
| --- | --- |
| `activity[]` | the newest 400 tool calls, oldest first: `{at, tool, kind, target, running, ok, ms}`. `running` is true while no result has come back |
| `activity[].kind` | `read`, `search-code`, `edit`, `write`, `shell`, `web-search`, `web-fetch`, `browser`, `artifact`, `agent`, `message`, `skill`, `ask`, `memory` (a mnemo MCP call), `mcp`, `meta`, `other` |
| `activityTotal`, `activityCounts{kind: n}` | over the whole session |
| `timeline[{t, kinds{kind: n}}]` | tool calls per 5-minute bucket inside the capture window |
| `files.edited[{path, edits, lastAt}]`, `files.read[{path, count}]` | |
| `prs[{number, url, repo, state, draft, title, ci, mergeable}]` | `ci` is `green`, `red`, `running` or `null` |

What it sees on the web:

| field | notes |
| --- | --- |
| `web.searches[{at, query, results[{title, url}]}]` | `WebSearch` |
| `web.fetches[{at, url, code, bytes, ms, summary}]` | `WebFetch`; `summary` is what the session got back |
| `web.pages[{at, url, title}]` | pages its browser tools were on |
| `web.shots[{at, url, title, src}]` | the newest screenshots its browser tools took: the picture the session itself looked at, as a file path relative to this folder |
| `web.artifacts[{at, url, title}]` | artifacts it published |

What it read from memory:

| field | notes |
| --- | --- |
| `memory.instructions[{path, type, at, bytes}]` | the files Claude Code loaded at the start: `type` is `Project` (a `CLAUDE.md`), `User`, `AutoMem` (its `MEMORY.md` index) and so on |
| `memory.claude[{at, path, file, op, via}]` | every later touch of Claude Code's own memory: `file` is `claude-memory` or `claude-md`, `op` is `read`, `write` or `edit` |
| `memory.skills[{at, name}]` | |
| `memory.briefings[{at, project, date, path, source, entries}]` | the session briefings mnemo handed it at start |
| `memory.injected[{at, slug, score, judge}]` | rules mnemo put into a prompt: `score` is the retrieval score, `judge` the relevance a small model gave it (0–1) |
| `memory.considered[{at, reason, candidates[{slug, score, judge}]}]` | prompts where mnemo found candidates and stayed silent, and why (`judge_none_relevant`, `notice_below_bar`, `deduped`, …), newest 40 |
| `memory.prompts` | how many of the session's prompts mnemo looked at |
| `memory.read[{at, tool, slug, topic, query, hits[], count, ms}]` | rules the session itself asked mnemo for over MCP |
| `memory.frictions[{at, quote, rule, origin}]` | corrections the maintainer gave in this session that mnemo wrote down as candidate rules |

## `pending[]`

`{session, kind, text, options[], suggestedReply, at, pr}` with `kind` one of `question`,
`permission`, `blocked`, `merge`, `stalled`. `options` are a question's choices; `pr` is on a
`merge`.

## What this capture is not

A snapshot, not a feed: a concept that shows something "live" animates the capture. A
terminal is not in it either; a concept draws a session's conversation from `lastPrompt`,
`recap`, `said` and `activity`, and marks the place where the real terminal will sit.

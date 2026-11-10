# Score: the whole day on one page

Read `../README.md` first (what was asked, what is wrong today, the rules every concept
keeps) and `../DATA.md` (the data). This file is the direction; how to build it is yours.

## The idea

Time runs left to right, and every parent session is a line of the score. On its line is
what it did: each tool call a mark, coloured and shaped by kind; the context a filled curve
that climbs and falls off a cliff at each compaction; each rule mnemo gave it a diamond; each
prompt the maintainer typed a bar line. A child branches off its parent's line at the moment
it was dispatched and ends where its pull request opened or merged. The right edge is now,
and now is where he acts.

Nothing else can draw this: it needs the transcripts, mnemo's logs and the dispatch records
together. It answers questions the current app cannot be asked: what happened while I was
away, which session ate the afternoon, when did this one last compact, did mnemo's rule
arrive before or after the mistake.

This is the direction that bets on showing something new. Its risk is density: a wall of
marks nobody reads. The answer is hierarchy: at a glance it is a calm, legible picture of the
day; detail arrives with zoom and with the cursor, never all at once.

## What it must show

**The now column.** Fixed at the right edge, one card per line: the session's full title,
project, state as a shape and a word, what it is doing this second, context filling, what
its tree has spent. Lines order by attention, grouped by project. This column alone is a
complete, usable roster; the past stretches out to its left.

**The lines.** For each session over the capture window (`timeline`, `activity`,
`context.series`, `context.compactions`, `memory.*`, `web.*`, `prs`): the rhythm of work and
silence, the context curve, memory arriving, the web being read, files changing, pull
requests opening and merging. Children as branches. Zoom from two days down to a few
minutes; pan; a ruler with real times.

**The playhead.** Moving it left replays: the now column shows every session as it was at
that moment (state then, context then, spent by then). Letting go returns to now.

**The inspector.** Selecting a line, or a point on it, opens that session beside the score:
where its terminal will sit (drawn as `DATA.md` says, and scrolled to the selected moment),
and three readings, each tied to the selected time:

- *Context and tokens:* how full, what it spent by kind, what its sub-agents and its tree
  spent, the account's plan windows drawn on the same time axis with their resets.
- *Memory:* what it loaded at the start, what it touched of Claude Code's memory, the
  briefings, the rules injected with scores, the rules it asked for, and what mnemo
  considered and held back, with the reason.
- *Sight:* pages with the screenshots it took, searches and their sources, fetched
  documents, artifacts, files, pull requests.

**Pending.** What waits for him is at the now edge of its line, and the line shows how long
it has been waiting. A question is answered there, with its choices as keys; a merge is
approved there. One key walks the pending items; sessions can be reached by keyboard without
the mouse.

**The top strip.** The fleet as a whole over the same axis: tokens per interval across all
sessions, and each account's plan windows.

## What would make it the one he picks

Coming back after two hours away and reading, in ten seconds, everything that happened and
what is waiting.

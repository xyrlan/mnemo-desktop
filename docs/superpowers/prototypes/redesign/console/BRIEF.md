# Console: one roster, one stage

Read `../README.md` first (what was asked, what is wrong today, the rules every concept
keeps) and `../DATA.md` (the data). This file is the direction; how to build it is yours.

## The idea

The app is an instrument, and the hands never leave the keyboard. Every parent session is
always on screen, whole, in one roster ordered by who needs the maintainer. One of them is on
the stage, with its terminal. Everything known about the session on stage stands beside it,
already open. There is no second screen to go to and nothing to hover for.

This is the direction that bets on speed of use. Its risk is looking like a well-made
sidebar app; the answer to that risk is craft: type, rhythm, light and motion that make a
dense panel feel like a cockpit instrument, on black.

## What it must show

**The roster.** One entry per parent session, none truncated to a stub: its title in full,
its project, its state as a shape and a word, the one line that says what it is doing now
(the running tool, else its own recap, else what it last said), how full its context is, and
what its tree has spent. Its children sit inside its entry, each with its own state, so a
family reads as a family. Order follows attention: what waits for him first, then what is
working, then the quiet ones; ended sessions fade and fold. Projects stay visible as a
grouping or a mark, his choice at a keystroke.

**The stage.** The selected session: where its terminal will sit (drawn from the session's
own words and activity, as `DATA.md` says), its family across the top so a child is one key
away, and what it is doing at this moment.

**The instruments,** always open beside the stage, for the session on it:

- *Context and tokens.* How full the context is against its window, the curve with its
  compaction cliffs, what the session spent (input, output, cache read, cache written,
  thinking), what its sub-agents spent, what its tree spent, and the account's plan windows
  with their resets.
- *Memory.* What it loaded when it started (`CLAUDE.md`, `MEMORY.md`), what it touched of
  Claude Code's memory since, the briefings mnemo handed it, the rules mnemo injected with
  their scores, the rules it asked for, and the ones mnemo considered and held back, with
  the reason. The last of these is something no other tool can show; give it room.
- *Sight.* What it is looking at and making: pages with the screenshots it took, searches
  with their sources, fetched documents, artifacts, files edited and read, its pull
  requests.

**Pending.** What waits for him is the top of the roster, not another place. A question is
answered where it is listed, with its choices as keys; a merge is approved there; a blocked
child's error is read there. One key walks from one pending item to the next, across parents
and children alike, and the count of what is left is always visible.

**Fleet commands.** A command line reachable from anywhere (new session, dispatch, message,
merge the green ones, stop) that completes against the real sessions and projects.

## What would make it the one he picks

Moving through ten sessions and answering three things without touching the mouse, and never
once wondering which session he is looking at.

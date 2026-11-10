# Score: notes

The prototype `BRIEF.md` describes: time runs left to right, every session is a line, and the
right edge is now. Open `index.html` from disk (`?data=sample` for the synthetic capture).
`shots-sample/` has the main states on the sample at 2560×1440, and one at 1366×768.

    index.html   the page: a bar, the fleet strip and ruler, the score, the now column, the inspector
    model.js     what is derived from the capture (spans, marks, a session at a past moment, row order)
    draw.js      the canvases (score, ruler, strip, the inspector's context chart) and hit-testing
    app.js       state in the hash, the DOM (cards, inspector, overlays), pointer and keys
    score.css    layout and everything that moves

## Reading the page

- **A line** is one session over time. Above it, its context as a filled curve between the
  line (empty) and a dotted ceiling (a full window); a compaction is a cliff with a ▾ over it.
  The curve's edge turns amber above 85%.
- **Under the line**, four lanes of tool calls, by what a call does: changes a file, runs
  something, reads or searches, reaches out (web, sub-agent, the maintainer). From far away a
  lane is 5-minute buckets, brighter where more happened; once a bucket is 7 px wide each call
  is drawn on its own, as long as it took. A failed call is a red ✕ at any distance.
- **Above the curve**, memory: a filled violet diamond is a rule mnemo gave, with a hairline
  down to the line so it can be read against the calls under it; a hollow one is a rule the
  session asked for; a violet dot is a prompt where mnemo held back; a small square is a touch
  of Claude Code's own memory.
- **Vertical hairlines** through a row are prompts (bar lines).
- **A child** leaves its parent's line where it was dispatched and runs on its own row. It
  ends in a green ▲ (a pull request waits), a green ring (merged), a red ✕ (stalled) or a tick.
  Three or more ended children fold into one thin "ensemble" lane; `F` or a click unfolds it.
- **What waits** is dashes walking toward now, from the moment it began waiting, in its
  state's colour, with the wait written on it. Selecting the line opens the question in its
  card, where the line meets now, with its choices as keys.
- **A session's name** is written in the empty time before it started, next to its line, as
  well as in its card.
- **The now column** is a complete roster by itself: project groups, most urgent first; a
  parent rises with its most urgent child.
- **The playhead**: drag on the ruler or the strip and the now column shows every session as
  it was; let go and it returns (Shift holds it). `←` `→` step it. Clicking a point on a line
  selects the session at that moment: the terminal scrolls there and the three readings dim
  what had not happened yet.

Every state is in the hash (the header of `app.js` lists the parameters). `?` opens the keys.

## Decisions

- **Canvas for the score, DOM for everything that moves.** On this machine's capture (37
  sessions, 3,738 tool calls) a full render, cards and canvases together, measured 8 ms in
  headless Chrome at 2560×1440, and 41 ms with the inspector open (its terminal is up to 400
  rows). It happens only on zoom, pan, scroll, resize or a state change. The playhead, the dimming to its right, the
  waiting dashes, the pulses and the selection band are DOM over a transparent canvas, so a
  replay or an animation never redraws it. There is no `requestAnimationFrame` loop: one
  frame is requested per input event, and nothing runs at rest.
- **Motion is CSS on `transform` and `opacity` only** (the core's rings, the seam's glow, the
  dashes, the pulses, the stars, the caret), so it stays off the main thread and stops with
  the tab. The motion switch is in the bar at every size.
- **The inspector opens to the right of the now column**, so the page reads past → now →
  this session. At 2560 the score keeps half the width with it open; at 1366 it keeps 616 px.
- **Rows are laid out by the DOM** (the cards), and the canvas reads their positions. A
  pending card can then grow in place to hold a question without the two sides drifting.
- **The lanes are a position, not a colour.** Colour is kept for signals: the state hues,
  violet for mnemo, red for a failure, amber for a context that is nearly full.
- **Lines are ordered by attention and stay put during a replay.** Answering something
  re-orders them, because the answer changes what needs attention.
- **Ended children fold by default** only when there are three or more, so a parent that
  dispatched eleven does not push the next parent off the screen.
- **A pending item is answered only at now.** While the playhead is held in the past the
  card shows what the session was doing then; an answer key returns to now first.
- **Default zoom is 12 hours ending now**; 48h to 30m are one click, the wheel over the ruler
  goes down to 10 minutes and out to 14 days.
- **No model summarises anything.** Every sentence on the page was written by a session, by
  Claude Code or by mnemo, or is a count.

## What is estimated, and what is faked

Marked with `≈` on the page wherever it shows.

- **Spent by a past moment.** The capture has totals, not a history. A session's total is
  shared out along its context curve (a call costs about the context it carries), so
  "spent by 15:20" and the fleet strip's tokens per interval are estimates. Sub-agents'
  tokens are spread the same way.
- **State at a past moment.** Working where tool calls are, idle where they are not, waiting
  from the pending item's time, not started before the first record.
- **Prompt bar lines.** The capture has no prompt times. A bar line is a moment mnemo looked
  at a prompt (`memory.injected` and `memory.considered`), so prompts mnemo skipped are
  missing and only the newest 40 held-back ones exist.
- **Where a child ends.** A pull request has no opened or merged time; the mark sits at the
  child's last record. A parent's own pull requests are listed in Sight, not on its line.
- **The start of a plan window** is its reset minus its length (5 hours, 7 days).
- **The terminal** is a stand-in (`data-asset="terminal-pane"`): the session's tool calls,
  the rules mnemo gave, compactions, its last prompt, what it last said and what it asks, in
  time order. The last prompt is placed at the last bar line before the reply.
- **Answers and approvals** change the page (`&done=` in the hash) and nothing else. An
  answered question shows the session as working again; that is the page's guess.
- **Only the newest 400 tool calls** of a session are in the capture; before them the line
  falls back to the 5-minute buckets, and the terminal says how many are missing.
- **"Live"** is the capture's moment. Nothing updates; the pulses and dashes are CSS.

## What the capture would need for this to be true

| wanted | for |
| --- | --- |
| `prompts[{at, text}]` per session | real bar lines, and the prompt text at each |
| tokens per call (or per 5-minute bucket) | the strip, and "spent by then", without the estimate |
| `prs[].openedAt`, `mergedAt` | pull requests on a parent's line; a child's true end |
| a state history (`states[{at, state}]`) | the replay's states |
| the time the maintainer last looked | shading "while you were away" on the axis |
| past plan windows per account | the strip's account lanes further back than the current window |

## Generated art

Each stand-in is marked `data-asset`. What would be generated in its place:

| asset | what it is | where | still or loop | size |
| --- | --- | --- | --- | --- |
| `memory-core` | mnemo's central piece: a core of light held inside thin concentric rings that turn at different speeds, as if reading a groove. White on black, no colour. | top of the now column, beside the seam | loop, 8–12 s, seamless | 92 px shown; 512 px source with alpha |
| `memory-rings` | the core's rings carried across the whole page behind the score: very faint, broken, concentric arcs | behind everything, centred on the core | still | vector, or 6000 px |
| `now-seam` | the vertical blade of light where the past meets now | between the score and the now column, full height | loop, slow breathing | 16 px × full height, tiled vertically |
| `session-figure` | one small figure per session, so two sessions never look alike: today a constellation worked out from the session id | in each card, and larger in the inspector's header | still; a short loop for a working session | 28 px and 46 px; 128 px source |
| `starfield` | sparse stars, a few of them breathing | the page's ground | still, or a very slow loop | tileable 2560×1440 |

A figure per session is the piece that most needs to be generated: the procedural one tells
sessions apart but carries no meaning. A generated figure seeded by project (a family
likeness) and by session would let a session be recognised before its title is read.

## Limits

- Times are the browser's local time; a daylight-saving change inside the window is ignored.
- Rows are not virtualised. 37 sessions are fine; several hundred would need it.
- Pointer and keys only; touch pans the page but does not replay.
- At 1366×768 with the inspector open, a child's card shows its title, state and context,
  and drops what it spent.

## Checked

`python check.py` (0 differences), then every state in `shots-sample/` with `shot.py` on both
captures at 2560×1440 and 1366×768 with no console error. Keys and the pointer were driven
through the DevTools protocol in headless Chrome on both captures: every line × every reading
× the terminal × a replay step, the pending walk with each kind of answer, hover, click on a
line, drag on the ruler, wheel zoom and pan. No console error.

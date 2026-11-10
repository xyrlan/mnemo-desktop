# Console: notes

What was built for `BRIEF.md`, what was decided, what is faked, and what it would have
generated in place of its stand-ins. Open `index.html` from disk; `?data=sample` forces the
synthetic capture.

    python console/shots.py            # the sample states -> console/shots-sample/, fails on a console error
    python console/shots.py --real     # this machine's data.js -> ../shots/console/ (gitignored)

## The screen

One screen, three columns, a line above and a line below. Nothing opens over the terminal
except the key sheet and an enlarged screenshot, and both close on any key.

- **Top line.** The count of what waits for him (a key walks it), the fleet by state, each
  account's plan windows (the staged session's account is the bright one), the motion switch.
- **Roster** (left). Every root session, most in need of him first.
- **Stage** (middle). The session's figure and name, its family, what it is doing now, the
  rhythm of its tool calls, and the terminal.
- **Instruments** (right). Context and tokens, Memory, Sight, all for the session on stage.
- **Command line** (bottom), with the keys that matter beside it.

## Decisions

**What waits is in the roster, on the row of the session that waits.** There is no pending
list. A waiting item is one line under its session until that session is on stage; then it
opens, with its choices as keys. The same choices, with the same keys, close the terminal's
transcript, because that is where the real question will be printed.

**Every kind of waiting is a short keyed list,** so one habit answers all of them: a digit.
A question's choices are its own. The others are this page's: a permission is allow once,
always allow, deny; a merge is merge (or "merge when green" while checks run) or send back;
a stalled or blocked session is resume or stop. `R` answers in words instead. `U` takes the
last answer back.

**A digit never means two things.** Digits answer; they do not also pick a child. The family
is walked with left and right, which wrap, so any child is at most a few presses away and the
first is one. The brief asked for "a child is one key away"; this is the trade made for it.

**`N` walks in roster order, not oldest first,** so the eye moves down the list instead of
jumping between families. Within the waiting band, families order by their oldest open item,
and a need mnemo gave up on (`abandoned`) goes behind the fresh ones.

**A family's place follows its most urgent member.** A parent whose turn it is, with a child
that waits for a merge, is in "Waiting for you". Bands: waiting (need, stalled, ready),
working, your turn, ended. `G` regroups by project; inside a project the same order holds.
In both, a project is a three-letter mark on every entry (derived from its name, unique in
the capture) and its full name beside it.

**Every parent stays on screen.** The roster is drawn at up to four densities and takes the
first that fits its height: as designed; quiet entries on two rows instead of three; every
entry not on stage on two rows; and last, ended sessions gathered into one line and ended
children of the staged family kept behind their count. Height left over at the level that
fits goes back to the entries highest in the list. A two-row entry still carries the full
title, the project mark, state as shape and word, one line of what it is doing, context and
spend; it loses the context bar and the project's full name. Measured on this machine's
capture (18 roots, 40 sessions): at 2560×1440 all 18 are on screen, with the longest waiting
item open; at 1920×1080 11 or 12 of 16 rows are whole and the rest scroll; at 1366×768 the
roster scrolls and follows the selection. On the sample (9 roots) everything is whole at
2560×1440 and 1920×1080.

**Never wondering which session is on stage.** Its entry is lit and a white beam slides to
it; its name is the largest thing on the screen; its figure is drawn in both places; its
account is the bright one in the top line; its row is the bright one in its tree's spend.

**The instruments are three at 2560 wide and one at a time below 2300.** Wide: Context and
Sight share a column, Memory has one to itself (the brief asked to give "held back" room).
Narrower: all three headers stay, each with its headline numbers, and `C` `M` `S` open one.

**Memory leads with what mnemo held back.** The dial is the session's life as one turn of a
clock, start at twelve: inner ring the rules mnemo gave it (larger when the judge scored them
higher), middle ring the rules it asked for, outer ring the prompts where mnemo found
candidates and stayed silent. Below it "Held back" comes first: each silent prompt with its
reason and every candidate's retrieval score and judge score.

**Empty lists do not take a section each.** Memory and Sight draw what the session has and
close with one line naming what it has not, so a session with nothing on the web is not four
empty boxes.

**Colour is only a state.** The five state hues of `base.css` and the memory violet, nothing
else. Token kinds, plan windows and the context curve are white at different strengths. A
context at 80% or more is brighter, not another hue.

**Motion.** CSS only: no `requestAnimationFrame`, no timer, no canvas. At rest the loops are
the state marks (a working dot's ring, a waiting diamond's blink, a running check's turn) and
the sweep on a running tool, all `transform` or `opacity`. Changing session slides the beam,
turns the figure in, and lets the stage and instruments rise; nothing "enters" on the first
draw, so a screenshot of a URL is never taken mid-fade. The switch in the top line and
`prefers-reduced-motion` end all of it through `base.css`.

**Sizes.** One root font size: 16px from 2300 wide, 14px to 1600, 12.5px below. Under 900px
of height the stage's head gives rows back to the terminal.

## Keys

| key | does |
| --- | --- |
| `↑` `↓` or `J` `K` | previous and next session |
| `←` `→` or `H` `L` | through the family: parent, then each child |
| `Home` `End` | top and bottom of the roster |
| `Tab` | the session he was on before |
| `N`, `Shift+N` | next and previous thing waiting |
| `1`–`9` | answer what the session on stage waits for |
| `R` | answer in words (the terminal's prompt takes them) |
| `U` | take back the last answer |
| `C` `M` `S` | context, memory, sight; `PgUp` `PgDn` scroll the open one |
| `Enter` | type into the terminal |
| `Z` | the terminal takes the instruments' room, and gives it back |
| `G` | roster by attention or by project |
| `:` or `/` or `Ctrl+K` | the command line |
| `?` | this list |
| `Esc` | leave whatever is open |

The command line completes verbs, then sessions or projects: `new <project> <prompt>`,
`dispatch <parent> <task>`, `message <session> <words>`, `merge green`, `merge` (lists each
waiting pull request), `stop <session>`, `go <session>`, or just part of a session's name.
`Tab` completes, arrows choose, `Enter` runs.

## The view is the hash

| key | value |
| --- | --- |
| `s` | the session on stage, by its short id |
| `i` | `memory` or `sight`: the instrument open when there is room for one (default context) |
| `g` | `project`: the roster grouped by project |
| `a` | answers given, as `<pending index>.<action index>` joined by `-`, e.g. `a=3.0-4.1` |
| `cmd` | the command line's text while it is open |
| `t` | `1`: typing in the terminal |
| `z` | `1`: the terminal has the instruments' room |
| `help` | `1`: the key sheet |
| `shot` | the index of the staged session's screenshot shown large |

## What is faked

- **The terminal.** It is drawn from `lastPrompt` (a child's `intent`), the newest 90 tool
  calls, `recap` and `said`, and it marks where the real one mounts. The capture has no time
  for the last prompt, so it is placed before the newest burst of tool calls (a gap of more
  than five minutes starts a burst): a guess. Words typed into it are appended to the page.
- **Nothing is live.** The capture is a snapshot. "Running 4m" is the age at capture; the
  moving marks are loops, not data.
- **Answers, merges and commands** change this page and nothing else. What a session becomes
  after an answer is invented: answered or allowed, working; denied, your turn; merged or
  stopped, ended. Only `a` survives a reload; sessions made with `new` or `dispatch`, sessions
  stopped, and words typed do not.
- **The choices of a permission, a merge, a stalled or a blocked session** are this page's;
  only a question's options come from the capture.
- **Sessions made with `new` and `dispatch`** exist in the page only, with empty instruments.
- **Session figures** are constellations computed from the session id. **Project marks** are
  computed from the project name.
- **The reasons mnemo held a rule back** are mnemo's reason codes reworded by a table in
  `console.js`; a code the table does not know is shown as it came.
- **The memory dial's clock** runs from the earliest memory event or the session's start,
  whichever is first, to its last activity. The sample has rules stamped before the session
  began; they are placed at their own time.
- **Plan windows** are what the app last read, not a fresh read.

## Generated art wishlist

Each stand-in carries `data-asset`. What would be generated in its place:

| asset | what it is | where | still or loop | size at 2560×1440 |
| --- | --- | --- | --- | --- |
| `mnemo-core` | mnemo's own piece: rings of memory around a core, thin white line | top-left, beside the wordmark | still; a slow loop for the first second after launch | 30 px, drawn for 64 px |
| `session-figure` | one figure per session, recognisably its own, in a family per project | the roster entry, and large inside the context ring on the stage | still in the roster; a slow loop on the stage while the session works, still otherwise | 38 px and 29 px in the roster, 60 px inside a 112 px ring on the stage |
| `stage-field` | the light the staged session stands in: line art and a glow radiating from its figure, behind its name | the stage's head, full width | still | about 1000 × 190 px |
| `memory-core` | the centre of the memory dial, in the memory violet | Memory, top | loop: a slow breath, quicker for a moment when a rule is given | 40 px in a 248 px dial, drawn for 96 px |
| `all-clear` | what the top line shows when nothing waits | the top line's pill, in place of the count | a loop that plays once when the last item is answered, then still | 10 px now; 24 px wanted |

Not asked for: a backdrop behind the whole window. Ten still stars are enough at this
density, and a picture behind text that is read for hours works against it.

## Limits known

- One open item per session is armed at a time; a second one on the same session waits its
  turn under it.
- `Tab` is taken from the browser's focus order on purpose; a real build needs another way to
  reach the links (pull requests open in a new tab with the mouse only).
- The instruments do not search or filter; a session with 40 held-back prompts is scrolled.
- Below 2300 wide only one instrument is open, so "everything beside the stage, already open"
  holds at his size and degrades to "one key away" below it.

## How it was checked

- `python check.py`: 0 differences between the sample and this machine's capture.
- `python console/shots.py` and `--real`: 29 states photographed over both captures at
  2560×1440, 1920×1080 and 1366×768, no console error. The nine sample pictures in
  `shots-sample/` are from that run. A page that never draws logs no error, so the page
  writes one `console.info` line when it has drawn ("mnemo console drew 15 sessions, 5
  waiting, styled") and `shots.py` fails a state that lacks it.
- Nine mutations against `shots.py`, all caught: four that throw (one in every state, three
  in one state each: key sheet, enlarged screenshot, command line), three that draw nothing
  or collapse the layout without an error, and a missing script and stylesheet.
- Driven with real key and mouse events in headless Chrome over its debugging port (the
  driver was a scratch script, not part of this folder): 57 keyboard assertions and 25 mouse
  assertions on the sample, covering every key above and every command; then every session
  of both captures put on stage at the three sizes with each instrument open, checking for a
  console error and for anything wider than its box. That pass found, and this folder fixes,
  a roster line that overflowed at 1366 and a stage photographed mid-fade.

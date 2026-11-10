# The recreation's front, first wave: what each piece delivers

2026-11-10. `2026-11-10-recreation-design.md` is the design and its reasons; read it first.
This says what each piece of the first front wave must deliver and what all of them hold to.
How a piece is built is its own business.

## What is already here (the seam)

The branch `redesign/app` carries, working end to end on the synthetic world:

- `src/world/`: the model every view reads. `types.ts` (`World`, `Session`, `Pending`, …),
  `store.ts` (`useWorld`, `sessionOf`, `roots`, `childrenOf`, `rosterOrder`, `pendingOf`,
  `pendingInOrder`), `route.ts` (the shared selection and view: `useRoute`, `go`, `select`,
  `openOnStage`), `actions.ts` (`actions()`: everything a view can do), `format.ts`,
  `pending.ts`, `sample.ts` (the synthetic world and its actions), `capture.ts`, `start.ts`.
- `src/ds/`: `tokens.css` and the primitives (`StateMark`, `Kbd`, `Label`, `Pill`, `Meter`,
  `Ring`, `Figure`, `Mark`, `Lattice`, `Starfield`).
- `src/frame/`: the frame that mounts when `localStorage['mnemo.next'] = '1'`, with the top
  bar and the three views side by side.
- A placeholder for every piece, in its own folder, exporting the component the frame
  already renders. A piece replaces its placeholder and keeps its exported signatures.
- `tools/preview/fixtures/next.mjs` and `scenarios/next.mjs`: the new front in the preview
  harness (`next-orbit`, `next-console`, `next-score`).
- `docs/superpowers/prototypes/redesign/`: the three prototypes. They are the reference for
  how each view looks, moves and behaves, down to the pixel where the design did not change
  it. Open them from disk (`console/index.html?data=sample`, and so on) and read each
  `NOTES.md`: the decisions in them were made on the maintainer's real data and stand unless
  the design document says otherwise. They are static pages in plain JavaScript; the product
  is React and TypeScript on `World`, and is not a transliteration.

## What every piece holds to

**The world is the contract.** A view reads `useWorld` and `useRoute`, acts through
`actions()`, and calls no Tauri command. It works on `?world=sample` with no core. If a view
needs something the world does not carry, it derives it from what is there, or says so in
its pull request; it does not edit `src/world/` or another piece's folder.

**It is seen, not assumed.** Every state worth looking at has a scenario in
`tools/preview/scenarios/next-<piece>*.mjs` (use `next()` from `fixtures/next.mjs`; `drive`
presses keys). The piece photographs its states at 2560×1440, 1920×1080 and 1366×768 with
`node tools/preview/shot.mjs`, looks at the pictures (the Read tool opens a PNG), and
iterates until they hold up beside the prototype's own screenshots: striking, every session
told from the next, nothing cut off, overlapping or empty. The maintainer's screen is
2560×1440 and that is the size to compose for. The pull request carries the pictures.

**Tests cover behaviour, not markup:** what a key does, what order things are in, what an
answer changes, what a number says. They run on the sample world or on a world built in the
test. The suite is `npx -y pnpm@10.34.9 test` with `MNEMO_AGENT` unset (and
`npx -y pnpm@10.34.9 install --frozen-lockfile` first in a fresh worktree), plus
`npx -y pnpm@10.34.9 exec tsc --noEmit`. Cargo is not needed for a front piece.

**Identity.** Black; colour only as a signal (the state hues, and violet for mnemo's
memory); Jura for names and numbers, Geist for sentences, JetBrains Mono for what a terminal
printed; state is a shape and a word before a colour. Styles are plain CSS beside the
component, scoped under the frame's `.mn` root and prefixed with the piece's name; sizes in
`em`, so the frame's three root sizes scale everything. No new dependency without a reason
the pull request states.

**Motion.** It should feel alive, and it must cost nothing at rest: CSS on `transform` and
`opacity`; a canvas draws only when something changed (or, for the lattice, while it is on
screen and the window is visible); no timer or `requestAnimationFrame` loop that runs when
nothing moves. Everything honours the frame's `data-motion="reduced"` and
`prefers-reduced-motion`. A screenshot taken of a URL is never caught mid-entrance.

**Keys.** A view handles keys only while focus is inside it and never inside a terminal or
a text field; the fleet-wide keys of the design's table belong to the frame. A view exposes
what those keys need as functions, not as its own listener on `window`.

**Words.** Interface text is English, plain and short. The data is whatever the sessions
spoke. Pull requests target `redesign/app`.

**This repository is public.** Fixtures and screenshots use the synthetic world only. No
real project name, prompt or home path goes into a file, a commit or a pull request.

## The pieces

### ds

The design system, finished: the primitives at the quality of the prototypes (the figure
that Console and Score each drew, the state marks and their motion, the lattice tuned
against the generated still `src/ds/art/lattice-still.jpg`, the mark as the hairline
crystal of `src/ds/art/crystal-still.jpg`), and what the views should not each reinvent: a
context curve with its compaction cliffs, a bar and a row for "spent by kind", a ring, a
tooltip-free way to show a full value, an empty-state line. A gallery page shows every
primitive in every state and is a preview scenario. `src/ds/art/` holds the generated art
with `ART.md`. The signatures already exported stay as they are.

### orbit

`OrbitView` and `OrbitMap`. The scene of the Orbit prototype on the world: bands of
attention, projects on the rim, a body per root session with its moons, every body carrying
its full title, placed by a solver; the lattice at the centre (the ds component, replacing
the prototype's seed head) with the rule count; memory in flight from `world.vault.recent`
and `world.events`, leaving from a lattice node; a waiting item's card opening on its body
(`PendingCard`). Arrow keys move between neighbours, typing finds a session, Enter opens it
on stage (`openOnStage`). Opening the centre shows the vault (the prototype's vault view).
`OrbitMap` is the same scene small, with `focus`'s family lit, for the roster's head. The
prototype's station is not part of this piece: the stage is Console's.

### roster

`Roster`. Console's roster as the prototype has it: every root session whole, children
inside their parent, bands by attention with `G` regrouping by project, the densities that
keep every parent on screen, the entry on stage lit and the beam that slides to it, the
waiting item open under its session (`PendingCard`), the map at its head (`OrbitMap`). It
exposes the order it shows (it is `rosterOrder`) and scrolls the selection into view.

### pending

`PendingCard`, `armedPending`, `nextPending`, and a compact `WaitingCount` for the top bar.
One card for every kind of waiting, drawn the same in a roster entry, on a body in Orbit, at
a line's now edge in Score and at the foot of the stage's transcript: the text, how long it
has waited, its choices as digits, "in your words" (a text field that calls
`actions().reply`), the outcome said in place when an action refuses, and the settled state
when it is answered. Choosing calls `actions().answer`. It exposes `answerArmed(key)` and
`replyArmed()` for the frame's keys.

### stage

`Stage`. Console's middle column: the session's figure, name and facts (project, branch,
model and effort, account, started, turns), its family across the top with left and right
walking it, what it is doing now, its tool-call rhythm, and its terminal. The terminal is
`LiveTerminal` when `canHost(session)`; otherwise the transcript drawn from the world (the
last prompt, the calls, what it said, its recap), which is also what the sample world shows.
A reply box under a drawn transcript speaks through `actions().reply`. `route.wide` gives the
terminal the room.

### instruments

`Instruments`. The three readings of one session, as the Console prototype has them
(Memory leads with what mnemo held back), three across when the column is wide and one at a
time, with all three headers and their headline numbers, when it is not. Context and tokens:
how full, the curve with compactions, spent by kind, by sub-agent, by tree, by model, what
Claude Code recorded, the account's plan windows. Memory: loaded at start, touched since,
briefings, given with scores, asked for, held back with reasons, corrections. Sight: pages
with the screenshots the session took (`actions().shot`), searches and sources, fetched
documents, artifacts, files, pull requests; links open with `actions().external`. With `at`,
each reading shows the session as of that moment and dims what had not happened yet.

### score

`ScoreView`. The Score prototype on the world: the lines, lanes, memory marks, bar lines,
children as branches, folded ensembles, the fleet strip and ruler, zoom and pan, the
playhead and its replay (`route.at`). The now column is the roster's order with one compact
card per line. Selecting a line opens `Instruments` at the playhead's moment beside the
score; Enter opens the session on stage. A waiting item opens at the now edge of its line
(`PendingCard`).

### frame

`Frame`: the top bar (the mark, counts by state, `WaitingCount`, each account's plan
windows, the three views, the motion switch, what the world could not read), the layout of
each view at the three sizes (Console's columns and `wide`), the continuity when the view
changes, the fleet-wide keys of the design's table with Alt inside a terminal and bare
outside, a key sheet, and the command line (`route.command`): new session, shell, dispatch
with model, effort and may, dispatch a contract, message, merge green, land, stop, with
completion against the world's sessions and projects. A batch verb is confirmed before it
runs. `src/nexus/command/parse.ts` and `run.ts` are the current parser and runner.

### runtime

`canHost`, `LiveTerminal`, `startRuntime`. What makes the new front act on real sessions,
built over what the app already has and changing none of it:

- Hosting and showing terminals: a parent session the app runs, a child through
  `claude attach`, a plain shell. `src/session/host.ts`, `src/layout/store.ts`,
  `src/terminal/view.tsx` and `src/nexus/drawer/{open,start,launch,app,persist}.ts` are how
  the ship does it; a hidden terminal keeps its session.
- `Actions` for the live world: open, answer (through `cockpit/approve`, `mission/ask`,
  with their guards), reply (`mission/as-me`, the mission store), stop, close, new session
  and shell, dispatch and dispatch a contract (`github/actions`), message, merge green
  (`cockpit/merge`), land, shot (`insight_shot`), external.
- What the ship's view started as a side effect and the app still needs: settings loaded,
  a toaster, the routes of `src/nexus/outside.ts`, the restore of hosted sessions at
  launch, the session ids learned from running panes, the first-run check.
- The state other parts read from the drawer: the desktop MCP's `desktop_list_panes`,
  dictation's target, the notification that is not shown for the session on screen. They
  read the stage and the hosted sessions instead.

It runs only in a live world. The ship keeps working on the same branch when the flag is
off. Say in the pull request what was run in a real dev build on Windows.

### world-live

`startLive`. The live world: `World` kept current from the mission snapshot and its poll,
the feed, the fleet's hook events, accounts and plan usage, and the core wave's
`session_insight`, `memory_trail` and `vault_pulse` (their types are in
`src/insight/types.ts`; the commands answer nothing until the core wave lands, and the world
must be right about everything else in the meantime). State follows the design's meanings
and the thresholds the ship learned (`src/nexus/ship.ts`); what waits carries its choices
(`choicesFor`); a parent is linked to its children as the snapshot links them. It must not
rebuild the world when nothing changed, and it must not hand views a new object for a
session whose data did not change. A script or a test compares the world it builds against
`docs/superpowers/prototypes/redesign/capture.py` on the same machine and says where they
differ and why.

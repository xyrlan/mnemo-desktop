# The recreation: one fleet, three ways to look at it

2026-11-10. The design of the new mnemo-desktop interface, decided after phase 0. Three
concept prototypes were built on the maintainer's real sessions
(`docs/superpowers/prototypes/redesign/`: `console/`, `orbit/`, `score/`, each with a
`NOTES.md` of its decisions and sample screenshots). The maintainer handed the choice over
("go on through the next phases without asking"); this document is that choice and what
follows from it. `2026-11-10-recreation-core.md` is the core wave that runs beside it.

## The decision

The three prototypes were built to disagree, and each won its own bet:

- **Orbit** wins the first look. On the real capture every one of thirteen parent sessions
  stands in the window with its full title, and who needs the maintainer is known before a
  word is read. It is the only one of the three that is striking at rest.
- **Console** wins the working hour. Roster, terminal and instruments on one screen, every
  waiting item answered with a digit where it is listed, nothing behind a hover.
- **Score** shows what nothing else can: the day, with context filling and falling,
  memory arriving, children branching, and a playhead that replays it.

They are not three apps. They read one model and differ only in what position means: in
Orbit it is attention, in Console it is order, in Score it is time. So the app is all three,
as three views of one fleet, with one selection, one set of keys and one way to answer:

| view | position means | it is for | it is where |
| --- | --- | --- | --- |
| **Orbit** | attention (distance) and project (direction) | seeing the whole fleet at once | the app opens here |
| **Console** | order of attention, top to bottom | working in a session | opening any session lands here |
| **Score** | time | reading what happened, and when | one key away from either |

What is shared, and built once:

- **One selection.** The session selected in one view is the session selected in the others.
  Opening a session anywhere puts it on Console's stage.
- **One roster.** Console's roster is the app's list of sessions; Orbit's scene shrinks into
  its head as the map ("where it stands") when a session is on stage, as Orbit's station did.
- **One stage and one set of instruments.** Orbit's station and Score's inspector were two
  more drawings of Console's stage and instruments. There is one of each. Score shows the
  instruments at the playhead's moment.
- **One way to answer.** Every waiting item is a short keyed list (Console's decision): a
  question's own choices; allow once, always, deny; merge, send back; resume, stop. A digit
  answers; a key walks to the next one; the count left is always in the top bar. The same
  card is drawn on a roster entry, on a body in Orbit and at the now edge of a line in Score.
- **One identity for a session.** The figure worked out from its id (Console and Score each
  drew one) appears beside its name everywhere, so a session is recognised before it is read.

What was dropped: Orbit's own station layout, Score's own inspector layout and now-column
cards (the roster's entries serve), and each prototype's separate centre piece.

## What the maintainer asked for, and where it lands

1. *Sessions easy to see, tell apart and navigate.* Full titles everywhere; the figure; the
   session's own recap as the line that says what it is doing; state as shape and word;
   children inside their parent. Keys move between sessions from anywhere, the terminal
   included.
2. *A more fluid workflow.* No modal windows, no drawer, no hover-only facts. Seeing,
   answering and dispatching happen on the same screen.
3. *A black identity.* Below.
4. *Animation and art made with Higgsfield.* Below.
5. *Tokens and context.* Per session, by kind, with sub-agents; per tree; per account
   against the plan's windows; context against its window, over time, with compactions.
6. *The memories each session read.* What Claude Code loaded and touched, what mnemo gave,
   what the session asked for, and what mnemo considered and held back, with the reason.
7. *What a session is seeing and making.* Pages with the screenshots the session itself
   took, searches and their sources, fetched documents, artifacts, files, pull requests.
8. *Something new.* Memory in flight in Orbit; the replay in Score; "held back".

## The model: `World`

Every view reads one object, `World` (`src/world/types.ts`): the sessions with everything
known of each, what waits, the accounts, the vault. It is the prototypes' capture
(`prototypes/redesign/DATA.md`) as TypeScript, with times in epoch ms. Nothing above
`src/world/` calls a Tauri command to learn about a session.

- `src/world/live/` builds it from what the app already polls (the mission snapshot, the
  feed, the fleet's hook events, accounts and plan usage) and from the core wave's
  `session_insight`, `memory_trail` and `vault_pulse`.
- `src/world/sample.ts` is the synthetic world of the prototypes. `?world=sample`, or
  `localStorage['mnemo.world'] = 'sample'`, makes the app draw it with no core at all, which
  is how every view is developed, photographed (`tools/preview`) and tested.
- A session's **state** is one of `need`, `working`, `ready`, `stalled`, `idle`, `ended`,
  with the meanings of `DATA.md`. The thresholds the current app learned stay: a tool call
  awaiting its result is work, not a stop; a child idle 15 minutes with nothing running is
  stalled; red CI is not a need while mnemo's follow wakes the child to fix it.
- **What waits** carries its choices, so the three views draw one list.

Views act through `Actions` (`src/world/actions.ts`): open, answer, reply, merge, stop, new
session, dispatch, message, land, run a command line. `src/runtime/` implements them over
the paths the app already has, with every guard those paths carry (the prompt on screen
must be the one the card shows; a batch verb is confirmed; nothing is typed into a session
whose input box holds a draft). In the sample world, actions change the sample and nothing
else.

## The frame

- **Top bar:** the mark; the fleet's counts by state; how many wait, with the key that walks
  them; each account's plan windows; the three views; the motion switch.
- **Views** fill the rest. Changing view keeps the selection and animates the continuity:
  the scene contracts into the roster's map, the roster's entries slide onto their lines.
- **The command line** opens from anywhere and completes against real sessions, projects,
  issues and contracts: new session, shell, dispatch (model, effort, may), dispatch a
  contract, message, merge the green ones, land, stop.
- **Panels** replace the windows: Projects, Missions, Memory (the vault), Learned, Setup,
  Accounts, Settings, Changes. A panel takes a side of the screen and never covers the
  terminal on stage; Esc closes it.

### Keys

Two places take keys. When the terminal on stage has focus, keys are the session's, as in
any terminal, and the fleet is reached with **Alt** (⌥ on macOS). Anywhere else the same
keys work bare.

| key (Alt+ in a terminal) | does |
| --- | --- |
| `↑` `↓` | previous, next session in roster order |
| `←` `→` | through the family on stage |
| `Q` | the session you were on before (most recent first) |
| `N` | the next thing that waits |
| `1`–`9` | answer the open waiting item |
| `R` | answer it in your words |
| `H` `C` `T` | Orbit (home), Console, Score (time) |
| `Enter` | focus the terminal; again, give it the room |
| `;` | the command line |
| `Esc` (never sent with Alt) | out of a panel, a card, the command line; never taken from a terminal |

The existing chords (close, dictate, James) stay as `src/actions/chords.ts` has them.

## Identity

Black, near-monochrome, colour only as a signal: the state hues and one violet for mnemo's
memory (`src/ds/tokens.css`). Three typefaces: Jura for names and numbers, Geist for
sentences, JetBrains Mono for anything a terminal printed. State is a shape and a word
before it is a colour. The terminal keeps the readable palette it has.

- **The centre piece is the lattice:** two nested geodesic shells with spines that end in
  nodes, in hairline white. A node lights when mnemo hands a rule to a session, and the mote
  leaves from it. It was chosen from four stills generated with Higgsfield (lattice, seed
  head, thread orb, crystal); the app draws it live from geometry, so it turns, responds and
  costs a few hundred line segments.
- **The mark is the crystal:** the nested memory crystal the app already had, redrawn as
  hairlines. App icon, top bar, small sizes.
- **A session's figure** is a small constellation derived from its id.
- **Generated with Higgsfield and bundled** (`src/ds/art/`, with `ART.md` naming each
  file's prompt, model and cost): the stills above as reference, the boot sequence (the
  lattice assembling, played once at launch), and James's presence (the thread orb). Nothing
  is loaded from the network at run time.

### Motion and its budget

Motion is part of the brief, and the app sits beside builds and a speech model on the GPU
all day. So: CSS on `transform` and `opacity` wherever possible; a canvas draws only while
it is on screen, the window is visible and something is changing, at 30 frames a second at
most; the lattice is the one thing that turns at rest, and it stops with the window. One
switch, and `prefers-reduced-motion`, still everything. The budget, measured in phase 3 on
the maintainer's machine with ten sessions on screen: under 2% of one core and under 3% of
the GPU at rest; a view change under 100 ms; the front's bundle under 6 MB with the art.

## What stays of the core and the front

Same repository, same stack (Tauri 2, React 19, TypeScript, zustand, Vite, Tailwind 4,
xterm.js). The audit found the logic sound and the drawing replaceable:

- **Kept as they are:** terminals (`pty`, `terminal`, `session`, `layout`), accounts, the
  mission snapshot and its poll, the fleet's hook events, replying and approving
  (`cockpit/approve`, `mission/ask`, `mission/as-me`), merge and land, dispatch, the vault
  and memory stores, voice, James's loop, the desktop MCP's tools, diff.
- **Kept, re-homed:** the logic inside `src/nexus/` that is not drawing (opening and
  restoring sessions, the tab state the MCP, voice and notifications read, the command
  parser and runner, the menus' guards). The new front uses it where it is; the last wave
  moves it out and deletes the ship.
- **Replaced:** everything that draws the ship, the drawer, the windows and the bridge.
- **New in the core:** the core wave.

Until the swap, the current app is what a build shows. `localStorage['mnemo.next'] = '1'`
shows the new front instead, in a dev build or an installed one.

## Parity: nothing the app does today is lost

| today | in the new app |
| --- | --- |
| Parent sessions and children, live terminals, restored on launch | roster, stage; `src/runtime/` |
| What waits, answered from the list; `/new` `/dispatch` `/msg` `/merge green` `/stop all` `/land` | waiting cards in every view; the command line |
| Projects and missions: repos, issues, PRs, dispatch with model, effort and may, contracts | panels; the command line |
| Memory: vault pages, health, inbox, rules fired | the Memory panel; the Memory instrument per session; the centre of Orbit |
| Accounts and plan usage | the top bar; the Accounts panel; the session's account on stage |
| Dictation; James | unchanged underneath; indicator, panel and orb in the new identity |
| Desktop MCP | unchanged; on Windows too after the core wave |
| Changes (diff), open in editor or browser | the Changes panel; Sight |

Cut: the ship's log as a ticker (Score is the log), the vault level and XP badges on decks
(the vault's numbers live in Orbit's centre and the Memory panel), sprites and the octopus.

## The waves

1. **Core** (running): `2026-11-10-recreation-core.md`.
2. **Front, first wave** (`contracts/2026-11-10-recreation-front.md`): the design system,
   the live world, the runtime, and the views, each in its own folder against `World`,
   `Actions` and the design system's components.
3. **Front, second wave:** panels, overlays (James, notifications, dictation), the command
   line's remaining verbs, and whatever the first wave's review turns up.
4. **Swap:** the new front becomes the default, the ship is deleted, the logic leaves
   `src/nexus/`, parity is checked row by row against the table above, the budget is
   measured, and the branch lands on `main`.

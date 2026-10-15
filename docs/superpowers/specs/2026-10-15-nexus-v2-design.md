# Nexus v2: the fleet as a ship, laid out by attention

2026-10-15. Replaces the v1 design (`2026-10-14-nexus-design.md`) for everything the user sees and
does; v1's art, licence and data plumbing stay where they are reused below. Designed with the
maintainer in one grilling round and then a runnable prototype iterated with them, on the real fleet,
until they called the **attention** layout "perfeito". The prototype is in
`docs/superpowers/prototypes/nexus-v2/`; every behaviour below is running there.

## Why v1 is replaced

v1 shipped (#397–#402, #411–#415) and was rejected on first real use: *"desse jeito que tá aí… não
vai ser usado"*. It could only be watched. The old cockpit died the same way. A Nexus view earns its
place only if work happens there. Seen on the real fleet, v1 also drew every robot grey (lean children
have no `--model`; the transcript fallback was never built), drew a working child idle (it read
`tempo`, not whether the session is busy), drew ~25 nexuses for 10 territories, and labelled
parents `mnemo-18` with twins indistinguishable.

## What it is

A full-window view of the fleet as a **ship in cross-section**. Everything a session can need from
you can be done from it, and the position of every figure says whether it needs you.

- **The bridge (top) is you.** It holds:
  - the **exceptions**, one row per thing waiting for you, each with the action that settles it;
  - the **fleet prompt** (`/` focuses it);
  - any **blocked** child, which climbs up here with its question.

  It glows red for a question or a red CI, lilac when only a merge is waiting, and reads *"nothing
  needs you — the fleet flies itself"* when calm.

  A contract round whose mission is `landable` gets its own row: *"mission nexus-v2 · 5/5 green →
  land"*, which runs `mnemo land`.
- **One deck per repo with live children**, in a fixed order (the repos with the most children
  first). Every deck has the same four rooms, so the columns line up down the ship:
  - **COMMAND:** the parents. Each parent is a **captain robot at a console** (art set 2):
    - busy: typing, blue screen;
    - idle: arms crossed;
    - a child needs you: standing, pointing, pink screen;
    - ended: slumped, screen off.

    A child whose parent is not recorded stands by an **empty chair**.
  - **IN FLIGHT** (widest): children working on their own, busy or briefly idle.
  - **HANGAR:** children done, their PR open, waiting for a merge. The newest are on the floor and
    the rest fold into a stack (*"7 PRs waiting for merge · 5 green"*). The room glows green while a
    green PR waits.
  - **STRANDED:** children idle for more than 15 minutes with no command running.
- **Docks (bottom):** repos with no live child, as small pods of idle captains. They are dimmed until
  hovered.
- **mnemo's memory is visible.** When mnemo injects a rule into a session (the pulse names the
  session and the slug), its figure flashes ◈. The log records *"◈ #682 got
  `merge-requires-admin`"*, and the hover lists every rule the session got. Without this the view
  would draw an agent fleet, not mnemo's.
- **Ship's log:** a one-line ticker of the latest milestone (dispatched, PR opened, CI green or red,
  merged, stranded, finished without a PR, and what you did). It expands into the list.

What the robot is *doing* is never its position. It shows in its **action badge** (⌕ reading,
✎ editing, ⚗ testing, ⇪ publishing, ⧗ a long command running, ✓/✗/⧗ CI on a finished PR, ! needs
you, ■ stopped), its **particles** (sparks, bubbles, pages, zZ, a radar ping) and its **speech
bubble**. A room shows as many bubbles at once as its width allows, roughly one per 240 px. The
freshest lines speak first and the rest take turns every ~4.5 s.

## Where it sits in the app

The app keeps its two places:
- **The workbench** (the Orca design): workspaces, tabs, terminals, editor, browser, diff. This is
  where you dig into one worktree, and it does not change.
- **The Nexus:** the full-window view over the workbench, from the left sidebar's edge. This is
  where you command the whole fleet.

How they fit, decided with the maintainer:
- **The app opens on the Nexus.**
- **⌘0** (Ctrl+Shift+0 elsewhere) toggles it. ⌘1–9 go to a worktree and ⌘0 to the whole fleet. The
  sidebar's Nexus entry and ⌘K toggle it too.
- **The two share sessions, never copies.** A session lives in its workbench pane. The drawer borrows
  that same terminal and gives it back. *Open as tab* in the drawer goes to the pane.
- **The Agent Dashboard drawer is retired** once v2 lands. Its sidebar counters (*Needs you ·
  Working · Done*) stay as the radar and open the Nexus. The Nexus and the dashboard drawers opened
  at the same edge and layer without knowing of each other.
- **v1's Nexus drawer is replaced.** Its art, licence, `classOf`/`accessoryOf`/`labelOf` and
  `injectedRules` are reused.
- **The Dispatch tab stays for now.** Whether the drawer replaces it is decided later from usage:
  `startNexusUsage` already logs time on screen.

## Acting from it

- **Click a captain or a robot** to open it in the **drawer**: a right-hand panel with one tab per
  session. The ship shrinks beside it and stays live. Each tab shows:
  - breadcrumbs, `repo ▸ ◆ captain ▸ #682·a`, each segment clickable;
  - the state and context size;
  - the files the session changed, as chips; a chip opens a **quick diff** popover;
  - the session's **real terminal**, re-hosted from its pane without killing the PTY, or
    `claude attach <id>` on the child's account for a background child (desktop#421).
- **Cross-highlight:** while a tab is open, its figure glows magenta under a bouncing ▼, and the ship
  scrolls to it. Magenta is not a state colour.
- **⌘\\ or Esc** collapses the drawer to a handle on the right edge. The tabs stay open; only × closes
  one.
- **Triage:** `Tab`, *attend* or the bridge's `+N blocked · triage` opens a focused card per pending decision,
  with the question, the child's last lines and its options:
  - `1`/`2` choose an option, `Y`/`N` approve or deny;
  - `←`/`→` move between cards, `T` opens the terminal, `Esc` leaves.
- **Numbered exceptions:** `⌥1–9` opens that row's session in the drawer. `⌘1–9` are the
  worktrees'.
- **Fleet prompt:**
  - `/dispatch <repo> #<issue>` runs `mnemo dispatch` in that repo, the app's own dispatch path.
    No captain is recorded as its parent, so the child stands by the empty chair. To have a
    captain dispatch it, `/msg` the captain;
  - `/msg <#issue | captain | all> <text>` writes to the session's inbox socket;
  - `/merge green` merges every green PR in the hangar, through the app's checks-gated merge;
  - `/land <feature>` runs `mnemo land` on a landable mission;
  - `/stop all` runs `claude stop` on every working child, which keeps its conversation.

  The two batch verbs ask for `/yes` within 20 s.
- **Selection:** shift+click robots; a bar offers *merge N green · stop N · open N*.
- **Telemetry chip:** API calls/min and output tokens/min across the fleet over the last 5 minutes,
  with input and cache share on hover. No US$ figure: the subscription is not billed per token, and
  no per-token price is in the data.
- **Hover a robot:** its full line, its model, its context size, and its contract relations. Dotted
  lines go to the pieces it writes against (*"consumes memory"*), labelled *"does not wait"*, and to
  its A/B **twin**.

## Facts it was designed on

Measured 2026-10-15 over the previous 36 h of the real fleet (86 children, 12 parents, 50 PRs), from
transcripts, `mnemo sessions --json --all --stale`, `claude agents --json` and `gh pr view`:

- **Never more than 2 repos** had children on screen at once. 55% of the time it was 1, 31% none.
  Multi-project scrolling is not the problem it looks like.
- **0** `AskUserQuestion` calls by children, and **0** red CI on the last run of 50 PRs. Blocked
  children are rare.
- A PR was **waiting for a merge 32% of the time**: median 0.5 h, p90 5.1 h from the child finishing
  to the merge. 49 of the 50 were merged. **The merge is the exception that actually happens**, which
  is why it leads the bridge.
- **Room by last tool** (the prototype's *station* layout) moves a robot every ~2 min (p90 43 s), which
  is noise. Room by the dominant activity of the last 2 min moves it every ~7.5 min. The attention
  layout sidesteps this: position follows attention, not activity.
- **A tool call still waiting for its result** (a CI watch, a full suite) is a command running, not a
  stop. Without that rule STRANDED filled with false alarms.

## Decisions

Round 1 (all recommendations accepted):
1. A full-window view, not v1's side drawer.
2. Click a parent → its real terminal, not a re-drawn chat.
3. Click a child → the same, via attach.
4. The speech bubble is the child's own `detail` line, with the last tool under it and the last
   assistant sentence on hover. No LLM summaries.
5. Messages are visible: notices fly as envelopes; a blocked child's question is answerable in place.
6. Keep v1's art and world model.
7. Prototype first, with a spike for the risky part (desktop#421 → #422).

Then, from the prototype rounds:
- **The drawer replaces floating popups.** A modal or popup hides the board you are steering.
- **Layout by attention** (bridge / in flight / hangar / stranded), chosen over the activity layout
  (*station*: library / workshop / lab / hangar / rest) and over v1's grid. Both stay in the
  prototype only.
- **Twins and contract pieces are never drawn as blocking each other.** Twins are independent by
  design, and a piece writes against a signature without waiting for it.
- **A robot leaves at its PR's real fate.** At `mergedAt` it boards its shuttle and launches; at
  `closedAt` it walks off. A child without a PR leaves 40 min after it ends. CI on the badge is the
  state of the checks at that moment, from their `startedAt`/`completedAt`.
- **Colour means state only:** cyan working, red needs you, green done/green CI, grey idle. Magenta is
  reserved for the selection highlight. There is no sound.
- **Every string is English**, like the rest of the app.

- **The drawer is built on a session host** shared with the popup of desktop#421 and #423. That
  host gives the visible view the session and lets a view hand it back without a remount, and it
  never loses the pane's content to a smaller view. #422's review found that it could.

Rejected, with the reason:
- **A central diff-approval queue:** autopilot means no manual review. The drawer shows *what
  changed*, and the PR is where review happens.
- **A 3-column cockpit, and a silent air-traffic list:** watch-only, the v1 failure.
- **A radar or constellation:** position would mean nothing.
- **"Blocked by" links:** see twins and contracts above.
- **Pause-all:** Claude Code has no pause; `/stop all` is the real verb.
- **A US$ cost:** see the telemetry chip.

## What each figure is computed from

- **A child**, from the snapshot plus its transcript and job files:
  - **state:**
    - **need:** a pending question or permission (`needs`, `waiting_for`).
    - **stopped:** stopped by you.
    - **done:** ended for more than 60 s.
    - **working:** an action in the last 150 s, or a tool call awaiting its result for less than 3 h.
    - **idle:** anything else.
  - **zone:** need → bridge; done → hangar; idle for more than 15 min, or stopped → stranded; else
    in flight.
  - **line:** `detail` from `jobs/<id>/timeline.jsonl` / `state.json`. **Action:** the last tool and its
    target (`mnemo sessions` `activity`, or the transcript tail).
  - **model:** from the transcript when `--model` is absent (the v1 grey-robot bug). **Context size:**
    the last call's `input + cache_read + cache_creation` tokens.
  - **PR:** `{id, href, state, mergedAt, closedAt, checks: [startedAt, completedAt, conclusion]}`.
  - **contract:** `{feature, piece, consumes[]}`, parsed from the dispatch intent (*"one piece of the
    feature "X": piece"*, *"from the piece `memory`"*).
  - **twin suffix:** `a`, `b`, … in spawn order among children of one parent sharing an issue.
- **A parent:**
  - **name:** the tab title when the session is open in a pane, else the `claude agents` name.
  - **status:** busy / idle / ended.
  - **topic:** its latest user prompt.
  - its last action, and the notices from its children in the last 30 min.
- **The ship's log:** milestones derived from the fields above, plus your own actions. While the app
  runs it keeps them in memory, newest first.

## Out of scope

- The prototype's replay scrubber: it is a design tool.
- The station and grid layouts.
- Sound and cost.
- Persisting the log across restarts.
- Showing grandchildren beyond tagging them with their intermediate parent (`↳#661`).

## The prototype

`docs/superpowers/prototypes/nexus-v2/index.html` is plain HTML and JS. Open it next to a
`fleet.js` written by `capture.py`, which reads the local machine. The captured data is **not**
committed: it is the maintainer's private transcripts. It uses `src/nexus/sprites/`. Its code is a
reference for behaviour and its numbers, not for structure: the app builds it from React components,
the stores and the Rust snapshot.

## The round

See `docs/superpowers/contracts/2026-10-15-nexus-v2.md`.

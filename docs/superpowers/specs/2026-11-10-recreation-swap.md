# The recreation's swap: the new front takes over

2026-11-10. The last wave. Every piece of the core, the first front wave and the panels is on
`redesign/app` and the whole draws the maintainer's real sessions. This wave makes it the app
a build shows, closes what the pieces could not close alone, and checks the result against
what was promised. `2026-11-10-recreation-design.md` is the design; this amends it in one
place, below.

## One change to the design: the ship stays one release, behind a switch

The design said the swap deletes the ship. It does not, yet. Nobody but the maintainer can
use the new front on his real fleet for a working day, and the app is his daily tool, so the
ship stays in the build as the fallback until he has: the new front is the default, and one
action brings the ship back. Deleting the ship and moving the logic out of `src/nexus/`
follow his say-so, as their own change.

- `nextFront()` (`src/frame/flag.ts`) answers yes unless `localStorage['mnemo.next']` is
  `'0'`. `'1'` still forces it. Under vitest the default is the ship, so the ship's own tests
  keep meaning what they meant; the preview harness gives every scenario `'mnemo.next': '0'`
  unless the scenario says otherwise, for the same reason.
- The Settings panel has "Classic interface": it sets the flag and reloads. The command line
  has `classic`. If the new front fails to draw, what stands in its place says so and offers
  the same switch; a broken new front never strands him without the old one.
- The ship gets the way back: its SYSTEMS menu has "New interface".

**Since then (2026-11-10, the same day):** the maintainer used the new front on his fleet and
said it had replaced the ship, so the ship is out of the build: nothing mounts it, the flag,
the `classic` command, the Settings switch and the guard's offer are gone, and so are the
components, styles and tests only it reached (its scene, drawer, windows, menus, the
conversation view, the code editor and the diff around it). The bundle went from 16.85 MB to
3.38 MB. What the new front still takes from `src/nexus/` (the drawer's sessions, the store,
the first run, the types) stays there until it is moved to homes of its own, and the old
shell is still what the frame is mounted in.

## What this wave closes

**Reaching the panels.** The top bar lists the panels that exist (`panels()`), and the
command line opens one by name. The Changes panel opens for the session on stage from the
stage itself.

**A terminal that is not a session.** A plain shell or a command terminal the runtime holds
(`useHosted()`) has a place: the roster lists them after the sessions, and the stage draws
`LiveTerminal` for one with a head that says what it is. The stage hears `useCanHost`, so a
terminal that becomes available appears without waiting for the world to change.

**James in the top bar.** `JamesPresence` (from the overlays piece) stands in the top bar;
the square launcher is gone with that piece.

**The boot sequence.** At launch the frame plays `src/ds/art/boot.webm` once (MP4 second,
`boot-last.jpg` as poster), centred where Orbit's lattice stands, and Orbit opens out of its
last frame. Any key or click skips it; reduced motion skips it; a launch that restores a
route other than Orbit skips it; it never delays a waiting item from being seen by more than
its four seconds.

**Small things the pieces left.** The roster's head says "Where it stands" once (the map
carries the same label). The dispatch options offer Fable (`src/tasks/model.ts`, which the
Missions panel and the command line read). The roster's and Score's entries carry
`data-session`, and the frame moves each entry between the two views as the design asked.
The piece screenshots leave `src/` for `docs/superpowers/shots/<piece>/` (they are 34 MB of
pictures inside the source tree; nothing imports them).

**The words.** `README.md` describes the app as it now is: the three views, the keys, the
command line, the panels, the two worlds, the switch back, and the Desktop MCP on Windows.
`src-tauri/tauri.conf.json`'s descriptions stop naming the Nexus and the ship.

## What this wave checks, and reports

**Parity, row by row.** The table "Parity: nothing the app does today is lost" of the
design, each row tried in a real debug build on Windows with real sessions where the row can
be tried without acting on the maintainer's live work (reading, opening, the panels, a new
shell, a new session in a scratch repository, a dispatch in a scratch repository) and on the
sample or a scratch world where it cannot. The report says, per row: tried live, tried on a
scratch world, or not tried and why.

**Keys in a real webview.** Alt with the fleet keys from inside a hosted terminal on
Windows: Alt+Left and Alt+Right must not go back in the webview's history, releasing Alt
after a chord must not open a window menu, and Alt+Space stays dictation's.

**The budget** of the design ("Motion and its budget"), measured on the maintainer's machine
in a release build if one can be made without installing over his running app, else a debug
build and said so: CPU and GPU of the app's processes at rest on Orbit, on Console and on
Score, with the real fleet on screen, over a minute each; the time of a view change; the
front's bundle size. The script that measures is committed under `tools/perf/` and the
numbers go in the pull request with how they were taken. Where a number misses the budget,
say what costs and fix it if it is the front's.

**The whole suite** on the three systems is the integration pull request's CI.

## What must not happen

The maintainer's installed app is running his sessions, on a system where terminals do not
survive the app. Nothing here installs over it, stops it or restarts it, and a debug build
used for checking runs under its own state directory and a home of its own, as the earlier
pieces did; it does not write into the maintainer's `~/.claude/settings.json`.

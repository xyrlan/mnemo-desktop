# A menu on every session

2026-11-10. The maintainer installed the new front, used it, and asked twice for the same
thing: "where is the right-click menu". The ship had one on every figure (open, close,
resume, stop, merge, open the PR, its changes, copy its id, a new session or a terminal
there); the new front has none, so things that are one gesture away in his hands (closing a
parent session was his example) need the session on stage first, or the command line.

This is not a return to hiding things behind a right-click. Everything the design put on
screen stays on screen. The menu is the second way to the same actions, from wherever a
session is drawn, without changing what is on stage.

## Where it opens

On anything that draws a session: a roster entry and a child inside it, a body and a moon in
Orbit, a line and its card in Score, the stage's head and a family tab, a terminal listed
under Terminals. With the pointer: right-click. With the keyboard: `M` on the selected
session (Alt+M from inside a terminal), and the context-menu key or Shift+F10 where a
keyboard has one. It never opens over a live terminal's own area: a right-click there is the
terminal's, as it is today.

On a project's name (the roster's group head, Orbit's rim) it opens the project's menu.

## What it holds

For a session, in this order, each only when it applies:

| item | when | does |
| --- | --- | --- |
| Open on stage | always | `openOnStage` |
| Answer… | it has something waiting | opens its card where the session is drawn |
| Close session | the app hosts its terminal | `actions().close`, asked once in the menu |
| Resume here | an ended session the maintainer talked to | `actions().open` |
| Stop | a child that runs | `actions().stop`, asked once in the menu |
| Message… | a child that runs | a line typed in the menu, `actions().message` |
| Changes | it has a folder | the Changes panel for it |
| Open pull request | it has one | `actions().external` |
| Merge | its pull request is open and its checks are green | its merge card's first choice, asked once |
| New session in ‹project› · New shell in ‹project› | it has a project root | `actions().newSession`, `newShell` |
| Copy | always | a submenu or a row of three: its id, `claude --resume <id>`, its folder |
| Open folder | it has a folder | `actions().external` on the folder |

For a project: New session here, New shell here, Dispatch… (the Missions panel on that
project), Projects.

Rules it keeps:

- An item that does not apply is absent, or shown disabled with the reason in a few words
  when its absence would be the surprise (Close on a session another terminal runs: "runs
  outside this app"). Never an item that fails when chosen.
- What ends something is asked once, in the menu, on the same item (the stage's "close
  session" and the pending cards already do this). A refusal is said in the menu, in the
  words the action gave, and the menu stays.
- It is the app's own menu, in the app's identity (`src/ds`), keyed: arrows, Enter, Esc, the
  first letter. It closes on Esc, on a click elsewhere, on a change of view, and when its
  session leaves the world. It never leaves the window's edges.
- One menu at a time, and it does not change the selection or the stage until an item is
  chosen.
- On the synthetic world it works on the sample's actions, so every state has a preview
  scenario.

## What is not part of this

Changing what is on screen without the menu. The ship's menus. Multi-selection.

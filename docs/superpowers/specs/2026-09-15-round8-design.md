# Round 8: cockpit as inbox, vault as health table, images into Claude Code, Home polish

**Date:** 2026-09-15 (evening) · **Status:** approved in conversation; details delegated

## What the user saw and said (rounds 5–7 on screen)

- Cockpit graph: "muito confuso, não sei em qual repo estou, muita sujeira", and it blinked between two layouts (fixed in #57). Asked whether React Flow was still a good idea.
- Vault graph: "muito lagado… bem sem sal"; legend all grey (fixed in #58). The Health panel beside it was the useful part.
- "Não consigo arrastar uma imagem pro Claude Code."
- Home: live session titled `mnemo-f2`, dispatch children listed as if they were the user's sessions, `~/Downloads/public` greyed at the bottom.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Cockpit primary form | **Inbox** of what needs you (BLOCKED with inline reply, red CI, PR ready, landable contract), "andando" and "feito hoje" collapsed below. | The question asked twenty times a day is "who needs me"; a canvas answers "who belongs to whom", asked once per mission. |
| React Flow | Kept as the **per-mission map**: one mission, 100% zoom, nodes are action cards. Whole-cockpit canvas removed. | It is the one view a list cannot give: contract → pieces → PRs → land at a glance, with "land" on the node. |
| Vault primary form | **Health table** (rules by heat with badges never/stale/revisar/inbox, status tiles on top, row actions). Graph only as a ≤30-node **ego view** of the selected rule. | 3.6k pages; no whole-vault drawing is readable; the three real questions are alive / dead weight / needs review. The Health panel already answered them. |
| Images | Drop a file on a pane → its quoted path is typed; ⌘V with an image on the clipboard → raw Ctrl+V so Claude Code reads the clipboard itself. | Both are what Claude Code already supports; the pane just never forwarded them. |
| Home | Titles from the first real prompt, dispatch children grouped under one collapsed row, unresolved protected folders hidden. | Noise seen on screen. |
| Pulse consumers (#59) | The vault glow moves from the removed graph to the ego view; the pane-bar pulse is untouched. | Keep the feature, retarget the surface. |

## Pieces

`docs/contracts/round8.md`: cockpit (#54), vault (#56), image (#53), home (#61). All four are independent after round 7 (#59, #60) is on main.

## Out of scope

Kanban board polish (#60 shipped a first board), multi-CLI (#5), native GitHub OAuth.

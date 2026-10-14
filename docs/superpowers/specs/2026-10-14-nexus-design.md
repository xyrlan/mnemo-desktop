# Nexus: the fleet as a world

2026-10-14. Designed in a grilling session with the maintainer; every decision below was put to
them as a numbered question with a recommendation, and each recommendation was accepted unless
the text says otherwise.

## What it is

A drawer that draws the fleet as a small sci-fi world. Every repo is a **territory**. Every live
session that is not a dispatched child is a **nexus**, an energy core. Every child that session
dispatched is a **robot** in a ring around it. Every territory has an **archive**, its project's
vault. A **universal core** in the middle stands for the rules every project shares. mnemo's memory
events travel between archives and agents as **packets**.

Its job is to **monitor**: one look says who is working, who is stuck and who needs you. Delight is
a bonus. It does not control anything in v1 beyond what a click opens.

## Facts it was designed on

Measured on the maintainer's machine on 2026-10-14.

- **Children:** 838 dispatched by 107 parents between 2026-09-15 and 10-13. Per parent: median 5,
  p90 17, max 60. At most 15 ran at once across all parents (median 3 per parent, p90 8). Spawn
  to first stop: median 21 min, p90 61. Zero grandchildren.
- **Signals:** none of these costs a token.
  - `claude agents`: `busy` / `waiting` / `idle`, plus `waiting_for`.
  - The job's `state.json`: `state`, `tempo`, `needs`, `detail`.
  - `timeline.jsonl`: every state change with its time; `Running <cmd>` lines name the tool.
  - The snapshot (`src/mission/types.ts`) already carries all of this per child, with `model`,
    `effort`, `pr` and `parent_session`.
  - Children push no hook events, so the app sees them on its poll, about 3 s behind.
- **Memory events:** the pulse (`src-tauri/src/pulse.rs`) already tails the vault's logs every second.

  | Event | Rows in 14 d | Attributable to |
  |---|---|---|
  | reflex | 113 (per session: median 2, p90 18) | `session_id` |
  | MCP tool / catchup | 712 | `session_id` on 68% |
  | briefing | 1401 | `session_id` |
  | friction | 50 | `session_id` |
  | enrich | 206 | no `session_id`; a `file_path` inside a worktree |
  | learned | 970 | project only |
  | enforce | 0 | the denial log does not exist |

- **Stuck children:** 17 `blocked` episodes in the job timelines that ended. They lasted
  **median 44 min, p90 4.3 h**. 22 more jobs ended while blocked. This is a thin baseline that
  does not separate rate limits; the measure tool does.
- **The old cockpit:** it is dead, and its death says nothing about this view. It failed because
  little in it worked at the time, not because it was a separate surface (maintainer, this session).
- **The octopus:** the pet and avatar is a 32×32 rect grid. The maintainer finds it too plain
  ("muito xoxo, sem detalhe"). The Nexus gets new art and does not reuse it.

## Decisions

| # | Decision |
|---|---|
| Q1 | **Monitor first**, delight as a bonus. Control waits for a later version; v1 only opens things. |
| Q2 | **Its own surface**, separate from the workbench. A pane belongs to one worktree and would vanish when a click switches worktrees, so it is a **drawer** like the Agent Dashboard. It opens from the left sidebar's "Nexus" entry or ⌘K (`nexus.toggle`), and a pick closes it. |
| Q3 | **Identity is stable and seeded from the session id.** Everything else is real data: class from the model, level from the effort, pose from the state. |
| Q4 | **2D pixel art**, drawn as DOM sprites with CSS transforms and `image-rendering: pixelated`. No canvas library: at most ~150 sprites. |
| Q5 | **Every live parent, grouped by repo.** No history: sessions that are gone are not drawn. |
| Q6 | **A report-only measure** (`tools/measure_attention.py` in the mnemo repo): how long a child waits in "needs you" before and after the Nexus, rate limits separated. It never blocks the change. "After" starts at install (`pnpm run install-app`), not at merge. |
| Q8 | **No sound and no new notifications.** The existing notifications stay the only channel (#277 already fought notification spam). |
| Q11 | **Colour means state only.** State is a halo in one of the four `--state-*` tokens plus a badge over the head; the sprite palette avoids those four colours. Identity is the label (`#643`) plus a seeded accessory. |
| Q12 | **A robot leaves on the automatic verdict.** A merged PR celebrates and warps out. An open PR that is ready, red, conflicting or a draft keeps the robot there. A stop without a PR powers the robot down once its parent has the notice. |
| Q13 | **Sci-fi.** The nexus is an energy core. The robots are an opus **mech**, a sonnet **droid** and a haiku **drone**. Inspired by the genre, copying no game's art: the repo is public. |
| Q14 | **New art generated with Higgsfield**, cleaned into true pixel art (exact grid, fixed palette). Animation is parts, motion and effects, not frame-by-frame generation, because generated frames drift. Badges are drawn in code. A commissioned artist is the upgrade if the view sticks. |
| Q15 | **Click a nexus:** its session's terminal is shown, revealed the way a kanban card is. A dead parent offers `claude --resume`; one alive outside the app is only named and never opened twice, since that would fork the session. **Click a robot:** `claude attach`. **Click an archive:** its project's Memory panel. **Hover:** a card. |
| Q16 | **Sprite sizes:** robots 64×64 and the nexus 96×96, at an integer scale that fits. Palette of about 24 colours. The robots were 48×48 until the concept sheet showed how much detail 48 px loses; the maintainer raised them to 64. |
| Q17 | **Layout:** territories in a grid that fits the drawer, robots in a ring around their nexus. No camera, pan or zoom. |
| Q18 | **The state table below.** |
| Q19 | **Art in two steps:** a concept sheet (nexus + three classes, about 4 candidates) for the maintainer to choose from, then the full set in the chosen style. Cap of **300 Higgsfield credits**. **Chosen:** direction C, retro 16-bit: chunky dark outlines, bold cel shading, royal blue, purple, white and pink. It was the most legible at sprite size of the four tried (clean steel, neon, retro and industrial). |
| Art licence | **The sprites carry their own licence** (`src/nexus/sprites/LICENSE`): use and redistribution are allowed, ML training is not. This mirrors §5.2(iv) of Higgsfield's terms (2026-07-26), which bars permitting third parties to train on outputs. The code stays MIT. |
| Q20 | **Art and code in parallel:** children build against placeholder sprites behind `SpriteManifest`; the parent session makes the art with the maintainer and swaps the files at the end. |
| Q21 | **Memory lives in the world:** one archive per territory, which grows with its live pages, plus the universal core. Clicking an archive opens that project's Memory panel. |
| Q22 | **The memory table below.** Packets are **neutral**, with no celebration: the reflex is on-point about 1 time in 10 (measured), and the view must not sell value nobody has proven. |
| Q23 | **Events for one agent within ~5 s coalesce** into one packet marked `×N`. With reduced motion, only the counter changes. |
| Q24 | **The archive shows its level and its events only.** Sync state waits for the sync proof (ends ~10-28). The inbox queue stays out: "needs review" is no destination for an autopilot product. |
| Q25 | **Every live session that is not a dispatched child is a nexus**, with or without children, including a manual `--bg` job. A dead parent whose children live is a dark, cracked nexus. |
| Q26 | **The Nexus counts its own use locally:** `{event: 'nexus.open'}`, and `{event: 'nexus.visible', ms}` while it is on screen, in `~/.mnemo-desktop/usage.jsonl`. Nothing leaves the machine. The measure reads it, so a drop in waiting time is credited to the view only when the view was used. |

Implementation premises:
- A territory is the repo root; `<repo>-wt-*` worktrees fold into it.
- Model and effort come from the snapshot. With no model, the class is `unknown`; with no effort,
  the level is 0 and there is no aura.
- Sessions on every Claude account are shown. Only this machine's sessions are shown: a sync
  satellite's are not.
- The view must work on Windows. It is frontend over the existing snapshot plus one vault read.
- Dark first; light only needs to stay legible.

### Q18: signal → what is drawn

| Signal | Robot |
|---|---|
| appears in the snapshot | warps in from its nexus |
| `busy` / `working` with a tool running | works; the badge-free body animates, with the tool from the timeline's `Running …` |
| `idle`, no ask | idle, slow breathing |
| waiting on a permission, an answer, a sandbox or a dialog | **halo `needs-you` + `alert`** |
| rate-limit stall | `sleeping` + `zzz`; the hover card shows the reset time |
| open PR, checks running | `flag-pending` |
| open PR, checks passed | `flag-ready`, halo `done` |
| failing checks or conflict | `fire`. No `needs-you` halo, since pr-follow wakes the child to fix it; the halo comes only if the child stops |
| PR merged | exit `merged`: celebrates and warps out |
| stopped without a PR | exit `powered-down` once `notice` is `delivered` |

| Signal | Nexus |
|---|---|
| parent `busy` | `busy`: the core pulses fast |
| parent waiting on you | `waiting`: halo `needs-you` |
| parent `idle` | `idle`: slow pulse |
| parent gone, children alive | `dead`: dark, cracked core |

### Q22: memory event → packet

| Event | Packet |
|---|---|
| catchup (SessionStart injection) | `to-agent` as the agent boots |
| reflex | `to-agent`; the hover card lists the slugs |
| read (MCP tool) | `round-trip` |
| enrich | `to-agent` when the file's worktree names a robot, else `flash` |
| friction | `to-archive` |
| briefing written | `to-archive`, the robot uploading before it leaves |
| learned | `flash`; the archive's tier can step up |
| enforce | not in v1: zero events on record |

## The round

Contract: `docs/superpowers/contracts/2026-10-14-nexus.md`. The seams land on `main` first: every
shared type (`src/nexus/types.ts`), the drawer and its wiring, the sidebar entry, `nexus.toggle`,
`ChildSession.notice`, `nexus_archives` registered with a stub body, and a stub for each piece's
signature. So each piece compiles and tests alone, and the pieces merge in any order.

The measure tool is a separate issue in the mnemo repo.

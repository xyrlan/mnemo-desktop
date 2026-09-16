# The sidebar becomes the cockpit, and the vault becomes a creature

**Date:** 2026-09-16
**Status:** designed, not built
**Depends on:** mission cockpit (PR #6, shipped), pulse (#44, shipped), **mnemo presence** (`feat/mnemo-presence`, designed not merged) for piece 3 only.

## Problem

Three separate complaints, one shape.

**The sidebar wastes its space.** It is 360px wide and has two blocks: `.ws-tabs` (Home, the
tabs, new tab — capped at 55% height) and `.sidebar-body`, which renders the mission errors and
`NeedsList`. Almost always that second block says nothing needs you, and after the reflex work of
2026-09-16 it will say that even more often — a blocked child is now rare by design. So the lower
half of the sidebar is usually empty.

**The cockpit is behind a door nobody opens.** It is a pane (`⌘⇧B`, or the `⤢` button in the
sidebar's needs header), and it renders three lists: `needs`, `andando:`, `feito hoje:`. The
sidebar shows **only the first of the three** — they share `NeedsList`, nothing else. So the two
thirds of the cockpit that describe what is actually happening (which children are running, what
finished today) live behind a keystroke, while the space that would hold them sits empty one
panel away.

**The vault Map is not read.** `src/vault/map/*` (sigma.js + graphology + ForceAtlas2, backed by
~500 lines of `src-tauri/src/vaultmap.rs` with an FS watcher and persisted positions) draws every
rule as a point. The user's verdict, verbatim: *"quando eu abro o Vault e vou pro Map, do jeito
que tá, tá muito ruim, tá muito feio. Ninguém vai ficar lendo ali. Do jeito que tá, eu prefiro
retirar."* It is a lot of machinery for a view that is not consulted.

The vault's size and health are genuinely interesting — they are just not interesting as a
force-directed hairball of 3,579 nodes. They are interesting as *one glanceable thing that
changes*.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Sidebar vs. cockpit | The sidebar renders the **whole cockpit** (needs + andando + feito). The `cockpit` pane **survives**. | The sidebar shows one third of the cockpit today; the missing two thirds are exactly what fills the empty space. The pane survives because `MissionMap` (React Flow) does not fit in 360px. |
| What `⤢` means now | Not "go to the cockpit" — **"expand what you are already looking at"**. Still opens the pane, still `⌘⇧B`. | With the body in the sidebar, the pane's remaining job is the map and elbow room. |
| Collapse state | **Shared** between sidebar and pane, same rules as today: `needs` always open, `andando` open when `needs` is empty, `feito` collapsed. | One state, one behaviour. "andando opens when nothing blocks you" is precisely what fills the void. Per-surface state is a cheap follow-up if 360px proves tight. |
| The vault view | A **square at the foot of the sidebar** (~160×160): the mnemo octopus over a halo of dots, with a level and a bar. | Replaces a graph nobody reads with one thing that changes and is legible at a glance. |
| Level source | **Size** drives the level (monotonic, never falls). **Health** drives colour, and sustained good health lights a fire effect. | Two independent axes. Size cannot lie about quality because it is not claiming to measure quality; health carries that load and is free to fall. |
| Level curve | **Linear, wide step**: `level = floor(xp / 100)`. | The only curve where the bar visibly moves. A log curve puts a 3,579-page vault on a permanent plateau on day one. |
| XP formula | `xp = pages + K × rules_fired`, K **pending calibration** (see §5). | The user asked for size as the base and fire as an accelerator. The measured numbers make the honest K non-obvious — see §5, which is the one open question in this spec. |
| Level never regresses | Persist the highest xp ever seen; the level is computed from that. | A rule retired by the friction loop reduces `rules_fired`. Health should report that; the bar should not walk backwards. |
| One octopus, not two | When a `mnemo://pulse` arrives, the octopus **leaves the square** (scale-to-zero + fade, ~200ms), the presence overlay plays over the causing pane, and it returns when the scene ends. The halo stays behind. | The user's idea, and better than the alternative: there is exactly one creature on screen, and it moves. The empty square with a pulsing halo *is* the information — he is not here because he is working. |
| Exit style | **Shrink in place.** No directional flight. | Flying toward the causing pane couples the square to pane geometry before we know the effect is worth it. That is the version to build after this one is on screen. |
| The Map | **Removed.** | The user prefers it gone; the ego view already answers "this rule and its neighbours", which is the real use. |
| Data source | `vault_health()` + `mnemo://pulse`. **Never** `vault_map`. | If the square read `vault_map`, deleting `vaultmap.rs` would be impossible and we would be maintaining the Rust we set out to kill. |
| Build order | Sidebar and Map removal now; the square **blocks** on `feat/mnemo-presence` merging. | The square needs `src/avatar/*` and the 9-kind `PulseKind`, both being edited right now in `/Users/xyrlan/github/mnemo-desktop-wt-presence`. Two sessions in one file cost three git accidents on 2026-09-12. |

## 1. Piece 1 — the cockpit moves into the sidebar

The sidebar (which is on the **right**: `.app` is `flex-direction: row` with `<Sidebar />` second
and `border-left`) goes from two blocks to three.

```
┌─────────────────────────┐
│ .ws-tabs                │  unchanged — Home / tabs / new tab, max-height 55%
├─────────────────────────┤
│ .sidebar-body           │  now the WHOLE cockpit body:
│   errors                │    needs / andando: / feito hoje:
│   needs you        [⤢]  │  flex: 1 1 auto, overflow: auto (as today)
│   andando:              │
│   feito hoje:           │
├─────────────────────────┤
│                         │
│      the square         │  NEW — flex: 0 0 auto, ~160×160
│                         │
└─────────────────────────┘
```

`.sidebar-body` is already `flex: 1 1 auto; overflow: auto` (`src/theme.css:104`), so the square
docks as a sibling with `flex: 0 0 auto` and needs no layout surgery.

### The refactor this asks for

`Cockpit.tsx:172` currently holds head + errors + three lists + keyboard handling + the optional
`MissionMap`. The body (the three lists and their rows) becomes a shared component that both the
sidebar and the pane render, parameterised by width. `NeedsList` (`src/cockpit/NeedsList.tsx:33`)
already proves the pattern — it is shared today; we extend it to the rest.

What stays pane-only: the head line, `MissionMap`, and the keyboard hint bar.

Keyboard (↑↓ ↩ r a y/n, `Cockpit.tsx:50`) is pane-only in this cut. The sidebar is a reading and
clicking surface. Giving the sidebar its own focus ring is a follow-up, not part of this.

### What does not change

- `openNeed()` (`NeedsList.tsx:7`) keeps its behaviour: rows open the child's mission pane, the PR
  in a browser pane, or the contract in an editor pane. Rows have never navigated to the cockpit.
- The poll stays in `Sidebar.tsx:122-134` (3s focused / 15s hidden, PRs every 10th tick). The
  cockpit consumes the snapshot; it does not poll. That is already true and stays true.
- Sidebar width stays session-only (mission store, default 360, clamp 240–720, not persisted).

## 2. Piece 2 — the Map is removed

**Deleted:**

| What | Path |
|---|---|
| The "Mapa" button | `src/vault/view.tsx:175-176` |
| The `vault.map` palette action | `src/vault/view.tsx:228` (and `open()` at `:219`) |
| The lazy import and its `<Suspense>` | `src/vault/view.tsx:17`, `:179-182` |
| The map module | `src/vault/map/` — `MapPane.tsx`, `MapView.tsx`, `renderer.ts`, `model.ts`, `live.ts`, `types.ts`, `client.ts`, `store.ts` and tests |
| The Rust module | `src-tauri/src/vaultmap.rs` (~500 lines, incl. the `notify` watcher) |
| Commands | `vault_map`, `vault_map_positions_read`, `vault_map_positions_write` (registered `lib.rs:96-193`) |
| The watcher start | `src-tauri/src/lib.rs:201` |
| Events | `mnemo://vault-born`, `mnemo://vault-changed` |
| Dependencies | `sigma`, `@sigma/node-border`, `graphology`, `graphology-layout-forceatlas2`, `graphology-types` |
| CSS | the `.vm-*` block, `src/vault/vault.css:185-191` |

**Kept:** the **ego view** (`src/vault/EgoView.tsx:60`, React Flow + dagre via `src/graph/*`,
fed by `vault_ego`). It answers "this rule and what surrounds it", which is the question the
hairball never answered. `src/graph/*` also still serves the cockpit's `MissionMap`, so it stays
regardless.

**User data:** `~/.mnemo-desktop/vault-map-positions.json` is left on disk. It becomes a dead
file; deleting a user's data during a migration to remove a feature is a worse default than
leaving a few KB behind.

The vault pane's mode bar goes from `health | pages | Mapa` to `health | pages`, and the
`mapOpen` branch (`view.tsx:154`, `:169`, `:179`) collapses.

## 3. Piece 3 — the square

Three stacked layers in ~160×160 at the foot of the sidebar.

### Layer 1 — the halo

Dots behind the octopus. Density grows with vault size in bands, so growth is visible without
being a per-page count. This is the "watch the memory grow" the user asked for.

When a pulse arrives, dots near it flash (`mnemo://pulse` already carries the kind and the
project/agent; `pulseMatches` already exists in `src/pulse/store.ts`).

**The halo never leaves.** It is what remains in the square while the octopus is away.

### Layer 2 — the octopus

`<Avatar size={96} scene="idle" />` — the same component the presence spec ships
(`src/avatar/Avatar.tsx`, pixel art as addressable SVG `<rect>`s, CSS-driven). One new scene,
`idle`: breathing, at rest.

The exit/return cycle:

```
pulse arrives ──► octopus: scale(0) + fade, ~200ms ──► square shows halo only
                                │
                                └──► presence overlay plays over the causing pane (3s)
                                                │
square shows octopus again ◄── scale(1) + fade ◄┘
```

The square subscribes to the same pulse stream as the overlay. It does not need to know *where*
the overlay played — only that a scene is running.

### Layer 3 — the HUD

Level and bar. `level = floor(xp / 100)` from the highest xp ever recorded, with the progress bar
showing the distance to the next step.

### Health is colour

An index over `vault_health()`'s fields — fire rate, `never_fired`, `dormant`, `label_only`,
pending `inbox` — tints the octopus and the halo. Sustained high health lights the fire effect.

**The weights and the fire threshold are not decided here.** See §5.

### Data

Everything from `vault_health()` and `mnemo://pulse`.

`Health` (`src-tauri/src/vault.rs:894`) already carries `pages`, `never_fired`, `dormant`,
`label_only`, `inbox`, and `health_at()` is fed by `read_fires(&root)` — the same fire data
`vault_map` used, reached through `vault.rs` rather than `vaultmap.rs`. So `rules_fired =
pages − never_fired`, and the square has no reason to touch the module we are deleting.

**One cost to solve in the plan:** `vault_health()` shells out to `mnemo status` **and**
`mnemo doctor` on every call (`vault.rs:1305-1310`). That is far too expensive for a square that
updates continuously. Two options, to be decided when planning:

- a new cheap command (`vault_level()`) that does the page walk and `read_fires` without shelling
  anything; or
- cache `vault_health()` behind a long TTL and let the square read the cache.

The first is cleaner and probably smaller. Neither changes this design.

## 4. Build order

| # | Piece | Blocked by |
|---|---|---|
| 1 | Cockpit into the sidebar | nothing — touches `src/cockpit/*`, `src/mission/Sidebar.tsx` |
| 2 | Map removal | nothing — touches `src/vault/*`, `src-tauri/` |
| 3 | The square | **`feat/mnemo-presence` merging to main** |

1 and 2 are independent of each other and of the presence branch; either can go first. 3 depends
on `src/avatar/*` and on `PulseKind` growing from 4 kinds to 9 — both are being written right now
in the `mnemo-desktop-wt-presence` worktree. Building 3 before that merges means two sessions
editing one module.

## 5. Open question: the XP formula

This is the one thing this spec does not settle, and it should not be settled from memory.

Measured on the live vault, 2026-09-16:

| Quantity | Value | Source |
|---|---|---|
| Pages (`.md`, excluding `_archive/` and `_inbox/`) | **3,579** | `find` over `~/mnemo` |
| Distinct slugs ever seen firing | **104** | distinct `emitted` in `.mnemo/reflex-log.jsonl` |
| Total emissions in the log | **135** over 1,084 rows | same file |
| Reflex injection rate (14d) | 6.1% of 3,018 prompts | `mnemo status` |

The shape of the problem: **fire is rare.** Only ~2.9% of pages have ever fired, and the reflex
log is a recent window rather than a full history, so counting total fires instead of distinct
ones yields an even smaller number (135). Any K large enough to make fire feel like it matters is
a large, arbitrary K.

Three candidates:

- **K = 3** — `xp = 3579 + 312 = 3891`, level 38. Fire is 8% of xp: effectively invisible. This
  fails the user's stated intent that fire should be worth "bastante XP".
- **K = 20** — `xp = 3579 + 2080 = 5659`, level 56. Fire is 37% of xp. Defensible on the grounds
  that a page which has fired is ~34× rarer than a page which merely exists.
- **Distinct × high K, plus total fires at a low K** — reach and usage as separate terms, so the
  bar keeps moving with use after distinct slugs saturate.

Pick by measuring against the real vault before writing the number into code. Two earlier numbers
in this conversation (1,946 pages, 421 fired) came from a briefing rather than from the vault and
were both wrong; the table above is the measured replacement.

The **health weights** and the **fire threshold** are open in the same way and for the same
reason.

## 6. Testing

Follows the repo's existing split: `store.ts` is pure and injectable, `client.ts` wraps `invoke`,
tests sit beside each file and never import Tauri.

- **Piece 1:** the shared cockpit body renders all three lists; collapse rules hold (`andando`
  open iff `needs` is empty); collapse state is shared across two mounted instances; `⤢` opens
  the pane; existing `NeedsList` and `Cockpit` tests keep passing unchanged.
- **Piece 2:** the vault pane's mode bar offers exactly `health` and `pages`; no import of
  `sigma`/`graphology` survives anywhere; the Rust build has no `vaultmap` module and `lib.rs`
  registers no `vault_map*` command.
- **Piece 3:** `xp`/`level` are a pure function, tested at the boundaries (0, exact multiples of
  100, and the never-regress case where `rules_fired` drops); the halo band function is pure; a
  pulse hides the octopus and it returns when the scene ends (fake timers).

## 7. What this does not do

- No directional flight between the square and the pane (deliberate; see Decisions).
- No keyboard navigation in the sidebar's cockpit body.
- No per-surface collapse state.
- No replacement for the Map's "find one rule among all of them" — the ego view and the pages
  table already cover that, and the square is not attempting it.
- No persisted sidebar width (unchanged from today).

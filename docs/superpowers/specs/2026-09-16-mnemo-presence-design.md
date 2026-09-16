# mnemo-desktop — mnemo presence: the octopus acts on screen

**Date:** 2026-09-16
**Status:** designed, not built
**Depends on:** pulse (#44, shipped), mission cockpit (PR #6, shipped), the pane bar's `place` matching (`src/chrome/info.ts`).

## 1. Why

mnemo works constantly and almost invisibly. Today the desktop shows four of its actions, and shows them as a 3-second CSS flash on the pane bar plus a counter — enough to know *something* happened, not enough to know *what*. Five more actions it takes (saving a briefing, catching a session up, learning a rule, noting friction, dispatching children) leave rows in the vault's logs that nothing on screen reads.

The result is a tool whose value is mostly invisible at the moment it delivers it. This spec makes each mnemo action announce itself as a short, legible scene: the mnemo octopus doing the thing, with a one-line caption, over the pane whose session caused it. The same character then carries the cockpit's child states, so the app speaks one visual language instead of two.

## 2. What was decided

| Decision | Choice | Rejected |
|---|---|---|
| Which actions | All 9 — the 4 that exist plus 5 new | Only the new ones; a smaller subset |
| Where | Floating overlay over the pane | Pane bar only; a corner toast; a dimming takeover |
| Ground | No dimming, no panel — avatar + soft purple halo | Clean (avatar competes with text); soft vignette (still dimming) |
| Caption | English, gerund, lowercase, one line | Portuguese; no caption |
| Art | Pixel art as SVG `<rect>`, CSS-driven | Animating `mark.svg`; hand-drawn GIF; AI-generated GIF |
| Legibility | Strategy 1 — the octopus carries a recognisable **object** per action | Colour-only with one idle; a mixed approach |
| Routing | Only the pane of the session that caused it | Fall back to the focused pane; always the focused pane |
| Cockpit | All 5 child states loop (option C) | Only BLOCKED and active animate; static done/stopped |
| Scope | One cut: 9 overlays + 5 cockpit states | Overlays first, cockpit later; avatar + existing 4 kinds first |

### 2.1 Why the existing mark cannot be animated

`src/brand/mark.svg` is 26KB of vectoriser output: **65 `<path>`, zero `<g>`, zero `id`**, colours hardcoded as `rgb()`. No path is addressable, so "the third arm reaches" cannot be expressed; and the contours are organic curves, so a new pose needs path morphing rather than `transform`. Its ceiling is rotate, scale, opacity, hue-rotate.

Pixel art removes the problem structurally rather than stylistically: on a grid, an arm **is** a column of addressable `<rect>`s, and a new pose is moving cells, not interpolating Béziers.

The mark is **not replaced**. It has exactly one consumer (`src/brand/Wordmark.tsx` → `src/home/Home.tsx`) plus the separately-generated `src-tauri/icons/`. The pixel octopus is a *character* derived from it — same head, same node ring, same arms — living beside the logo.

## 3. Architecture

```
.mnemo/*.jsonl  →  Rust tail (1s)  →  mnemo://pulse  →  pulseStore  →  Overlay  →  Avatar
                   src-tauri/src/pulse.rs             (existing)      (new)       (new)
```

One new module, two extended.

```
src/avatar/          NEW    the character: scenes for 9 actions + 5 child states
  Avatar.tsx                <Avatar scene="injecting" size={88} />
  scenes.ts                 rects, colours, timing per scene
  avatar.css                @keyframes per scene
  avatar.test.tsx

src/pulse/           EXTEND
  Overlay.tsx        NEW    mounts in the pane, matches by `place`, plays once
  overlay.css        NEW
  types.ts           EDIT   PulseKind: 4 → 9

src-tauri/src/pulse.rs  EXTEND   4 tails → 8 files, 9 kinds

src/cockpit/MissionMap.tsx  EDIT   card gets `scene` from `childWord(c)`
src/cockpit/cockpit.css     EDIT   the five looping states
```

Routing is **not new code**. `barInfo().place` (`src/chrome/info.ts`) already resolves a pane to its repo name, and `pulseMatches(event, place)` (`src/pulse/store.ts`) already matches an event to it by project-or-agent. The overlay hangs on the same seam the pane-bar flash uses.

## 4. The nine kinds

Each kind needs a real log row. Four exist; four are new tails; one is a split of an existing tail.

| kind | log file | becomes an event when | caption |
|---|---|---|---|
| `reflex` | `reflex-log.jsonl` | *exists* — `emitted` non-empty | injecting N rules |
| `tool` | `mcp-access-log.jsonl` | *exists* — minus `llm.*` **and minus `session_start.inject`** | reading memory |
| `enrich` | `enrichment-log.jsonl` | *exists* — `hit_slugs` non-empty | remembering before the edit |
| `enforce` | `denial-log.jsonl` | *exists* — has a `slug` | blocked that command |
| `catchup` | `mcp-access-log.jsonl` | **split** — `tool == "session_start.inject"` | catching you up |
| `briefing` | `briefing-log.jsonl` | **new** — every row | saving the briefing |
| `learned` | `learned.jsonl` | **new** — every row | learned something |
| `friction` | `friction-ledger.jsonl` | **new** — every row **except `backfilled: true`** | noted the friction |
| `dispatch` | `dispatch-parents.jsonl` | **new** — every row, project resolved (§4.2) | dispatching N children |

### 4.1 Row shapes, as observed in the live vault

```jsonl
briefing-log.jsonl      {"timestamp","project","path","session_id","date","body_bytes","body_sha256"}
learned.jsonl           {"seq","ts","run_id","slug","type","name","projects":[…],"confidence","quote"}
friction-ledger.jsonl   {"id","ts","session_id","project","quote","rule_text","briefing","contradicts":[],"origin","backfilled"}
dispatch-parents.jsonl  {"short_id","parent_session"}
```

Three consequences the `Row` struct must absorb:

- `learned.jsonl` carries **`projects` (an array)**, not `project`. The first entry names the pane; an empty array yields no match and the event is dropped.
- `friction-ledger.jsonl` and `briefing-log.jsonl` use `ts` / `timestamp` respectively — both already handled by the existing `ts.or(timestamp)` fallback.
- `dispatch-parents.jsonl` carries **neither project nor agent** — see §4.2.

### 4.2 `dispatch` has no project

A dispatch row is `{"short_id","parent_session"}` and nothing else, so `pulseMatches` can never match it to a pane and the event would silently vanish.

**Rejected: `session-queue.json`.** It is keyed by **short_id**, and its values hold `last_tempo` / `unblocks` / `last_needs` — no project, no cwd. It cannot perform this lookup.

**Rejected: `briefing-log.jsonl`.** It does map `session_id` → `project`, but a briefing is written when a session *ends*, so at dispatch time the row usually does not exist yet. Measured against the live vault: **4 of 8** dispatch parent sessions resolvable.

**Resolution: an in-memory session→project map built from the rows already being tailed.** `reflex-log.jsonl` carries both `session_id` and `project` and is written *live* throughout a session. The `Pulse` struct keeps a `HashMap<String, String>` and records the pair every time any parsed row carries both fields — reflex rows mostly, but briefing and friction rows feed it too. `dispatch` rows then resolve `parent_session` against it. Measured against the live vault: **8 of 8** dispatch parent sessions resolvable this way.

A dispatch whose parent session is not yet in the map is **dropped**, not guessed. This costs the first dispatch of a session that has not yet triggered any reflex injection; that is accepted, and preferred to showing the scene over an unrelated pane.

### 4.3 Counting children

`dispatching N children` needs N, but each row is one child. Rows for one dispatch arrive within the same poll, so the Rust side **coalesces dispatch rows within a single `poll()`** into one event carrying the count. A dispatch spread across two polls shows as two events; that is accepted.

### 4.4 Backfill must not stampede

`friction-ledger.jsonl` contains ~676 backfilled rows. `Tail::at_end` protects against *history*, but a `mnemo friction backfill` run **during** a session would append hundreds of rows at once. Rows with `backfilled: true` are therefore discarded at parse time.

### 4.5 `enforce` is not verifiable today

`denial-log.jsonl` **does not exist** in the live vault (`/Users/xyrlan/mnemo/.mnemo/`), so the existing enforcement toast has most likely never fired against real data. `Tail::at_end` already handles an absent file (it reads from the first line once it appears), so nothing breaks — but `enforce` is the one kind that cannot be validated with a real fixture until a denial happens. Its test uses the synthetic fixture already in `src-tauri/fixtures/pulse/denial-log.jsonl`.

## 5. The overlay

### 5.1 Behaviour

Mounts inside the pane, `position: absolute; inset: 0; pointer-events: none` — it never takes a click from the terminal underneath. No dimming, no backdrop, no panel: the avatar sits centred with a soft purple `drop-shadow` halo, the caption in mono directly beneath it.

Lifecycle: **in** ~180ms (fade + scale from 0.85) → **hold** ~1.1s → **out** ~250ms (fade). ~1.5s total.

**One overlay per pane at a time.** An event arriving while one plays **replaces** it rather than queueing. Queueing would make the overlay lag behind what mnemo is actually doing, and a stale scene is worse than a skipped one.

Matching: `pulseMatches(event, barInfo(pane).place)`. An event matching no open pane appears nowhere. That loss is accepted and deliberate — showing it over unrelated work would be worse than not showing it.

### 5.2 Accessibility

`@media (prefers-reduced-motion: reduce)`: no movement at all — the caption fades in and out, the avatar renders on its resting frame. This is not optional; the overlay covers the centre of the user's working area.

The overlay host carries `role="status" aria-live="polite"` so the caption is announced, matching the existing `Toasts`.

### 5.3 What replaces what

The pane-bar flash (`pane-bar-pulsing`, `pane-bar-glow`, `FLASH_MS`) and its counter badge **stay**. The overlay is additive: the bar keeps the running count and the click-to-open-rule affordance, the overlay carries the moment. The `enforce` toast in `src/pulse/Toasts.tsx` also stays — a blocked command deserves a message that outlives 1.5s.

## 6. The avatar

`<svg viewBox="0 0 32 32" shape-rendering="crispEdges">`, one `<rect>` per pixel, ~40–60 rects per scene. Colours come from theme tokens (`var(--accent)`, `var(--ansi-yellow)`, …), never hardcoded — the failure `mark.svg` demonstrates with its 50 fixed `rgb()` values.

Each scene pairs a **recognisable object** with a movement. The object carries the meaning; the movement carries the life. This is the decision that makes the set legible — abstract gestures alone were tested and could not be told apart.

| scene | object | movement |
|---|---|---|
| `injecting` | pages | descend into the pane, staggered |
| `reading` | ring node | one arm probes, nodes light in sequence |
| `remembering` | open scroll | an arm holds it, ring turns slowly |
| `blocked` | STOP sign | slams in, body shakes, red |
| `saving` | scroll | rolls up and tucks away, shrinks |
| `catchup` | scroll | unrolls and opens, grows |
| `learned` | new green node | pops into the ring |
| `friction` | hook / barb | an arm snags and pulls, amber |
| `dispatching` | 3 small octopuses | fly out in a fan, staggered |

**Known weak pair:** `reading` and `remembering` are adjacent concepts and their objects risk reading alike. They are drawn with deliberate contrast (probing vs. holding) and must be re-judged on screen; if they remain confusable, `remembering` takes a distinct object (a pinned note).

## 7. The cockpit

The same character at ~30px in the corner of each mission-map card. `MissionMap.tsx` already computes `childWord(c)`, which returns exactly the five values, and already passes `tone` and `pulse`; it gains a `scene`.

All five loop, as chosen. `done` and `stopped` loop **slowly and with low amplitude** so that BLOCKED's amber still wins the eye — a map where six cards pulse equally is noise, and the one card that needs the user must remain the one that stands out.

| state | loop | amplitude |
|---|---|---|
| `active` | arms row, 1.1s; a line runs along the card's base | medium |
| `BLOCKED` | arms up, 0.62s; amber ring | **high** — the only one asking for action |
| `stalled` | sinks and dims, 3.4s | low |
| `done` | breathes, 4s; the ✓ draws once on entry | very low |
| `stopped` | breathes, 5s; greyed, eyes closed | minimal |

`gr-pulse` in `src/graph/graph.css` (the red ring) stays as the **graph's** own affordance, where `src/graph/Graph.tsx` still applies it.

**This changes an existing test.** `src/cockpit/Cockpit.test.tsx:198` asserts `.gr-pulse` on a mission-map node — a `piece:` card inside `.ck-map`, not a graph card:

```ts
const vault = [...host.querySelectorAll<HTMLElement>('.ck-map .react-flow__node')].find(…)!
expect(vault.querySelector('.gr-pulse')).not.toBeNull()
```

Once the mission map renders scenes, a BLOCKED card no longer carries `.gr-pulse`. The assertion must be rewritten to check the BLOCKED scene (`.av-blocked`), keeping its intent: *a blocked card on the map is visibly marked*. `MissionMap.tsx` keeps passing `pulse` in its card data; only the class it produces changes.

`prefers-reduced-motion` applies here too: every loop stops, the states read by colour and border alone.

## 8. Testing

**Rust (`src-tauri/src/pulse.rs`)**
- `parse_line` for each new log, against a fixture copied from real vault rows. `src-tauri/fixtures/pulse/` holds four today (`reflex`, `mcp-access`, `enrichment`, `denial`); this adds `briefing-log.jsonl`, `learned.jsonl`, `friction-ledger.jsonl`, `dispatch-parents.jsonl`. Rows are copied from the live vault and scrubbed of paths outside the repo — a fixture whose shape is invented rather than observed is a known way to ship bugs that the suite cannot see.
- `learned.jsonl`: `projects[0]` names the pane; an empty array yields `None`.
- `friction-ledger.jsonl`: `backfilled: true` yields `None`.
- `mcp-access-log.jsonl`: `session_start.inject` yields `catchup`, never `tool`; `llm.*` still yields `None`.
- `dispatch-parents.jsonl`: a session already in the map resolves to its project; an unseen session yields `None`; two rows in one `poll()` coalesce to one event with `hits: 2`.
- The session→project map records a pair from any row carrying both `session_id` and `project`, and a later `dispatch` row resolves against it.
- The existing tail tests (rotation, truncation, partial lines, no history replay) keep passing unchanged.

**TypeScript**
- `Overlay` shows an event whose `place` matches and ignores one that does not.
- A second event replaces the first rather than stacking.
- The overlay clears itself after its duration.
- `prefers-reduced-motion` renders the caption without animation classes.
- `scenes.ts` is typed as `Record<PulseKind, Scene>` and `Record<ReturnType<typeof childWord>, Scene>`, so a missing scene fails the **build**, not a test. (`childWord` returns the union `'active' | 'BLOCKED' | 'stalled' | 'done' | 'stopped'`; it is not a named exported type.)
- `MissionMap` renders the scene matching each `childWord`.
- `Cockpit.test.tsx:198` is rewritten from `.gr-pulse` to the BLOCKED scene (§7).

## 9. Risks

1. **Frequency — deferred by decision, not resolved.** `mcp-access-log.jsonl` is 983KB and `tool` is the most common kind; a 1.5s centred overlay on every MCP call may prove unbearable. The control point is built but left off: `scenes.ts` carries a `minIntervalMs` per scene, defaulting to 0. Turning it on is a one-line change per kind once real use shows the rate.
2. **`dispatch` project resolution** (§4.2) depends on the parent session having been seen in an earlier tailed row. The map is built from live data and measured at 8/8 on the current vault, but a dispatch fired before the parent's first reflex injection is dropped. If this proves common in use, the fallback is to read the session's cwd from `claude agents --json`, which `src/mission/` already shells out to.
3. **`enforce` unverifiable** (§4.5) until a real denial occurs.
4. **`reading` / `remembering` legibility** (§6) — re-judge on screen.
5. **Nine tails at 1s** versus four today. All tailed files are small (largest 983KB) and reads are incremental by byte offset, so no file is re-read; the added cost is five `stat` calls per second.
6. **Cockpit motion budget.** Option C means every card moves forever. If the map becomes tiring in practice, the mitigation is already in the design (amplitude, not presence): lower `done`/`stopped` further before removing any loop.

## 10. Out of scope

- Changing `src/brand/mark.svg`, `Wordmark.tsx`, or the app icons.
- New mnemo-side logging. Every kind here reads a row mnemo already writes.
- Sound.
- User configuration of which kinds overlay (the `minIntervalMs` seam exists; no UI).
- Replacing the pane-bar flash, its counter, or the enforcement toast.

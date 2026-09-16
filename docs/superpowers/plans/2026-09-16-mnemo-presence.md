# mnemo presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each mnemo action announce itself on screen as a short pixel-art scene over the pane whose session caused it, and give the cockpit's five child states the same character.

**Architecture:** A Rust thread already tails four vault logs and emits `mnemo://pulse`. This extends it to eight files and nine kinds, adds a pixel octopus drawn as addressable SVG `<rect>`s, and hangs a transient overlay on the pane-bar's existing `place` matching. The cockpit's mission-map cards render the same character per child state.

**Tech Stack:** Rust (Tauri 2, serde_json), React 19 + TypeScript, zustand, vitest + jsdom, CSS keyframes.

**Spec:** `docs/superpowers/specs/2026-09-16-mnemo-presence-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/pulse.rs` | *modify* — 4 tails → 8, 4 kinds → 9, session→project map, dispatch coalescing |
| `src-tauri/fixtures/pulse/*.jsonl` | *create* — real rows for the four new logs |
| `src/pulse/types.ts` | *modify* — `PulseKind` 4 → 9 |
| `src/avatar/scenes.ts` | *create* — the scene table: pixels, colours, caption, timing |
| `src/avatar/Avatar.tsx` | *create* — renders one scene as `<svg>` of `<rect>` |
| `src/avatar/avatar.css` | *create* — `@keyframes` per scene |
| `src/pulse/Overlay.tsx` | *create* — picks the pane's event, plays one scene, clears |
| `src/pulse/overlay.css` | *create* — centring, halo, caption, reduced-motion |
| `src/chrome/PaneBar.tsx` | *modify* — mount `<Overlay place={info.place} />` |
| `src/cockpit/MissionMap.tsx` | *modify* — card renders `<Avatar>` for the child state |
| `src/cockpit/cockpit.css` | *modify* — the five looping states |
| `src/cockpit/Cockpit.test.tsx` | *modify* — `.gr-pulse` assertion → BLOCKED scene |

**Order:** Rust first (Tasks 1–5) so real events exist; then the avatar (6–8), which is pure and testable alone; then the overlay (9–10); then the cockpit (11–12).

**Commands used throughout:**
- TypeScript tests: `pnpm test` (all), `pnpm vitest run src/path/file.test.tsx` (one file)
- Types: `pnpm exec tsc --noEmit`
- Rust tests: `cd src-tauri && cargo test pulse`

---

## Task 1: Fixtures for the four new logs

Real rows, copied from the live vault. A fixture whose shape is invented rather than observed is how bugs ship past a green suite.

**Files:**
- Create: `src-tauri/fixtures/pulse/briefing-log.jsonl`
- Create: `src-tauri/fixtures/pulse/learned.jsonl`
- Create: `src-tauri/fixtures/pulse/friction-ledger.jsonl`
- Create: `src-tauri/fixtures/pulse/dispatch-parents.jsonl`

- [ ] **Step 1: Write the four fixture files**

`src-tauri/fixtures/pulse/briefing-log.jsonl`:
```jsonl
{"timestamp": "2026-09-16T15:18:04Z", "project": "mnemo", "path": "bots/mnemo/briefings/sessions/e7fb983c.md", "session_id": "e7fb983c-6dc5-4d69-91b3-dce4ad7682da", "date": "2026-09-16", "body_bytes": 8135, "body_sha256": "sha256:2b10353016d02fc3"}
{"timestamp": "2026-09-16T09:02:11Z", "project": "mnemo-desktop", "path": "bots/mnemo-desktop/briefings/sessions/aa11.md", "session_id": "aa110000-0000-0000-0000-000000000001", "date": "2026-09-16", "body_bytes": 512, "body_sha256": "sha256:deadbeef"}
not json
```

`src-tauri/fixtures/pulse/learned.jsonl`:
```jsonl
{"seq": 343, "ts": "2026-09-16T11:14:50", "run_id": "2026-09-16T11:14:28", "slug": "activate-learned-behavior-immediately", "type": "reference", "name": "Activate learned behavior immediately", "projects": ["mnemo"], "confidence": "inferred", "quote": null}
{"seq": 344, "ts": "2026-09-16T11:15:02", "run_id": "2026-09-16T11:14:28", "slug": "two-projects", "type": "reference", "name": "Two projects", "projects": ["mnemo-desktop", "mnemo"], "confidence": "stated", "quote": null}
{"seq": 345, "ts": "2026-09-16T11:16:00", "run_id": "2026-09-16T11:14:28", "slug": "no-project", "type": "reference", "name": "No project", "projects": [], "confidence": "inferred", "quote": null}
```

`src-tauri/fixtures/pulse/friction-ledger.jsonl`:
```jsonl
{"id": "f-20260916-aaaa", "ts": "2026-09-16T10:00:00Z", "session_id": "e7fb983c-6dc5-4d69-91b3-dce4ad7682da", "project": "mnemo", "quote": "nao era isso", "rule_text": "Ask before rewriting a whole file.", "briefing": "x.md", "contradicts": [], "link_basis": "none", "injected_in_session": [], "origin": "user", "backfilled": false}
{"id": "f-20260814-6455", "ts": "2026-08-14T10:34:35Z", "session_id": "9165fe70-afe9-4430-a505-5dbfdf4211c2", "project": "meunu", "quote": "pusha e abre PR", "rule_text": "Push, open PR, merge in order.", "briefing": "y.md", "contradicts": [], "link_basis": "none", "injected_in_session": [], "origin": "user", "backfilled": true}
```

`src-tauri/fixtures/pulse/dispatch-parents.jsonl`:
```jsonl
{"short_id": "bb16ea01", "parent_session": "e7fb983c-6dc5-4d69-91b3-dce4ad7682da"}
{"short_id": "cc27fb12", "parent_session": "e7fb983c-6dc5-4d69-91b3-dce4ad7682da"}
{"short_id": "dd38ac23", "parent_session": "00000000-unseen-session-0000-000000000000"}
```

- [ ] **Step 2: Verify each line is valid JSON except the deliberate junk**

Run:
```bash
cd src-tauri/fixtures/pulse && for f in briefing-log.jsonl learned.jsonl friction-ledger.jsonl dispatch-parents.jsonl; do echo "$f: $(python3 -c "
import json,sys
ok=bad=0
for l in open('$f'):
    l=l.strip()
    if not l: continue
    try: json.loads(l); ok+=1
    except: bad+=1
print(f'{ok} valid, {bad} junk')
")"; done
```
Expected:
```
briefing-log.jsonl: 2 valid, 1 junk
learned.jsonl: 3 valid, 0 junk
friction-ledger.jsonl: 2 valid, 0 junk
dispatch-parents.jsonl: 3 valid, 0 junk
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/fixtures/pulse/
git commit -m "test(pulse): fixtures for the four new vault logs"
```

---

## Task 2: `PulseKind` gains five kinds (Rust + TS in lockstep)

The Rust `kind` is a `&'static str`; the TS union must match it exactly or the overlay silently renders nothing.

**Files:**
- Modify: `src/pulse/types.ts:3`
- Modify: `src/chrome/info.ts:59` (the `KIND` record must stay exhaustive)
- Test: `src-tauri/src/pulse.rs` (existing test module)

- [ ] **Step 1: Widen the TS union**

In `src/pulse/types.ts`, replace line 3:

```ts
export type PulseKind = 'reflex' | 'tool' | 'enrich' | 'enforce' | 'catchup' | 'briefing' | 'learned' | 'friction' | 'dispatch'
```

- [ ] **Step 2: Verify types still compile**

Run: `pnpm exec tsc --noEmit`
Expected: **one error**, which this task also fixes:

```
src/chrome/info.ts(59,7): error TS2739: Type '{ reflex: …; tool: …; enrich: …; enforce: … }' is missing
the following properties from type 'Record<PulseKind, string>': catchup, briefing, learned, friction, dispatch
```

`KIND` in `src/chrome/info.ts:59` is a `Record<PulseEvent['kind'], string>`, and TypeScript requires such a
record to be exhaustive — so widening the union breaks it. Add the five entries (these are the pane-bar badge
tooltips, not the overlay captions, which live in `scenes.ts`):

```ts
const KIND: Record<PulseEvent['kind'], string> = {
  reflex: 'injected',
  tool: 'tool call',
  enrich: 'enriched',
  enforce: 'blocked',
  catchup: 'caught you up',
  briefing: 'saved a briefing',
  learned: 'learned',
  friction: 'noted friction',
  dispatch: 'dispatched',
}
```

Then re-run `pnpm exec tsc --noEmit`: no output (exit 0), and `pnpm test` stays at 490 passing.

- [ ] **Step 3: Commit**

```bash
git add src/pulse/types.ts
git commit -m "feat(pulse): PulseKind gains catchup, briefing, learned, friction, dispatch"
```

---

## Task 3: Split `catchup` out of `tool`

`session_start.inject` is mnemo catching a session up, not the agent reading memory. It is currently indistinguishable from any other MCP call.

**Files:**
- Modify: `src-tauri/src/pulse.rs` (the `Log::Access` arm of `parse_line`)
- Test: `src-tauri/src/pulse.rs` (test module)

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/pulse.rs`:

```rust
#[test]
fn session_start_inject_is_catchup_not_tool() {
    let e = events(Log::Access, "mcp-access-log.jsonl");
    let kinds: Vec<_> = e.iter().map(|e| (e.kind, e.tool.as_deref().unwrap())).collect();
    assert_eq!(
        kinds,
        [("catchup", "session_start.inject"), ("tool", "list_rules_by_topic"), ("tool", "read_mnemo_rule")]
    );
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd src-tauri && cargo test pulse::tests::session_start_inject_is_catchup_not_tool`
Expected: FAIL — left has `("tool", "session_start.inject")`, right expects `("catchup", …)`.

- [ ] **Step 3: Implement the split**

In `parse_line`, replace the `Log::Access` arm:

```rust
        Log::Access => {
            let tool = row.tool.filter(|t| !t.is_empty() && !t.starts_with("llm."))?;
            let slugs = slugs(row.hit_slugs.as_deref().unwrap_or_default());
            let kind = if tool == "session_start.inject" { "catchup" } else { "tool" };
            Some(PulseEvent { kind, tool: Some(tool), hits: row.result_count, slugs, ..base })
        }
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd src-tauri && cargo test pulse`
Expected: PASS, including the pre-existing `access_rows_are_tool_events_except_mnemo_s_own_llm_calls`. If that older test asserts `kind == "tool"` for every row, update its assertion to allow `catchup` for the inject row — its intent is that `llm.*` rows are excluded, not that every row is a `tool`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pulse.rs
git commit -m "feat(pulse): session_start.inject is its own kind, catchup"
```

---

## Task 4: Tail briefing, learned and friction

Three new logs, each a straight row-per-event, with two filters that matter: `learned` uses a `projects` **array**, and `friction` must discard backfill.

**Files:**
- Modify: `src-tauri/src/pulse.rs` (`Log` enum, `LOGS`, `Row`, `parse_line`)
- Test: `src-tauri/src/pulse.rs`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module:

```rust
#[test]
fn briefing_rows_are_events() {
    let e = events(Log::Briefing, "briefing-log.jsonl");
    assert_eq!(e.len(), 2, "the junk line is not an event");
    assert_eq!((e[0].kind, e[0].project.as_str()), ("briefing", "mnemo"));
    assert_eq!(e[0].session_id.as_deref(), Some("e7fb983c-6dc5-4d69-91b3-dce4ad7682da"));
    assert_eq!(e[1].project, "mnemo-desktop");
}

#[test]
fn learned_rows_take_their_first_project_and_need_one() {
    let e = events(Log::Learned, "learned.jsonl");
    assert_eq!(e.len(), 2, "a row with an empty projects array is not an event");
    assert_eq!((e[0].kind, e[0].project.as_str()), ("learned", "mnemo"));
    assert_eq!(e[0].slugs, ["activate-learned-behavior-immediately"]);
    assert_eq!(e[1].project, "mnemo-desktop", "the first project names the pane");
}

#[test]
fn friction_rows_skip_the_backfill() {
    let e = events(Log::Friction, "friction-ledger.jsonl");
    assert_eq!(e.len(), 1, "backfilled rows would stampede the overlay");
    assert_eq!((e[0].kind, e[0].project.as_str()), ("friction", "mnemo"));
}
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd src-tauri && cargo test pulse`
Expected: FAIL to **compile** — `Log::Briefing`, `Log::Learned`, `Log::Friction` do not exist.

- [ ] **Step 3: Implement the three logs**

In `src-tauri/src/pulse.rs`, extend the `Log` enum:

```rust
pub enum Log {
    /// `reflex-log.jsonl`: one row per prompt, with the rules it `emitted`.
    Reflex,
    /// `mcp-access-log.jsonl`: MCP tool calls and session-start injections.
    Access,
    /// `enrichment-log.jsonl`: rules attached to an Edit/Write before it ran.
    Enrich,
    /// `denial-log.jsonl`: commands enforcement blocked.
    Denial,
    /// `briefing-log.jsonl`: one row per briefing written at session end.
    Briefing,
    /// `learned.jsonl`: one row per rule the vault learned.
    Learned,
    /// `friction-ledger.jsonl`: one row per correction the user made.
    Friction,
}

pub const LOGS: [Log; 7] = [Log::Reflex, Log::Access, Log::Enrich, Log::Denial, Log::Briefing, Log::Learned, Log::Friction];
```

Extend `Log::file`:

```rust
            Log::Briefing => ".mnemo/briefing-log.jsonl",
            Log::Learned => ".mnemo/learned.jsonl",
            Log::Friction => ".mnemo/friction-ledger.jsonl",
```

Add three fields to `Row`:

```rust
    projects: Option<Vec<String>>,
    backfilled: Option<bool>,
```

(Do **not** add a `name` field. `learned.jsonl` carries one, but nothing reads it — every other
field in `Row` is consumed by some arm, and a decorative one the next reader cannot distinguish
from a live one is worse than the missing documentation.)

Add three arms to `parse_line`'s `match`:

```rust
        Log::Briefing => Some(PulseEvent { kind: "briefing", hits: Some(1), ..base }),
        Log::Learned => {
            // `learned.jsonl` carries `projects` (an array), not `project`.
            let project = row.projects.as_deref().unwrap_or_default().first()?.clone();
            let slugs = row.slug.as_deref().map(rule_slug).map(str::to_string).into_iter().collect();
            Some(PulseEvent { kind: "learned", project: project.clone(), agent: project, hits: Some(1), slugs, ..base })
        }
        Log::Friction => {
            // A `mnemo friction backfill` run appends hundreds of rows at once.
            if row.backfilled.unwrap_or(false) {
                return None;
            }
            Some(PulseEvent { kind: "friction", hits: Some(1), ..base })
        }
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd src-tauri && cargo test pulse`
Expected: PASS. Note `pulse_emits_only_what_was_written_after_it_started` iterates `LOGS` and will now also visit the three new files — it writes each fixture by filename, so it keeps working.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pulse.rs
git commit -m "feat(pulse): tail briefing, learned and friction"
```

---

## Task 5: Tail dispatch, resolving its project from tailed rows

A dispatch row is `{"short_id","parent_session"}` — no project, no agent. Without resolution it matches no pane and vanishes. See spec §4.2 for why `session-queue.json` and `briefing-log.jsonl` were rejected.

**Files:**
- Modify: `src-tauri/src/pulse.rs` (`Log`, `LOGS`, `Row`, `Pulse::poll`)
- Test: `src-tauri/src/pulse.rs`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module:

```rust
#[test]
fn dispatch_resolves_its_project_from_a_session_seen_earlier_and_coalesces() {
    let dir = scratch("dispatch");
    // The parent session becomes known through any row carrying session_id + project.
    // In these fixtures that is the briefing row for `e7fb983c`; the reflex rows name
    // three other sessions, and must not lend their project to a dispatch.
    append(&dir.join(Log::Briefing.file()), &fixture("briefing-log.jsonl"));
    let mut pulse = Pulse::new(&dir);
    assert!(pulse.poll(7).is_empty(), "history is not replayed");

    append(&dir.join(Log::Reflex.file()), &fixture("reflex-log.jsonl"));
    append(&dir.join(Log::Briefing.file()), &fixture("briefing-log.jsonl"));
    append(&dir.join(Log::Dispatch.file()), &fixture("dispatch-parents.jsonl"));
    let events = pulse.poll(7);

    let dispatch: Vec<_> = events.iter().filter(|e| e.kind == "dispatch").collect();
    assert_eq!(dispatch.len(), 1, "two rows for one parent coalesce into one event");
    assert_eq!(dispatch[0].project, "mnemo", "resolved from the briefing row's session");
    assert_eq!(dispatch[0].agent, "mnemo", "the resolved project stands in as the agent");
    assert_eq!(dispatch[0].hits, Some(2), "it names how many children");
    let _ = std::fs::remove_dir_all(&dir);
}
```

This fixture's third row uses an unseen session, so it must be dropped — that is what makes `len() == 1` with `hits == 2` rather than two events.

**The resolver is the briefing row, not reflex.** `reflex-log.jsonl` names three sessions, none of which is the fixture's dispatch parent `e7fb983c`; `briefing-log.jsonl` names it with `project: "mnemo"`. Reflex is still appended so the test proves unrelated sessions do not lend their project. Add a second test, `a_dispatch_for_an_unknown_session_is_dropped_not_guessed`, pinning the drop rule.

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd src-tauri && cargo test pulse::tests::dispatch_resolves`
Expected: FAIL to compile — `Log::Dispatch` does not exist.

- [ ] **Step 3: Implement the log, the map and the coalescing**

Add to the `Log` enum and `LOGS`:

```rust
    /// `dispatch-parents.jsonl`: one row per child a dispatch spawned.
    Dispatch,
```
```rust
pub const LOGS: [Log; 8] = [Log::Reflex, Log::Access, Log::Enrich, Log::Denial, Log::Briefing, Log::Learned, Log::Friction, Log::Dispatch];
```
```rust
            Log::Dispatch => ".mnemo/dispatch-parents.jsonl",
```

Add to `Row`:

```rust
    parent_session: Option<String>,
```

`parse_line` emits dispatch with the parent session parked in `session_id`; `poll` resolves and coalesces. Add the arm:

```rust
        // The row names no project; `Pulse::poll` resolves it from a session seen earlier.
        Log::Dispatch => Some(PulseEvent { kind: "dispatch", session_id: row.parent_session.clone(), hits: Some(1), ..base }),
```

Give `Pulse` the map:

```rust
pub struct Pulse {
    tails: Vec<(Log, Tail)>,
    /// `session_id` → project, learned from any tailed row carrying both. `dispatch` rows
    /// name only their parent session, and a row for an unknown session is dropped rather
    /// than shown over an unrelated pane.
    seen: std::collections::HashMap<String, String>,
}

impl Pulse {
    pub fn new(root: &Path) -> Pulse {
        Pulse { tails: LOGS.iter().map(|&l| (l, Tail::at_end(root.join(l.file())))).collect(), seen: std::collections::HashMap::new() }
    }

    /// The events written since the last poll, log by log in file order.
    pub fn poll(&mut self, now: u64) -> Vec<PulseEvent> {
        let raw: Vec<PulseEvent> = self
            .tails
            .iter_mut()
            .flat_map(|(log, tail)| tail.read().into_iter().filter_map(|l| parse_line(*log, &l, now)).collect::<Vec<_>>())
            .collect();

        let mut out: Vec<PulseEvent> = Vec::with_capacity(raw.len());
        for event in raw {
            if event.kind == "dispatch" {
                // One dispatch spawns several children in one burst: one scene, N children.
                let Some(project) = event.session_id.as_ref().and_then(|s| self.seen.get(s)).cloned() else { continue };
                match out.iter_mut().find(|e| e.kind == "dispatch" && e.project == project) {
                    Some(prior) => prior.hits = Some(prior.hits.unwrap_or(0) + 1),
                    None => out.push(PulseEvent { project: project.clone(), agent: project, ..event }),
                }
                continue;
            }
            if let (Some(session), false) = (event.session_id.as_ref(), event.project.is_empty()) {
                self.seen.insert(session.clone(), event.project.clone());
            }
            out.push(event);
        }
        out
    }
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `cd src-tauri && cargo test pulse`
Expected: PASS, all tests in the module.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pulse.rs
git commit -m "feat(pulse): tail dispatch, resolving its project from a session seen earlier"
```

---

## Task 6: The scene table

One table drives everything: the caption, the colour, the pixels and the animation class. Typing it as a `Record` over the kind union makes a missing scene a **build** error, not a runtime blank.

**Files:**
- Create: `src/avatar/scenes.ts`
- Test: `src/avatar/scenes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/avatar/scenes.test.ts`:

```ts
import { SCENES, STATE_SCENES, caption, withPartIndex } from './scenes'
import type { PulseEvent } from '../pulse/types'

const ev = (over: Partial<PulseEvent>): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo', agent: 'mnemo', slugs: [], ...over })

test('every kind and every child state has a scene', () => {
  expect(Object.keys(SCENES).sort()).toEqual(
    ['briefing', 'catchup', 'dispatch', 'enforce', 'enrich', 'friction', 'learned', 'reflex', 'tool'].sort(),
  )
  expect(Object.keys(STATE_SCENES).sort()).toEqual(['active', 'BLOCKED', 'done', 'stalled', 'stopped'].sort())
})

test('every scene draws at least one pixel and names a keyframe class', () => {
  for (const [name, scene] of Object.entries({ ...SCENES, ...STATE_SCENES })) {
    expect(scene.rects.length, `${name} has pixels`).toBeGreaterThan(0)
    expect(scene.className, `${name} names a class`).toMatch(/^av-/)
  }
})

test('captions count what the event carries, and stay singular at one', () => {
  expect(caption(ev({ kind: 'reflex', hits: 2 }))).toBe('injecting 2 rules')
  expect(caption(ev({ kind: 'reflex', hits: 1 }))).toBe('injecting 1 rule')
  expect(caption(ev({ kind: 'dispatch', hits: 3 }))).toBe('dispatching 3 children')
  expect(caption(ev({ kind: 'dispatch', hits: 1 }))).toBe('dispatching 1 child')
})

test('captions without a count ignore hits entirely', () => {
  expect(caption(ev({ kind: 'learned', hits: 1 }))).toBe('learned something')
  expect(caption(ev({ kind: 'blocked' as 'enforce', hits: 9 }))).not.toContain('9')
})

test('a missing count falls back to a phrase that still reads', () => {
  expect(caption(ev({ kind: 'reflex', hits: undefined }))).toBe('injecting rules')
  expect(caption(ev({ kind: 'dispatch', hits: undefined }))).toBe('dispatching children')
})

test('parts are numbered within their own part, not by position in the list', () => {
  // dispatch lists its three children *after* body and arms; they must still be 0,1,2
  // so the CSS stagger reaches them. Numbering by list position would make them 11,12,13.
  const kids = withPartIndex(SCENES.dispatch.rects).filter(([rect]) => rect.part === 'object')
  expect(kids.map(([, n]) => n)).toEqual([0, 1, 2])

  // reflex lists its pages *first* — same numbers, different position.
  const pages = withPartIndex(SCENES.reflex.rects).filter(([rect]) => rect.part === 'object')
  expect(pages.map(([, n]) => n)).toEqual([0, 1, 2])
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/avatar/scenes.test.ts`
Expected: FAIL — `Cannot find module './scenes'`.

- [ ] **Step 3: Write the scene table**

Create `src/avatar/scenes.ts`:

```ts
/** The mnemo octopus, one scene per thing mnemo does and per state a child is in.
 *
 *  Pixels, not paths: `src/brand/mark.svg` is 65 vectoriser paths with no groups and no
 *  ids, so no limb is addressable and a new pose would need path morphing. On a grid an
 *  arm *is* a run of addressable rects, and a new pose is moving cells. The mark stays the
 *  logo (`src/brand/Wordmark.tsx`); this is the character. */
import type { PulseEvent, PulseKind } from '../pulse/types'
import type { childWord } from '../mission/types'

/** One pixel: x, y, width, height on a 32×32 grid, and which part it belongs to.
 *  The part decides its colour and which keyframe moves it. */
export type Rect = { x: number; y: number; w: number; h: number; part: Part }

export type Part = 'head' | 'eye' | 'arm' | 'node' | 'object'

export type Scene = {
  /** The CSS class carrying this scene's keyframes, defined in `avatar.css`. */
  className: string
  /** Theme token for the body. The object's own colour is baked into `avatar.css`. */
  tone: 'accent' | 'green' | 'yellow' | 'red' | 'muted'
  rects: Rect[]
  /** Shortest gap between two overlays of this kind, in ms. `0` means every event plays.
   *  The rate of `tool` is unknown until real use (spec §9.1); this is the dial, left at
   *  zero so the first run measures the unthrottled truth. */
  minIntervalMs?: number
}

const r = (x: number, y: number, w: number, h: number, part: Part): Rect => ({ x, y, w, h, part })

/** Head, eyes and the node ring: every scene shares them, so a scene lists only what it adds. */
const BODY: Rect[] = [
  r(12, 6, 8, 2, 'head'),
  r(10, 8, 12, 2, 'head'),
  r(9, 10, 14, 4, 'head'),
  r(10, 14, 12, 2, 'head'),
  r(12, 10, 2, 2, 'eye'),
  r(18, 10, 2, 2, 'eye'),
]

/** Five arms hanging from the head, longest in the middle. */
const ARMS: Rect[] = [
  r(9, 16, 2, 7, 'arm'),
  r(12, 16, 2, 9, 'arm'),
  r(15, 16, 2, 10, 'arm'),
  r(18, 16, 2, 9, 'arm'),
  r(21, 16, 2, 7, 'arm'),
]

/** The radial-neural ring the mark is built on. */
const RING: Rect[] = [
  r(7, 7, 2, 2, 'node'),
  r(23, 7, 2, 2, 'node'),
  r(5, 12, 2, 2, 'node'),
  r(25, 12, 2, 2, 'node'),
  r(15, 3, 2, 2, 'node'),
  r(8, 17, 2, 2, 'node'),
]

const pages: Rect[] = [r(14, 17, 5, 4, 'object'), r(14, 17, 5, 4, 'object'), r(14, 17, 5, 4, 'object')]
const scroll: Rect[] = [r(11, 16, 10, 7, 'object'), r(13, 18, 6, 1, 'object'), r(13, 20, 5, 1, 'object')]
const sign: Rect[] = [r(10, 17, 12, 9, 'object'), r(12, 20, 8, 2, 'object')]
const kids: Rect[] = [r(14, 19, 4, 4, 'object'), r(14, 19, 4, 4, 'object'), r(14, 19, 4, 4, 'object')]
const hook: Rect[] = [r(16, 18, 2, 5, 'object'), r(13, 22, 4, 2, 'object')]
const newNode: Rect[] = [r(15, 2, 2, 2, 'object')]

/** What mnemo is doing. The object carries the meaning; the movement carries the life —
 *  gesture alone was tested and the nine could not be told apart. */
export const SCENES: Record<PulseKind, Scene> = {
  reflex: { className: 'av-injecting', tone: 'accent', rects: [...pages, ...BODY, ...ARMS] },
  tool: { className: 'av-reading', tone: 'accent', rects: [...RING, ...BODY, ...ARMS] },
  enrich: { className: 'av-remembering', tone: 'accent', rects: [...BODY, ...scroll, ...ARMS] },
  enforce: { className: 'av-blocked', tone: 'red', rects: [...BODY, ...ARMS, ...sign] },
  briefing: { className: 'av-saving', tone: 'accent', rects: [...BODY, ...scroll, ...ARMS] },
  catchup: { className: 'av-catchup', tone: 'accent', rects: [...BODY, ...scroll, ...ARMS] },
  learned: { className: 'av-learned', tone: 'green', rects: [...RING, ...newNode, ...BODY, ...ARMS] },
  friction: { className: 'av-friction', tone: 'yellow', rects: [...BODY, ...ARMS, ...hook] },
  dispatch: { className: 'av-dispatching', tone: 'accent', rects: [...BODY, ...ARMS, ...kids] },
}

/** What a dispatched child is doing. Derived from `childWord` rather than restated, so a
 *  new child state makes `STATE_SCENES` a build error instead of a silently missing scene. */
export type ChildWord = ReturnType<typeof childWord>

export const STATE_SCENES: Record<ChildWord, Scene> = {
  active: { className: 'av-active', tone: 'accent', rects: [...BODY, ...ARMS] },
  BLOCKED: { className: 'av-blocked-state', tone: 'yellow', rects: [...BODY, ...ARMS] },
  stalled: { className: 'av-stalled', tone: 'muted', rects: [...BODY, ...ARMS] },
  done: { className: 'av-done', tone: 'green', rects: [...BODY, ...ARMS] },
  stopped: { className: 'av-stopped', tone: 'muted', rects: [...BODY, ...ARMS] },
}

/** Captions that count, as (singular, plural) around the number. */
const COUNTED: Partial<Record<PulseKind, [string, string, string]>> = {
  reflex: ['injecting', 'rule', 'rules'],
  dispatch: ['dispatching', 'child', 'children'],
}

const PLAIN: Record<PulseKind, string> = {
  reflex: 'injecting rules',
  tool: 'reading memory',
  enrich: 'remembering before the edit',
  enforce: 'blocked that command',
  briefing: 'saving the briefing',
  catchup: 'catching you up',
  learned: 'learned something',
  friction: 'noted the friction',
  dispatch: 'dispatching children',
}

/** Pairs each rect with its index *within its own part*, so `avatar.css` can address
 *  "the third arm" as `.av-arm-2` regardless of where the arms sit in the list. Numbering
 *  by position in the whole list would silently break every stagger the moment a scene
 *  put its object before the body instead of after it. */
export function withPartIndex(rects: Rect[]): [Rect, number][] {
  const seen: Partial<Record<Part, number>> = {}
  return rects.map((rect) => {
    const n = seen[rect.part] ?? 0
    seen[rect.part] = n + 1
    return [rect, n]
  })
}

/** The line under the octopus. Present tense, lowercase, one line. */
export function caption(event: PulseEvent): string {
  const counted = COUNTED[event.kind]
  if (counted && event.hits !== undefined) {
    const [verb, one, many] = counted
    return `${verb} ${event.hits} ${event.hits === 1 ? one : many}`
  }
  return PLAIN[event.kind] ?? ''
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `pnpm vitest run src/avatar/scenes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/avatar/scenes.ts src/avatar/scenes.test.ts
git commit -m "feat(avatar): the scene table, one per kind and per child state"
```

---

## Task 7: The `Avatar` component

**Files:**
- Create: `src/avatar/Avatar.tsx`
- Test: `src/avatar/Avatar.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/avatar/Avatar.test.tsx`:

```tsx
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import Avatar from './Avatar'
import { SCENES } from './scenes'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const render = async (ui: React.ReactElement) => {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(ui))
  return { host, root }
}

test('an action scene draws its pixels and carries its keyframe class', async () => {
  const { host } = await render(<Avatar scene="reflex" size={88} />)
  const svg = host.querySelector('svg')!
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 32')
  expect(svg.getAttribute('width')).toBe('88')
  expect(host.querySelector('.av-injecting')).not.toBeNull()
  expect(svg.querySelectorAll('rect')).toHaveLength(SCENES.reflex.rects.length)
})

test('a child state scene renders from the state table', async () => {
  const { host } = await render(<Avatar state="BLOCKED" size={30} />)
  expect(host.querySelector('.av-blocked-state')).not.toBeNull()
  expect(host.querySelector('svg')!.getAttribute('width')).toBe('30')
})

test('it is decorative: the caption beside it carries the meaning', async () => {
  const { host } = await render(<Avatar scene="reflex" size={88} />)
  expect(host.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/avatar/Avatar.test.tsx`
Expected: FAIL — `Cannot find module './Avatar'`.

- [ ] **Step 3: Write the component**

Create `src/avatar/Avatar.tsx`:

```tsx
/** The mnemo octopus playing one scene. Pass `scene` for a thing mnemo did, or `state` for
 *  what a dispatched child is doing. Decorative by design: the caption beside it is what a
 *  screen reader announces. */
import { SCENES, STATE_SCENES, withPartIndex, type ChildWord, type Scene } from './scenes'
import type { PulseKind } from '../pulse/types'
import './avatar.css'

type Props = { size: number } & ({ scene: PulseKind; state?: never } | { state: ChildWord; scene?: never })

export default function Avatar({ size, scene, state }: Props) {
  const s: Scene = scene ? SCENES[scene] : STATE_SCENES[state as ChildWord]
  return (
    <svg
      className={`av av-${s.tone} ${s.className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {withPartIndex(s.rects).map(([rect, n], i) => (
        <rect key={i} className={`av-${rect.part} av-${rect.part}-${n}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      ))}
    </svg>
  )
}
```

- [ ] **Step 4: Write the stylesheet**

Create `src/avatar/avatar.css`. Colours are theme tokens, never literals — `mark.svg` hardcodes 50 `rgb()` values and cannot be themed, which is the mistake being avoided here.

```css
/* The octopus. One block per scene; every colour is a theme token. */
.av { display: block; }
.av .av-head { fill: var(--accent); }
.av .av-eye { fill: var(--bg); }
.av .av-arm { fill: color-mix(in srgb, var(--accent) 60%, var(--bg)); }
.av .av-node { fill: var(--accent); }
.av .av-object { fill: var(--fg); }

.av-green .av-head, .av-green .av-node { fill: var(--ansi-green); }
.av-green .av-arm { fill: color-mix(in srgb, var(--ansi-green) 60%, var(--bg)); }
.av-yellow .av-head, .av-yellow .av-node { fill: var(--ansi-yellow); }
.av-yellow .av-arm { fill: color-mix(in srgb, var(--ansi-yellow) 60%, var(--bg)); }
.av-red .av-head, .av-red .av-node { fill: var(--ansi-red); }
.av-red .av-arm { fill: color-mix(in srgb, var(--ansi-red) 60%, var(--bg)); }
.av-muted .av-head, .av-muted .av-node { fill: var(--fg-muted); }
.av-muted .av-arm { fill: color-mix(in srgb, var(--fg-muted) 60%, var(--bg)); }

/* Shared: the head breathes in every action scene. */
@keyframes av-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .84; } }

/* reflex — pages descend into the pane, staggered. */
@keyframes av-page-in { 0% { transform: translateY(-9px); opacity: 0; } 25% { opacity: 1; } 75% { transform: translateY(7px); opacity: 1; } 100% { transform: translateY(10px); opacity: 0; } }
.av-injecting .av-head { animation: av-breathe 1.8s ease-in-out infinite; }
.av-injecting .av-object { fill: var(--fg); animation: av-page-in 1.6s ease-in infinite; }
.av-injecting .av-object-1 { animation-delay: .45s; }
.av-injecting .av-object-2 { animation-delay: .9s; }
/* `av-object-N` is the Nth object *of this scene* — see `withPartIndex` in scenes.ts. */

/* tool — an arm probes, the ring lights in sequence. */
@keyframes av-node-on { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.av-reading .av-node { animation: av-node-on 1.5s ease-in-out infinite; }
.av-reading .av-node-1 { animation-delay: .19s; }
.av-reading .av-node-2 { animation-delay: .38s; }
.av-reading .av-node-3 { animation-delay: .57s; }
.av-reading .av-node-4 { animation-delay: .76s; }
.av-reading .av-node-5 { animation-delay: .95s; }
/* The ring lights clockwise; the sequence is the point, not which pixel starts it. */

/* enrich — an arm holds the scroll open, steady. */
@keyframes av-hold { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
.av-remembering .av-object { fill: var(--ansi-yellow); animation: av-hold 2.2s ease-in-out infinite; }

/* enforce — the sign slams in, the body shakes. */
@keyframes av-slam { 0% { transform: scale(2.4); opacity: 0; } 14% { transform: scale(1); opacity: 1; } 76% { opacity: 1; } 100% { opacity: 0; } }
@keyframes av-tremor { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }
.av-blocked .av-object { fill: var(--ansi-red); transform-box: fill-box; transform-origin: center; animation: av-slam 1.7s ease-out infinite; }
.av-blocked .av-head, .av-blocked .av-arm { animation: av-tremor .42s ease-in-out infinite; }

/* briefing — the scroll rolls up and tucks away. */
@keyframes av-tuck { 0%, 18% { transform: translateY(0) scaleY(1); opacity: 1; } 62% { transform: translateY(5px) scaleY(.28); opacity: 1; } 84%, 100% { transform: translateY(7px) scaleY(0); opacity: 0; } }
.av-saving .av-object { fill: var(--ansi-yellow); transform-box: fill-box; transform-origin: 50% 100%; animation: av-tuck 2.1s ease-in-out infinite; }

/* catchup — the scroll unrolls and opens. */
@keyframes av-unroll { 0% { transform: scaleY(0); opacity: 0; } 30% { transform: scaleY(1); opacity: 1; } 100% { transform: scaleY(1); opacity: 1; } }
.av-catchup .av-object { fill: var(--ansi-yellow); transform-box: fill-box; transform-origin: 50% 100%; animation: av-unroll 1.6s ease-out infinite; }

/* learned — a new node pops into the ring, which turns slowly. */
@keyframes av-pop { 0%, 55% { opacity: 0; transform: scale(.3); } 68% { opacity: 1; transform: scale(1.7); } 80%, 100% { opacity: 1; transform: scale(1); } }
.av-learned .av-object { fill: var(--ansi-green); transform-box: fill-box; transform-origin: center; animation: av-pop 2.1s ease-out infinite; }

/* friction — an arm snags and pulls. */
@keyframes av-snag { 0%, 100% { transform: translateY(0) rotate(0); } 40% { transform: translateY(3px) rotate(-12deg); } }
.av-friction .av-object { fill: var(--ansi-yellow); transform-box: fill-box; transform-origin: 50% 0; animation: av-snag 1.4s ease-in-out infinite; }

/* dispatch — three little ones fly out in a fan. */
@keyframes av-kid-out { 0% { transform: translate(0, 0) scale(.35); opacity: 0; } 22% { opacity: 1; transform: scale(1); } 100% { transform: translate(var(--av-kx), var(--av-ky)) scale(1); opacity: 0; } }
.av-dispatching .av-object { fill: var(--accent); transform-box: fill-box; transform-origin: center; animation: av-kid-out 1.9s ease-out infinite; }
.av-dispatching .av-object-0 { --av-kx: -11px; --av-ky: 7px; }
.av-dispatching .av-object-1 { --av-kx: 0px; --av-ky: 11px; animation-delay: .3s; }
.av-dispatching .av-object-2 { --av-kx: 11px; --av-ky: 7px; animation-delay: .6s; }
/* The children are listed last in this scene but still number 0,1,2 — that is exactly
   what `withPartIndex` buys, and `scenes.test.ts` pins it. */

/* --- child states: these loop forever on the cockpit, so they stay small and slow.
       BLOCKED is the only one asking for action and the only one allowed to be quick. --- */
@keyframes av-row { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-2px); } }
.av-active .av-arm { animation: av-row 1.1s ease-in-out infinite; }
.av-active .av-arm-1 { animation-delay: .14s; }
.av-active .av-arm-2 { animation-delay: .28s; }
.av-active .av-arm-3 { animation-delay: .42s; }
.av-active .av-arm-4 { animation-delay: .56s; }

@keyframes av-wave { 0%, 100% { transform: translateY(0) rotate(0); } 25% { transform: translateY(-3px) rotate(-9deg); } 75% { transform: translateY(-3px) rotate(9deg); } }
.av-blocked-state .av-arm { transform-box: fill-box; transform-origin: 50% 100%; animation: av-wave .62s ease-in-out infinite; }

@keyframes av-sink { 0%, 100% { transform: translateY(0); opacity: .75; } 50% { transform: translateY(3px); opacity: .42; } }
.av-stalled { animation: av-sink 3.4s ease-in-out infinite; }

@keyframes av-settle { 0%, 100% { transform: translateY(0); opacity: 1; } 50% { transform: translateY(-1px); opacity: .92; } }
.av-done { animation: av-settle 4s ease-in-out infinite; }

.av-stopped { filter: grayscale(1); opacity: .5; animation: av-settle 5s ease-in-out infinite; }

/* The overlay covers the centre of the user's work; motion here is never mandatory. */
@media (prefers-reduced-motion: reduce) {
  .av, .av * { animation: none !important; }
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `pnpm vitest run src/avatar/Avatar.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/avatar/Avatar.tsx src/avatar/avatar.css src/avatar/Avatar.test.tsx
git commit -m "feat(avatar): the octopus renders a scene as addressable pixels"
```

---

## Task 8: See it before wiring it

The scenes are the one part of this work that tests cannot judge. `reading` and `remembering` are adjacent concepts drawn with adjacent objects (spec §6) and must be looked at.

**Files:**
- Create: `src/avatar/gallery.html` (dev-only, not imported by the app)

- [ ] **Step 1: Write a gallery page**

Create `src/avatar/gallery.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>mnemo avatar — every scene</title>
<style>
  body { background: #0d1117; color: #c9d1d9; font: 12px ui-monospace, Menlo, monospace; display: flex; flex-wrap: wrap; gap: 26px; padding: 26px; }
  figure { margin: 0; text-align: center; width: 150px; }
  figcaption { margin-top: 8px; color: #d2a8ff; }
</style>
<div id="root"></div>
<script type="module">
  import { SCENES, STATE_SCENES, caption } from './scenes.ts'
  const root = document.getElementById('root')
  const draw = (scene, label) => {
    const rects = scene.rects
      .map((r, i) => `<rect class="av-${r.part} av-${r.part}-${i}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`)
      .join('')
    root.insertAdjacentHTML(
      'beforeend',
      `<figure><svg class="av av-${scene.tone} ${scene.className}" width="120" height="120" viewBox="0 0 32 32" shape-rendering="crispEdges">${rects}</svg><figcaption>${label}</figcaption></figure>`,
    )
  }
  for (const [kind, scene] of Object.entries(SCENES)) draw(scene, caption({ kind, hits: 2, at: 0, project: '', agent: '', slugs: [] }))
  for (const [state, scene] of Object.entries(STATE_SCENES)) draw(scene, state)
</script>
<link rel="stylesheet" href="./avatar.css">
```

- [ ] **Step 2: Look at all fourteen scenes**

Run: `pnpm dev`
Open: `http://localhost:1420/src/avatar/gallery.html`

Check, with the captions covered:
1. Can `reading` be told from `remembering`? If not, give `remembering` a distinct object (a pinned note) and redraw.
2. Is `BLOCKED` the thing your eye goes to among the five states?
3. Do any two action scenes read as the same event?

Adjust `scenes.ts` and `avatar.css` until the answers are yes, no, yes. **This step is done when a person has looked**, not when it renders.

- [ ] **Step 3: Commit the gallery and any redraws**

```bash
git add src/avatar/
git commit -m "test(avatar): a gallery page for judging the scenes by eye"
```

---

## Task 9: The overlay

**Files:**
- Create: `src/pulse/Overlay.tsx`
- Create: `src/pulse/overlay.css`
- Test: `src/pulse/overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/pulse/overlay.test.tsx`:

```tsx
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import Overlay, { OVERLAY_MS } from './Overlay'
import { createPulseStore } from './store'
import { SCENES } from '../avatar/scenes'
import type { PulseEvent } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: 1, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: [], ...over })

afterEach(() => vi.useRealTimers())

test('an event from the pane repo plays, and clears itself after OVERLAY_MS', async () => {
  vi.useFakeTimers()
  const store = createPulseStore()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay place="mnemo-desktop" store={store} />))
  expect(host.querySelector('.pv-overlay')).toBeNull()

  await act(async () => store.getState().push(ev({ hits: 2 })))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('injecting 2 rules')
  expect(host.querySelector('.av-injecting')).not.toBeNull()

  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - 10))
  expect(host.querySelector('.pv-overlay')).not.toBeNull()
  await act(async () => vi.advanceTimersByTime(20))
  expect(host.querySelector('.pv-overlay')).toBeNull()
  act(() => root.unmount())
})

test('an event from another repo never appears', async () => {
  const store = createPulseStore()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay place="mnemo-desktop" store={store} />))
  await act(async () => store.getState().push(ev({ project: 'clubinho', agent: 'clubinho' })))
  expect(host.querySelector('.pv-overlay')).toBeNull()
  act(() => root.unmount())
})

test('a second event replaces the first rather than stacking', async () => {
  vi.useFakeTimers()
  const store = createPulseStore()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay place="mnemo-desktop" store={store} />))

  await act(async () => store.getState().push(ev({ kind: 'reflex', hits: 1 })))
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS / 2))
  await act(async () => store.getState().push(ev({ kind: 'learned' })))

  expect(host.querySelectorAll('.pv-overlay')).toHaveLength(1)
  expect(host.querySelector('.pv-caption')?.textContent).toBe('learned something')
  // The replacement gets a full turn, not the remainder of the first.
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS - 10))
  expect(host.querySelector('.pv-overlay')).not.toBeNull()
  act(() => root.unmount())
})

test('a kind with minIntervalMs skips events inside its gap, and plays again after it', async () => {
  vi.useFakeTimers()
  const store = createPulseStore()
  const host = document.createElement('div')
  const root = createRoot(host)
  // The dial ships at 0 for every kind; this proves it works when turned up.
  const shipped = SCENES.tool.minIntervalMs
  SCENES.tool.minIntervalMs = 10_000
  await act(async () => root.render(<Overlay place="mnemo-desktop" store={store} />))

  await act(async () => store.getState().push(ev({ kind: 'tool' })))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('reading memory')
  await act(async () => vi.advanceTimersByTime(OVERLAY_MS + 10))

  await act(async () => store.getState().push(ev({ kind: 'tool' })))
  expect(host.querySelector('.pv-overlay'), 'inside the gap, it is skipped').toBeNull()

  // A different kind is unaffected by tool's gap.
  await act(async () => store.getState().push(ev({ kind: 'learned' })))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('learned something')
  SCENES.tool.minIntervalMs = shipped
  act(() => root.unmount())
})

test('a pane with no repo shows nothing', async () => {
  const store = createPulseStore()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay place={undefined} store={store} />))
  await act(async () => store.getState().push(ev()))
  expect(host.querySelector('.pv-overlay')).toBeNull()
  act(() => root.unmount())
})

test('it announces politely and never eats a click meant for the terminal', async () => {
  const store = createPulseStore()
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<Overlay place="mnemo-desktop" store={store} />))
  await act(async () => store.getState().push(ev()))
  const el = host.querySelector('.pv-overlay')!
  expect(el.getAttribute('aria-live')).toBe('polite')
  expect(el.getAttribute('role')).toBe('status')
  act(() => root.unmount())
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/pulse/overlay.test.tsx`
Expected: FAIL — `Cannot find module './Overlay'`.

- [ ] **Step 3: Write the component**

Create `src/pulse/Overlay.tsx`:

```tsx
/** mnemo acting, over the pane whose session caused it. One scene at a time: an event
 *  arriving mid-play *replaces* what is showing, because a queue would make the overlay
 *  lag behind what mnemo is actually doing, and a stale scene is worse than a skipped one. */
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { pulseStore } from './app-store'
import { pulseMatches, type Pulse, type PulseStore } from './store'
import { caption, SCENES } from '../avatar/scenes'
import type { PulseKind } from './types'
import Avatar from '../avatar/Avatar'
import './overlay.css'

/** How long one scene is on screen, in + hold + out. */
export const OVERLAY_MS = 1500

export default function Overlay({ place, store = pulseStore }: { place: string | undefined; store?: PulseStore }) {
  const latest = useStore(store, (s) => (place ? s.latestFor(place) : undefined))
  const [live, setLive] = useState<Pulse>()

  /** When a kind sets `minIntervalMs`, the last time it played here. */
  const played = useRef<Partial<Record<PulseKind, number>>>({})

  useEffect(() => {
    if (!latest || !pulseMatches(latest.event, place)) return
    const gap = SCENES[latest.event.kind].minIntervalMs ?? 0
    const last = played.current[latest.event.kind] ?? 0
    if (gap > 0 && latest.received - last < gap) return
    played.current[latest.event.kind] = latest.received
    setLive(latest)
    const timer = setTimeout(() => setLive(undefined), OVERLAY_MS)
    return () => clearTimeout(timer)
  }, [latest, place])

  if (!live) return null
  return (
    <div className="pv-overlay" role="status" aria-live="polite">
      <div className="pv-halo">
        <Avatar scene={live.event.kind} size={88} />
      </div>
      <div className="pv-caption">{caption(live.event)}</div>
    </div>
  )
}
```

- [ ] **Step 4: Write the stylesheet**

Create `src/pulse/overlay.css`:

```css
/* Over the pane, never in its way: no dimming, no panel, no pointer events. */
.pv-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  pointer-events: none;
  animation: pv-in 180ms ease-out;
}
.pv-halo { filter: drop-shadow(0 0 22px color-mix(in srgb, var(--accent) 45%, transparent)); }
.pv-caption { color: var(--accent); font-size: 12px; text-align: center; text-shadow: 0 1px 4px var(--bg); }

@keyframes pv-in { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .pv-overlay { animation: none; }
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `pnpm vitest run src/pulse/overlay.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/pulse/Overlay.tsx src/pulse/overlay.css src/pulse/overlay.test.tsx
git commit -m "feat(pulse): an overlay plays one scene over the pane that caused it"
```

---

## Task 10: Mount the overlay in the pane

**Files:**
- Modify: `src/chrome/PaneBar.tsx`
- Test: `src/chrome/pane-bar-pulse.test.tsx`

The pane bar already computes `info.place` and already receives every pulse. The overlay mounts beside the bar, positioned against the pane.

- [ ] **Step 1: Write the failing test**

Append to `src/chrome/pane-bar-pulse.test.tsx`:

```tsx
test('a pulse from the pane repo also plays the overlay scene', async () => {
  await push(ev({ kind: 'learned' }))
  expect(host.querySelector('.pv-caption')?.textContent).toBe('learned something')
})

test('a pulse from another repo plays no overlay', async () => {
  await push(ev({ project: 'clubinho', agent: 'clubinho' }))
  expect(host.querySelector('.pv-overlay')).toBeNull()
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run src/chrome/pane-bar-pulse.test.tsx`
Expected: FAIL — `.pv-caption` is null; the overlay is not mounted.

- [ ] **Step 3: Mount it**

In `src/chrome/PaneBar.tsx`, add the import beside the other pulse imports:

```tsx
import Overlay from '../pulse/Overlay'
```

Then render it as a sibling of the bar's root `<div>`, wrapping both in a fragment. The bar's root element currently opens with `<div ref={ref} className={...}>`; leave it untouched and add the overlay after its closing tag:

```tsx
  return (
    <>
      <div ref={ref} className={`pane-bar${live ? ` pane-bar-pulsing pulse-${live.event.kind}` : ''}`} onMouseDown={onMouseDown} title={info.cwd ?? 'Drag onto another pane to swap'}>
        {/* …the bar's existing children, unchanged… */}
      </div>
      <Overlay place={info.place} />
    </>
  )
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `pnpm vitest run src/chrome/pane-bar-pulse.test.tsx`
Expected: PASS, including the pre-existing flash and counter tests.

- [ ] **Step 5: Check the whole suite and the types**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/chrome/PaneBar.tsx src/chrome/pane-bar-pulse.test.tsx
git commit -m "feat(chrome): the pane plays mnemo's scene over its terminal"
```

---

## Task 11: The cockpit's five child states

**Files:**
- Modify: `src/cockpit/MissionMap.tsx:24-31`
- Modify: `src/cockpit/model.ts` (card data gains the child word)
- Modify: `src/cockpit/Cockpit.test.tsx:198`
- Test: `src/cockpit/Cockpit.test.tsx`

- [ ] **Step 1: Rewrite the assertion that this change breaks**

`src/cockpit/Cockpit.test.tsx:198` asserts `.gr-pulse` on a mission-map node. Once the map renders scenes, a BLOCKED card carries the BLOCKED scene instead. Replace that one line:

```tsx
  expect(vault.querySelector('.av-blocked-state')).not.toBeNull()
```

Its intent is unchanged: *a blocked card on the map is visibly marked*.

- [ ] **Step 2: Write the failing test**

Add to `src/cockpit/Cockpit.test.tsx`:

```tsx
test('every child card on the map wears its state as a scene', async () => {
  await render()
  await act(async () => button(rows()[0], '⤢ round3')!.click())
  const map = host.querySelector('.ck-map')!
  expect(map.querySelector('.av-blocked-state'), 'a blocked child waves').not.toBeNull()
  expect(map.querySelector('.av-active, .av-done, .av-stalled, .av-stopped'), 'the others carry theirs too').not.toBeNull()
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm vitest run src/cockpit/Cockpit.test.tsx`
Expected: FAIL — no `.av-blocked-state` in the map.

- [ ] **Step 4: Carry the child word onto the card**

In `src/cockpit/model.ts`, extend the card type and set it where a piece has a child. Find the `export type MapCard = CardData & { actions: MapAction[] }` line and replace it:

```ts
export type MapCard = CardData & { actions: MapAction[]; word?: ReturnType<typeof childWord> }
```

Then in `buildMissionMap`, inside the `if (c) {` branch, add `word` to the `add(id, {...})` call — it already computes `const word = childWord(c)` on the line above:

```ts
        tone: CHILD_TONE[word],
        pulse: word === 'BLOCKED',
        word,
        actions,
```

- [ ] **Step 5: Render it**

In `src/cockpit/MissionMap.tsx`, add the import:

```tsx
import Avatar from '../avatar/Avatar'
```

and render the avatar inside the card, after the existing `{data.badge && …}` line:

```tsx
      {data.word && (
        <span className="mm-avatar">
          <Avatar state={data.word} size={30} />
        </span>
      )}
```

- [ ] **Step 6: Position it**

Append to `src/cockpit/cockpit.css`:

```css
/* The child's state as the octopus, in the corner of its card. */
.mm-card { position: relative; }
.mm-avatar { position: absolute; right: 6px; bottom: 4px; opacity: .9; pointer-events: none; }
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `pnpm vitest run src/cockpit/Cockpit.test.tsx`
Expected: PASS, including the rewritten assertion from Step 1.

- [ ] **Step 8: Commit**

```bash
git add src/cockpit/
git commit -m "feat(cockpit): each child card wears its state as the octopus"
```

---

## Task 12: Prove it against the real vault

Every test so far runs on fixtures. The tails have never met the live logs, and the spec names two things only real use can settle.

**Files:** none — this is a verification task.

- [ ] **Step 1: Run the whole suite, both languages**

Run:
```bash
pnpm test && pnpm exec tsc --noEmit && (cd src-tauri && cargo test)
```
Expected: all green. Record the counts.

- [ ] **Step 2: Run the app against the live vault**

Run: `pnpm tauri dev`

Open a terminal pane in `~/github/mnemo` and use Claude Code normally for a few minutes.

- [ ] **Step 3: Confirm each kind that can fire, does**

Watch for each scene and tick it off:

| kind | how to provoke it |
|---|---|
| `reflex` | send a prompt matching a rule; ~6% of prompts inject |
| `tool` | ask something that calls `list_rules_by_topic` |
| `catchup` | start a new Claude Code session in the pane |
| `enrich` | edit a file covered by an enrichment rule |
| `briefing` | end a session (`/clear` or exit) |
| `learned` | run `mnemo learn` or wait for auto-brain |
| `friction` | correct the agent in a way `mnemo friction` records |
| `dispatch` | run `mnemo dispatch` on a contract |
| `enforce` | **cannot be provoked** — `denial-log.jsonl` does not exist in this vault (spec §4.5) |

- [ ] **Step 4: Settle the two open questions**

1. **Frequency** (spec §9.1): count how often `tool` fires in five minutes of normal use. If the overlay is tiring, set `minIntervalMs` for that kind — the seam exists and is off by default. Record the number either way.
2. **`dispatch` resolution** (spec §4.2): confirm the dispatch scene names the right repo. If it does not appear at all, the parent session was not yet in the map — note whether that is common.

- [ ] **Step 5: Record what was seen**

Append a `## Verified` section to the spec listing which of the nine fired, the `tool` rate, and anything that needed adjusting. Claims about what works come from having watched it, not from a green suite.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-09-16-mnemo-presence-design.md
git commit -m "docs(spec): record what the live vault showed"
```

---

## Done when

- `pnpm test`, `pnpm exec tsc --noEmit` and `cargo test` are green.
- Eight of the nine kinds have been seen firing against the live vault; `enforce` is documented as unprovokable here.
- All five child states render on the mission map, with BLOCKED still the one that catches the eye.
- The scenes have been looked at in the gallery and `reading` / `remembering` are distinguishable.

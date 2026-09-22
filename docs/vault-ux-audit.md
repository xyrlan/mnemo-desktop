# Vault UX audit — what is broken, and the navigation idiom that replaces it

Audited 2026-09-22 against `main` (`9421bd7`). Every claim below carries a
`file:line` that was read, not grepped.

## The headline

The vault opens no modals. No `position: fixed`, no backdrop, no `z-index`
above 10, no `role="dialog"`, no focus trap anywhere in `src/vault/`. So
"screens that open and cannot be closed" is not a modal problem, and no amount
of dialog plumbing fixes it.

It is one missing line. `select(path)` writes a non-null path and nothing
writes it back:

```ts
// src/vault/store.ts:150-153
async select(path) {
  set({ selected: path, page: get().page?.path === path ? get().page : null })
  await readPage(path)
},
```

The only `selected: null` in the whole directory is the initial value
(`store.ts:115`). The side panel is gated on that field:

```tsx
// src/vault/HealthTable.tsx:259 — the comment explains the open, never the close
{selected && (
  <aside className="vr-side">
    <PageView cwd={cwd} empty="Select a rule." />
    <EgoView path={selected} />
  </aside>
)}
```

Click one row in the health table and the right-hand column — the page *and*
the neighbourhood graph — is on screen for the life of the pane. The escapes
are switching to Pages mode or closing the pane. That is the whole complaint.

## Findings

Severity: **A** blocks the work, **B** costs time every session, **C** polish.

| # | Sev | Finding | Where |
|---|-----|---------|-------|
| 1 | A | `selected` is write-only to non-null; side panel has no close path | `store.ts:150`, `HealthTable.tsx:259` |
| 2 | A | Esc closes nothing. Both vault Esc handlers are local to a text input and only clear text | `view.tsx:184`, `HealthTable.tsx:194` |
| 3 | A | Opening the vault costs 3 subprocesses + a full disk walk, and paints a blank div while it runs — **measured at 4.876s, fixed to 0.214s in #146** | `store.ts:119`, `HealthTable.tsx:54` |
| 4 | B | Error `<pre>` blocks have no dismiss in 5 places | `view.tsx:191`, `view.tsx:133`, `HealthTable.tsx:65`, `PageView.tsx:97`, `EgoView.tsx:90` |
| 5 | B | Armed confirms cancel only by waiting 4 s — Esc and click-away do nothing | `useArm.ts:21` |
| 6 | B | Table rows are `<tr onClick>`: not focusable, not keyboard-activatable. ↑↓ work only with focus inside the filter input | `HealthTable.tsx:90`, `HealthTable.tsx:195` |
| 7 | B | `health` / `pages` is an invisible internal mode, not in the pane title, and the two cannot be open at once | `store.ts:21`, `view.tsx:171` |
| 8 | B | `vault_tree` is uncached: every `↻` re-reads thousands of files | `src-tauri/src/vault.rs:1285` |
| 9 | C | The ego graph reloads on every row click, sharing one column with the page | `EgoView.tsx:63`, `HealthTable.tsx:262` |
| 10 | C | Module-singleton store: two vault panes share one selection, mode and filter | `app-store.ts:8` |
| 11 | C | No keyboard shortcut reaches the vault; the three palette actions carry no `shortcut` | `view.tsx:212-214` |
| 12 | C | Show-more is one-way: rows expand, never collapse | `HealthTable.tsx:252` |

### On finding 3

`mode` defaults to `'health'` (`store.ts:119`), so opening the vault mounts the
heaviest path first. `HealthTable.tsx:150-153` fires `loadRules()` and
`loadHealth(cwd)`; `vault_health` (`vault.rs:1378`) shells out to `mnemo status`
and `mnemo doctor`, then walks every live page, then reads the fire log past its
cache; the frontend adds `mnemo stale --json` on top (`store.ts:238-241`).

While all of that runs, the tiles strip renders an empty string:

```tsx
// src/vault/HealthTable.tsx:54
{!health && <div className="vt-empty">{loading ? 'running mnemo status, doctor, stale…' : ''}</div>}
```

Before `healthLoading` flips true, `loading` is false and `health` is null — so
the user gets blank space with no sign anything is happening. `EgoView.tsx:91`
repeats the shape. Nothing blocks the UI thread (every Tauri command is
`spawn_blocking`), so this is await latency wearing no clothes, not a hang.

## The navigation idiom

One rule, applied everywhere: **anything that opens has a way out, and the way
out is always Esc.**

Esc runs a cascade — innermost open thing first:

1. disarm a pending confirm, else
2. deselect (close the side panel), else
3. clear the filter or query, else
4. let the event through (the pane keeps ⌘W).

That ordering is what makes Esc safe to press without looking: it never closes
more than the one thing you just opened. Today Esc jumps straight to step 3 and
only from inside a text box.

`src/actions/keys.ts:36-47` already ships `listKey`, which maps `escape: 'close'`
and refuses events originating in an INPUT, TEXTAREA, SELECT or contenteditable.
The cockpit inbox uses it; the vault does not. Reusing it makes the vault's
keyboard behave like the rest of the app instead of inventing a second dialect.

Second rule: **a mode you cannot see is not navigation.** `health` and `pages`
become two pane views, `vault-health` and `vault-pages`. The palette already
treats them as separate destinations (`view.tsx:212-214`) — only the code
disagrees. Separate panes get the pane title, the pane ×, ⌘W, and side-by-side
in the SplitView for free.

Third rule: **opening costs what you asked for, nothing more.** The default
lands on pages (one cacheable read). Health is a cached snapshot, shown instantly
with an "N min ago" stamp and refreshed behind you. The ego graph becomes a tab
in the side panel — **Page | Neighbourhood**, Page by default — so `vault_ego`
runs when you ask for it, not on every row click.

## Plan

### Phase 1 — navigation

| Step | Change |
|------|--------|
| 1 | `select()` accepts null; side panel gets an ×; `deselect()` on the store |
| 2 | Esc cascade via `listKey`; rows become focusable, ↑↓ and Enter work with focus on the table |
| 3 | Errors gain a dismiss in all 5 places |
| 4 | Esc disarms `useArm`; click-away disarms |
| 5 | `vault-health` and `vault-pages` split into two pane views; the `'graph'` alias (`store.ts:190-192`) migrates |
| 6 | Ego graph becomes a side-panel tab, Page default |
| 7 | Default mode → pages; health cached with an age stamp; `vault_tree` cached like rules/ego |
| 8 | Real spinners replace the `''` fallbacks at `HealthTable.tsx:54` and `EgoView.tsx:91` |

Steps 1–4 are independent of 5–7 and land first: they are the literal complaint,
and they are cheap.

### Phase 2 — one store per pane

`createVaultStore` (`store.ts:87`) is already a factory; only `app-store.ts:8`
pins it to a module singleton. Moving it behind a context gives each pane its own
selection, mode and filter while tree/rules/health caches stay shared. This is a
prerequisite for two vault panes being useful, and the most expensive item in the
list — hence phase 2, not phase 1.

## Test debt this exposes

Component coverage in `src/vault/` is 8 cases across 3 files (`view.test.tsx` 1,
`modes.test.tsx` 4, `health-table.test.tsx` 3); the other 45 cases are pure logic.
`PageView.tsx`, `EgoView.tsx`, `Markdown.tsx`, `useArm.ts` and `actions.ts` have
no test file at all. Every phase-1 step above is a behaviour a test can hold:
"Esc deselects", "the side panel closes", "opening the vault runs no subprocess".
Those tests are the deliverable, not a follow-up — a close path with no test
regresses the first time someone touches the store.

## Measured after the fact

Finding 3's wall-clock cost was not measured when this was written. It was
measured before fixing it, against this machine's vault of 5783 pages:

| command | time |
|---------|------|
| `mnemo doctor` | 4.8s |
| `mnemo status` | 0.2s |
| `mnemo stale --json` | 0.06s |

`status` and `doctor` ran in parallel, so the health screen waited 4.876s of
subprocess before its first paint, and 96% of it was `doctor` — which is read
in exactly one place, behind a button that is closed by default. #146 moved it
to its own command, run when that panel opens: 0.214s.

    time ( mnemo doctor >/dev/null & mnemo status >/dev/null; wait )   # 4.876s
    time mnemo status >/dev/null                                       # 0.214s

## What this audit does not claim

- The full-vault page walk inside `health_at` is still unmeasured. #146 only
  moved the fire log onto the shared `PAGES_TTL` cache; whether walking 5783
  pages costs a further second or a further millisecond is untested, and the
  remaining phase-1 items (default mode, a cached health snapshot) are open.
- Whether the ego graph earns its keep is untested. Making it a tab is the cheap
  experiment: if the tab goes unopened, the next step is deleting it along with
  react-flow and `src/graph/` — as `52cdecf` already did for the sigma map.

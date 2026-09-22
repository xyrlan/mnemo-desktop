---
feature: vault-navigation
created: 2026-09-22
verdict: parallel
---

Phase 1 of `docs/vault-ux-audit.md`: give every vault panel a way out, and stop
charging three subprocesses for opening the pane.

The cut is not one piece per audit finding. `src/vault/store.ts` and
`src/vault/HealthTable.tsx` are touched by nearly every finding, so a
finding-shaped cut puts three children in the same two files. The boundary that
already exists here is **the store's surface**: `close-path` widens it, and the
other pieces are written against the signatures it exposes while it is still
being built.

`close-path` is therefore the only piece that may touch `store.ts`. The pieces
that consume it own disjoint view files. `HealthTable.tsx` belongs to exactly
one piece (`side-panel`), which is why the error-dismissal work is not its own
piece — it lands in four files that four other pieces own, and would collide
with all of them.

This is **wave 1**. A fifth piece, `rows-navigable` (keyboard-reachable table
rows), also lands in `HealthTable.tsx`, which `side-panel` rewrites heavily
here. It is held back to
`2026-09-22-vault-navigation-rows.md` and dispatched once `side-panel` has
landed, so the two never edit that file at the same time.

Two further pieces deliberately left out of both waves:

- **Splitting `vault-health` / `vault-pages` into two pane views** (audit step 5)
  and **caching `vault_tree` / health** (step 7). Both rewrite `view.tsx` and
  `store.ts` wholesale. They land after this contract, against a store that has
  already grown its close paths — sequencing them here would serialise the whole
  dispatch behind them.
- **Unifying the two `useArm` implementations.** `src/vault/useArm.ts` (`press`)
  and `src/cockpit/actions.ts:44` (`fire`) are the same 4000 ms two-press logic
  with different names, and `fire` has four consumers outside the vault
  (`home/pr-pane.tsx`, `cockpit/MissionMap.tsx`, `cockpit/Cockpit.tsx`,
  `mission/Sidebar.tsx`). `disarm` below changes the vault's copy only. Merging
  them is an app-wide refactor and needs its own decision.

## close-path

The store learns to close what it opens. `selected` becomes settable to null,
and the Esc cascade gets a single decision function the views call — so the
ordering (disarm, then deselect, then clear text) lives in one tested place
rather than in three `onKeyDown` handlers.

`escapeTarget` is pure and takes the current state, so a view can ask "what
would Esc do right now?" without the store knowing which view is focused.

- **files:** src/vault/store.ts, src/vault/store.test.ts
- **exposes:** `deselect() -> void`, `escapeTarget(s: { armed: boolean; selected: string | null; filter: string; query: string }) -> 'disarm' | 'deselect' | 'clear-filter' | 'clear-query' | null`
- **effort:** medium

## side-panel

The side panel gets an × and honours Esc, and the ego graph stops loading on
every row click: the panel becomes two tabs, **Page** and **Neighbourhood**,
with Page selected by default. `EgoView` mounts only while its tab is open, so
`vault_ego` runs when asked for.

Owns `HealthTable.tsx` outright, including the `health?.error` block at line 65
and the `!health` blank-string fallback at line 54, which becomes a real
loading state.

- **files:** src/vault/HealthTable.tsx, src/vault/EgoView.tsx, src/vault/health-table.test.tsx, src/vault/vault.css
- **consumes:** `deselect() -> void` from close-path
- **effort:** high

## disarm

An armed confirm currently cancels only by waiting out `ARM_MS = 4000`. Give it
Esc and click-away, and a test that pins both.

Vault copy only — `src/cockpit/actions.ts` keeps its own `useArm` and is out of
bounds for this piece.

- **files:** src/vault/useArm.ts, src/vault/useArm.test.ts
- **exposes:** `useArm() -> { armed: string | null; press(key: string): boolean; disarm(): void }`
- **model:** sonnet
- **effort:** low

## error-dismiss

The page pane's error block (`PageView.tsx:97`) and the tree/log error blocks
(`view.tsx:133`, `view.tsx:191`) gain a dismiss affordance, and the log gains a
"clear all" beside its per-entry ×.

Owns `PageView.tsx` and `view.tsx`. `HealthTable.tsx:65` and `EgoView.tsx:90`
are the same finding in files this piece does not own — `side-panel` delivers
those two. Deliver a shared dismissible-error component here and expose it, so
`side-panel` can consume it rather than writing a second one.

- **files:** src/vault/PageView.tsx, src/vault/view.tsx, src/vault/ErrorLine.tsx, src/vault/error-line.test.tsx
- **exposes:** `ErrorLine(props: { text: string; onDismiss?: () => void }) -> JSX.Element`
- **consumes:** `deselect() -> void` from close-path
- **effort:** medium

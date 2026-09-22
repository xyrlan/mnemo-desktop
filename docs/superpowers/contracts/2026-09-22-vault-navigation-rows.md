---
feature: vault-navigation-rows
created: 2026-09-22
verdict: sequential
---

Wave 2 of `docs/vault-ux-audit.md` phase 1. One piece, so the verdict is
`sequential` by arithmetic rather than by judgement.

It is a separate file, and a separate dispatch, because it edits
`src/vault/HealthTable.tsx` — the file `side-panel` rewrites in
`2026-09-22-vault-navigation.md`. Running the two at once means two children
reworking a 268-line file in parallel and one of them rebasing onto a version
that no longer resembles what it started from.

**Dispatch this only after `side-panel` has landed on `main`.**

## rows-navigable

Health-table rows become reachable from the keyboard: focusable, activated by
Enter, moved through with ↑↓ when focus is on the table rather than only inside
the filter input. Today rows are `<tr onClick>` (`HealthTable.tsx:90`) and the
arrow keys work only with focus inside the filter box (`HealthTable.tsx:195`).

`src/actions/keys.ts:36-47` already exports `listKey`, which maps
`escape: 'close'` and refuses events originating in an INPUT, TEXTAREA, SELECT
or contenteditable. The cockpit inbox uses it. Deliver the vault's list
navigation against that helper so the app has one keyboard dialect, and extend
`listKey` only if the vault needs a key it does not already map.

Esc ordering is not this piece's to invent: `close-path` owns
`escapeTarget(state)` and this piece calls it.

- **files:** src/vault/HealthTable.tsx, src/actions/keys.ts, src/vault/rows.test.tsx
- **effort:** medium

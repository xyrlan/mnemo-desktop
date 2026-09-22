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

`side-panel` landed as `80eb344` and delivered part of this piece's ground
already: `listKey` is imported (`HealthTable.tsx:2`), the table root carries
`tabIndex={-1}` and an `onKeyDown` (`:254`, `:246`), and Esc closes the side
panel through it. What remains is the list navigation proper. This section was
rewritten against that commit — do not restore what is already there.

## rows-navigable

Health-table rows become reachable from the keyboard. Two gaps remain on
`main`:

- Rows are `<tr onClick>` (`HealthTable.tsx:113`) — not focusable, not
  activatable by Enter.
- The root's `onKeyDown` (`HealthTable.tsx:246`) acts on `listKey(e) === 'close'`
  and drops everything else, so `'up'`, `'down'` and `'open'` fall through.
  ↑↓ still work only inside the filter box (`:264`).

Deliver against `listKey` (`src/actions/keys.ts:36-47`), which already maps
↑↓/Enter/Esc and refuses events from an INPUT, TEXTAREA, SELECT or
contenteditable — so the app keeps one keyboard dialect. Extend it only if the
vault needs a key it does not map.

Moving the selection is already in the file: `move(by)` (`HealthTable.tsx:237`)
is what the filter box's arrows call (`:266`). Reuse it rather than writing a
second one.

Esc ordering is not this piece's to invent: `escapeTarget(state)` is
`close-path`'s and landed in `4314bf6`.

- **files:** src/vault/HealthTable.tsx, src/actions/keys.ts, src/vault/rows.test.tsx
- **effort:** medium

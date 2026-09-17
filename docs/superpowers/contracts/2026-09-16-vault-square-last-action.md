---
feature: vault-square-last-action
created: 2026-09-16
verdict: parallel
---

One piece from `docs/superpowers/specs/2026-09-16-vault-square-last-action-design.md`.
Read the spec first — it holds the reasoning, the scene audit that motivates the
`tool` fix, and the four weak scenes deliberately left out.

One piece, not two. The work is one module (`src/vaultlevel/`) plus a scene in
`src/avatar/`. The `tool` scene is about ten rects and one keyframe block, and it
exists *because* of the square: as a momentary overlay `tool` is survivable, but
as a persistent skin it is the most frequent pulse wearing `IDLE`'s exact rects.
Splitting it out would put two children in `scenes.ts` — the file the previous
round already flagged as the shared-file risk — to parallelise an afternoon's
drawing, and the square could not be judged on screen until the other child
landed. The verdict is `parallel` because that is what `mnemo dispatch` accepts;
with a single piece there is no sibling, so nothing the gate protects against
applies.

Wiring rules from `docs/contracts/panes.md` hold. `src/graph/`, `src/github/` and
`src/pulse/` are read-only: the overlay keeps its own voice and its own
`caption()`, and the three tests that pin that wording
(`src/pulse/overlay.test.tsx`, `src/chrome/pane-bar-pulse.test.tsx`) must stay
green untouched. `src/cockpit/VaultLevelSlot.tsx` stays agnostic about what fills
it — do not teach it about pulses.

Run `tauri dev` in the background with a private target
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-square pnpm tauri dev --port 1741`),
kill any leftover `vite` first, and look at the real app before claiming done.
`pnpm test` and `pnpm build` must both be green. No Rust changes: `vault_level()`
already returns everything the HUD needs.

## square-last-action

- **files:** src/vaultlevel/, src/avatar/scenes.ts, src/avatar/scenes.test.ts, src/avatar/avatar.css, src/avatar/gallery.html
- **exposes:** nothing
- **consumes:** nothing

Books out, the octopus wears the last action, and a trail of five dots records
what kinds of thing happened recently. Spec §"The shape" has the three sources and
the band heights; §"The caption" has the nine verbs; §"Fixing `tool`" has the
rects.

**The scene owns the colour.** A blocked command paints the octopus red even when
the vault is green. Health keeps its own channel in the HUD bar. This is the
decision the whole design turns on — if you find yourself tinting the octopus from
`toneOf(health)` anywhere except the empty-log fallback, you have rebuilt the old
square.

**Two captions, two voices.** `caption()` in `scenes.ts` writes present-tense and
personal for the overlay and is not touched. The square gets
`squareCaption(event, now)` in a new `src/vaultlevel/caption.ts`: past tense, third
person, with the target pulled from `event.tool`/`slugs`/`hits` and a second line
of `project · age`. Every target needs a fallback — all three fields are optional
on `PulseEvent`, and a caption that renders `blocked undefined` is worse than one
that renders `blocked`.

**Truncate in CSS, not JavaScript.** The available width belongs to the layout;
the square already stretches with the sidebar.

**The age recounts itself** on its own 30s interval, separate from the vault poll.
Same period today, different reasons to change.

`recentPulses` collapses consecutive repeats of one kind into a single dot with a
count. `tool` can fire many times a minute and five identical dots say less than
five distinct kinds. Take the dot colour from `SCENES[kind].tone` rather than
writing a second table, so a scene that changes tone changes its dot.

What is deleted is as much the deliverable as what is added: the shelves SVG, the
book layout, the `ResizeObserver` and its `width` state, `SHELVING`, `Morsel` and
`eating`, `away`, and the book helpers in `level.ts` (`PAGES_PER_BOOK`,
`SHELF_ROWS`, `BOOKS_PER_ROW`, `Book`, `bookCount`, `shelfBooks`, `booksPerRow`).
`square.test.tsx` is 189 lines today and much of it tests books — those tests go
with the feature. `POSES` stays: it dresses the empty-log case.

`SQUARE` goes 160 → 176 to fit the new bands. The octopus is 104px, up from 58.

`src/avatar/gallery.html` renders every scene from `SCENES`, so the new `tool`
appears there for free — open it and check that `tool` no longer reads as `IDLE`
with the captions hidden. That is the test the gallery exists for.

**Report what you saw, not what you drew.** The spec's claim is that a 104px
octopus wearing a scene is legible where a 58px one was not, and that the new
`tool` is distinguishable from rest. Both are screen judgements. Put a screenshot
of the square in the PR body — one with `tool` on it — and say plainly if a
decision did not survive contact with the real app. The four weak scenes
(`reflex`, `briefing`, `catchup`, `learned`) are out of scope; if the bigger stage
makes one of them clearly wrong, say so in the PR and leave it for a follow-up
issue rather than widening the piece.

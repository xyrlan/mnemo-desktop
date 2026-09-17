# The vault square wears its last action

**Date:** 2026-09-16
**Status:** designed, not implemented
**Supersedes the library metaphor from:** `2026-09-16-sidebar-cockpit-vault-level-design.md`

## The problem

The square at the foot of the sidebar is a library: shelves fill with books as the vault
grows, and a librarian octopus files them on a loop. Two things are wrong with it.

The books are decoration that costs the octopus its size. He is 58px in a 160px square
because the shelves need the room, and at 58px the character reads as a smudge. The
shelving loop plays whether or not anything happened.

And the square shows *state* while the octopus already knows how to show *action*.
`src/avatar/scenes.ts` carries nine scenes — one per `PulseKind` — each with its own
object, tone and keyframes. On the square, all of that is thrown away: the octopus wears a
health pose, leaves the square while an overlay plays elsewhere, and comes back to the same
pose. The richest asset in the codebase is used on a surface that ignores it.

## The shape

Books out. The octopus grows to 104px and wears the scene of the last thing mnemo did — its
object, its colour, its motion — and keeps wearing it until the next pulse. Under him, a
caption naming that action. Under that, a thin trail of the five most recent actions. The
vault's health, which used to paint the octopus, moves to the HUD that already exists.

Three sources, three surfaces, no crossing:

| Source | Surface | Carries |
| --- | --- | --- |
| `pulses.log` (last) | the octopus + caption | scene, colour, object |
| `pulses.log` (last 5) | the trail | one dot per action, colour by kind |
| `client.level()` | the HUD | level, XP bar, on-fire |

The square keeps filling the sidebar's width, as it does now, and `SQUARE` grows from 160px
to 176px to hold the new bands:

| Band | Height |
| --- | --- |
| Stage (the octopus, 104px, centred) | 113 |
| Caption (two lines) | 26 |
| Trail | 15 |
| HUD (level, bar, on-fire) | 22 |

The octopus is 104px rather than today's 58px because the size *is* the change: the scenes
carry their meaning in an object a few pixels across, and at 58px that object is a smudge.
Sixteen extra pixels at the foot of a sidebar that already scrolls is the cheaper side of
that trade.

### Who owns the colour

The scene does. A blocked command paints the octopus red even when the vault is green,
because the octopus is reporting an action, not a condition. Health keeps its own channel in
the HUD bar, where it was already displayed.

This is the decision the design turns on. The alternative — health owns the colour, the
scene only supplies shape — was rejected: `enforce` without red and `learned` without green
lose most of their signal, and the scenes were built around tone.

### At rest

With an empty log (app just opened, nothing has happened yet) there is no last action to
wear. The octopus falls back to `POSES[poseOf(tone)]` — the health pose, as today — with no
caption and an empty trail. The first pulse dresses him in a scene, and he never returns to
the health pose: the log will always have something from then on.

## The caption

`caption()` in `scenes.ts` writes for the overlay, which speaks to someone who just acted:
present tense, personal, `blocked that command`. On the square that voice breaks. "That
command" has no referent when the square reports on any session, and nothing says whether it
happened now or forty minutes ago.

The event already carries what is missing. `PulseEvent` has `project`, `agent`, `tool` (the
MCP tool, the tool an enrichment rode on, or the command enforcement blocked), `slugs`,
`hits` and `at`. The square's caption uses them:

```
blocked  git push --force
mnemo · 2m
```

A new pure module, `src/vaultlevel/caption.ts`, exports
`squareCaption(event, now): { verb: string; target?: string; where: string; age: string }`.
Third person, past tense, one verb per kind:

| kind | verb | target |
| --- | --- | --- |
| `reflex` | `injected` | `${hits} rules` |
| `tool` | `read` | first slug, else `memory` |
| `enrich` | `recalled` | `event.tool` |
| `enforce` | `blocked` | `event.tool` |
| `briefing` | `saved` | `briefing` |
| `catchup` | `caught up` | — |
| `learned` | `learned` | first slug |
| `friction` | `noted` | `friction` |
| `dispatch` | `dispatched` | `${hits} children` |

Every target has a fallback: `tool`, `slugs` and `hits` are all optional on `PulseEvent`.
With no target the caption is the verb alone. The second line is
`${event.project} · ${age}`, where age is `12s`, `4m`, `2h` or `3d`.

A long target is truncated with CSS ellipsis, not in JavaScript — the available width
belongs to the layout, not to the data.

`caption()` keeps its three overlay callers (`src/pulse/Overlay.tsx`,
`src/chrome/pane-bar-pulse.test.tsx` and `src/pulse/overlay.test.tsx` pin its wording) and is
not touched. Two surfaces, two voices, two functions.

### The clock

`2m` has to recount itself. A 30s interval drives the age alone, separate from the 30s vault
poll: same period today, different reasons to change, so they do not share a timer.

## The trail

Five dots under the octopus, oldest to newest, the current one ringed. Colour comes from
`SCENES[kind].tone` rather than a second table, so a scene that changes tone changes its dot.

Consecutive repeats of the same kind collapse to a single dot, with a small count when more
than one. `tool` can fire many times a minute; five identical purple dots say less than five
distinct kinds. The trail is a record of *what kinds of thing* happened recently, not a
tick-by-tick log.

`pulses.log` already retains 200 entries (`MAX_PULSES`), so the trail needs no new storage.

### Every pane, not the focused one

Since #97 a pulse is routed to the pane whose session caused it, and `Pulse` carries an
optional `pane`. The square is not a pane: it sits in the sidebar and reports on mnemo as a
whole, the way the sidebar already lists every child rather than the focused one. So it reads
the tail of `log` and ignores `pane` entirely.

The caption's `project` line is what disambiguates. Following the focused pane instead was
rejected: the square would flicker on every tab switch, and it would empty out whenever a
pane without a session is focused — worse than showing everything.

A new pure module, `src/vaultlevel/recent.ts`, exports
`recentPulses(log, n): { kind: PulseKind; count: number }[]` and `toneOfKind(kind)`.

## Fixing `tool`

Nine scenes were audited against the question the gallery exists for: with the caption
covered, does the gesture say which action it is? Four work (`enforce`, `enrich`, `friction`,
`dispatch`), four are weak (`reflex`, `briefing`, `catchup`, `learned`), and one fails.

The ones that work have an asymmetric silhouette or an object off the centre line. The weak
ones stack a centred block above the head — the same rectangle in every case, distinguished
only by animation, which vanishes at 58px.

`tool` fails outright: it is the only action scene with no object at all. Its rects are
`RING + BODY + ARMS`, which is exactly `IDLE`. Only the animation differs. That is survivable
on an overlay that plays for a moment; as a persistent skin it is fatal, because `tool` is
the most frequent pulse and would be the square's de facto resting state — indistinguishable
from having done nothing.

So `tool` gets an object: an arm reaching up to the ring and pulling a thread of three nodes
down into the head.

```
arm:    r(21, 16, 2, 5)   the reaching arm
        r(23, 14, 2, 3)   rising toward the ring
object: r(25, 11, 2, 2)   node 1
        r(24,  9, 2, 2)   node 2   a thread, drawn diagonally
        r(22,  7, 2, 2)   node 3
```

Asymmetric, right of centre, clear of the arm band — the pattern the working scenes share. The
nodes travel down the thread into the head in stagger, the way `av-page-in` staggers, but on
the diagonal. The ring stops blinking all round: only the two nodes nearest the arm light,
which says where the thread came from.

`friction` also occupies the right side (`hook` at x=21..28). The two never render at once,
and in the trail they are separated by colour (`tool` accent, `friction` yellow).

The other four weak scenes are out of scope. They are independent visual decisions that each
want their own iteration, and they are better judged against the new square once it exists.

## What is removed

From `src/vaultlevel/Square.tsx`: the shelves SVG, the book layout, the `ResizeObserver` and
the `width` state (the octopus is a fixed 104px and the trail is flex, so nothing needs
measuring), `SHELVING` and its loop, `Morsel` and the `eating` state, and `away` — the
octopus no longer leaves the square while an overlay plays elsewhere. The file goes from 238
lines to roughly 150.

From `src/vaultlevel/level.ts`: `PAGES_PER_BOOK`, `SHELF_ROWS`, `BOOKS_PER_ROW`, `Book`,
`bookCount`, `shelfBooks`, `booksPerRow`. What stays is XP, level, health, tone, pose and
`onFire`.

From `src/avatar/scenes.ts`: `SHELVING`. `POSES` stays — it dresses the empty-log case.

From `src/vaultlevel/vaultlevel.css`: the shelf, book, slotting and morsel rules.

## Files

**New**

- `src/vaultlevel/recent.ts` — `recentPulses`, `toneOfKind`. Pure.
- `src/vaultlevel/caption.ts` — `squareCaption`. Pure.
- `src/vaultlevel/recent.test.ts`, `src/vaultlevel/caption.test.ts`

**Changed**

- `src/vaultlevel/Square.tsx` — books out, trail and caption in, `SQUARE` 160 → 176
- `src/vaultlevel/level.ts` — book helpers out
- `src/vaultlevel/vaultlevel.css` — trail and caption in, shelves out
- `src/avatar/scenes.ts` — `tool` gains an object
- `src/avatar/avatar.css` — keyframes for the new `tool`
- `src/vaultlevel/square.test.tsx` — book tests out, trail and caption tests in
- `src/avatar/scenes.test.ts` — `tool` now has an object

**Untouched**

- `src/pulse/Overlay.tsx` and `caption()` — the overlay keeps its own voice
- `src/cockpit/VaultLevelSlot.tsx` — the slot stays agnostic about what fills it

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Empty log | Health pose, no caption, empty trail |
| `client.level()` fails | HUD reads `no vault`; the octopus keeps wearing pulses — independent sources |
| Fewer than 5 pulses | The trail shows what there is, with no placeholders |
| No `tool` and no `slugs` | Caption is the verb alone |
| A pulse older than an hour | `2h`, `3d` — never "a long time ago" |
| `prefers-reduced-motion` | `avatar.css` already disables animation globally; the trail and caption are static |

The square does not inherit `minIntervalMs`. That throttle exists to stop the overlay
interrupting the user too often; the square shows what is true. If `tool` fires forty times a
minute the square says `tool`, which is correct — and the trail collapses the repeats.

## Tests

- `recent.test.ts` — collapse of consecutive repeats, cut at five, ordering, empty log
- `caption.test.ts` — all nine verbs, fallback with no `tool`/`slugs`/`hits`, the four age bands
- `square.test.tsx` — health pose on an empty log; the first pulse dresses the octopus; the
  HUD survives a failing `level()`; the trail renders N dots
- `scenes.test.ts` — `tool` carries an object, and `withPartIndex` numbers it from zero

## Open question

Whether the four remaining weak scenes (`reflex`, `briefing`, `catchup`, `learned`) need
redrawing is deliberately left for after this ships. `learned` is the most likely: it is the
most important thing mnemo does and currently shows a 2×2 green pixel in a ring of identical
nodes.

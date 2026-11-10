---
feature: redesign-concepts
created: 2026-11-09
verdict: parallel
---

<!--
  Phase 0 of the mnemo-desktop recreation: three concept directions for the sessions screen
  and the pending flow, each a static prototype the maintainer opens on his own data and
  chooses from. No product code: nothing under src/ or src-tauri/ changes.

  The seam is the branch this contract sits on (redesign/concepts). It carries what the
  three pieces share and none of them may edit:

    docs/superpowers/prototypes/redesign/README.md     what was asked, what is wrong today,
                                                       the rules every concept keeps
    docs/superpowers/prototypes/redesign/DATA.md       the capture's shape (window.MNEMO)
    docs/superpowers/prototypes/redesign/capture.py    this machine -> data.js (gitignored)
    docs/superpowers/prototypes/redesign/sample.py     synthetic  -> data.sample.js
    docs/superpowers/prototypes/redesign/check.py      the two captures have one shape
    docs/superpowers/prototypes/redesign/shot.py       headless screenshot + console
    docs/superpowers/prototypes/redesign/base/         base.css, load.js, fonts

  Each piece is one folder with its BRIEF.md already in it. The pieces pass the test: a
  concept is written and judged without reading another's interior, and all three consume
  only the capture and the base, which the seam owns. A dispatch prompt carries a piece's
  files and signatures and not this text, so each signature names the brief to read.

  Why three and why these: the maintainer chooses from running prototypes, as in the earlier
  rounds. Console bets on speed of use, Orbit on the first look, Score on showing what only
  this data can show. They disagree on purpose.
-->

## console

- **files:** docs/superpowers/prototypes/redesign/console/
- **exposes:** `docs/superpowers/prototypes/redesign/console/index.html: the clickable prototype that console/BRIEF.md describes, under the rules of ../README.md`, `docs/superpowers/prototypes/redesign/console/NOTES.md: decisions, what is faked, the generated-art wishlist`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

One roster of whole sessions ordered by attention, one stage with the terminal, the
instruments for tokens, memory and sight always open beside it. Keyboard first.

## orbit

- **files:** docs/superpowers/prototypes/redesign/orbit/
- **exposes:** `docs/superpowers/prototypes/redesign/orbit/index.html: the clickable prototype that orbit/BRIEF.md describes, under the rules of ../README.md`, `docs/superpowers/prototypes/redesign/orbit/NOTES.md: decisions, what is faked, the generated-art wishlist`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

One scene: memory at the centre, sessions in orbit, distance is attention and angle is the
project. Choosing a body opens it as a station.

## score

- **files:** docs/superpowers/prototypes/redesign/score/
- **exposes:** `docs/superpowers/prototypes/redesign/score/index.html: the clickable prototype that score/BRIEF.md describes, under the rules of ../README.md`, `docs/superpowers/prototypes/redesign/score/NOTES.md: decisions, what is faked, the generated-art wishlist`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

Time left to right, a line per session, children as branches, now at the right edge where
he acts. A playhead replays the day.

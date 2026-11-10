---
feature: recreation-overlays
created: 2026-11-10
verdict: parallel
---

<!--
  James's panel, launcher and orb, the notification stack and the dictation indicator in the
  new identity. One piece: the four share one stylesheet today (src/nexus/ui/ui.css) and one
  decision (what they look like under the ship), so cutting them would have two children
  inventing the replacement. What it must do is the section "The overlays" of
  docs/superpowers/specs/2026-11-10-recreation-front.md.

  It touches no folder a piece still running owns: the frame (src/frame/) only gains James's
  place in its top bar, which is the frame's to add once this lands; until then the piece
  exports what the top bar will render.

  Pull requests target redesign/app, not main.
-->

## overlays

- **files:** src/jarvis/panel/, src/jarvis/orb/, src/jarvis/view.tsx, src/jarvis/launcher/, src/notify/, src/voice/Indicator.tsx, src/voice/Indicator.test.tsx, src/voice/FileWork.tsx, src/voice/FileWork.test.tsx, src/voice/Grapes.tsx, src/voice/view.tsx, src/voice/view.test.tsx, src/voice/voice.css, orb.html, tools/preview/scenarios/next-overlays.mjs
- **exposes:** `JamesPresence(): JSX.Element, the top bar's way into James (his state, a click or his chord opens the panel), exported from src/jarvis/panel/; and James's panel, his orb, the notification stack and the dictation indicator in the new identity with nothing importing src/nexus/ui/ui.css, as the section "The overlays" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

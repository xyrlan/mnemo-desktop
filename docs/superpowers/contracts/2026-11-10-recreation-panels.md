---
feature: recreation-panels
created: 2026-11-10
verdict: parallel
---

<!--
  The panels of the recreation: what the ship's eight windows become. They run beside the
  first front wave (contracts/2026-11-10-recreation-front.md) because they share nothing with
  it but the host: src/panels/index.tsx, already on redesign/app, where a panel registers
  itself from its own folder. What each must do is the section "The panels" of
  docs/superpowers/specs/2026-11-10-recreation-front.md.

  Two pieces, cut where the stores divide: the work panels read the home snapshot, the
  mission store and the diff; the system panels read the vault, accounts, setup and
  settings. Neither reads the other's folders.

  Pull requests target redesign/app, not main.
-->

## panels-work

- **files:** src/panels/projects/, src/panels/missions/, src/panels/changes/, tools/preview/scenarios/next-panels-work.mjs
- **exposes:** `the panels projects, missions and changes, each registered with registerPanel from its own folder, as the section "The panels" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

## panels-system

- **files:** src/panels/memory/, src/panels/learned/, src/panels/accounts/, src/panels/setup/, src/panels/settings/, tools/preview/scenarios/next-panels-system.mjs
- **exposes:** `the panels memory, learned, accounts, setup and settings, each registered with registerPanel from its own folder, as the section "The panels" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

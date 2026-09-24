# vendor/orca — Orca's look, to adapt from

Verbatim copies of the parts of [Orca](https://github.com/stablyai/orca) that carry how it looks
and moves, at commit `122b8c25d7c16f76e395bf9a65887d7c4bc5003b`. MIT; Orca's license is
`LICENSE` beside this file. The maintainer authorized porting Orca's code into mnemo-desktop on
2026-09-24 (spec: `docs/superpowers/specs/2026-09-24-orca-redesign-design.md`).

**Nothing here is built, type-checked or tested.** `tsconfig.json` includes only `src/`, vitest
only `src/**/*.test.*`, and Tailwind scans only `src/`. These files import Orca's store,
`window.api`, i18n and helpers that do not exist here; they are reference, not code.

## How to use it

Wave B of the redesign builds each screen in `src/` by adapting from here:

- **Keep** the JSX structure, the Tailwind classes, the animations and transitions, hover and
  active states, and drag interactions. That is what the maintainer asked for.
- **Replace** every non-visual import — Orca's `useAppStore` slices, `window.api.*`, `translate`
  (use the English default it carries), telemetry, feature flags — with ours: `src/fleet/`
  (repos, worktrees, agents and their state), `src/layout/` (per-worktree tabs and splits),
  `src/worktrees/`, `src/agents/`, `src/memory/`, and the primitives in `@/ui`.
- **Drop** what the spec cuts: SSH and remote hosts, Linear, Jira, GitLab, mobile, telemetry,
  plugins, account switching, onboarding tours, updates.
- A file adapted from here opens with `// adapted from stablyai/orca <path>` (the path under
  `src/renderer/src/`), and `THIRD_PARTY_NOTICES.md` lists it.

`MANIFEST.md` says, per area, what each file draws and which of its imports need replacing, and
which CSS in `src/renderer/src/assets/` each area relies on.

## Removal

This folder is scaffolding for wave B. Delete it once wave B has landed.

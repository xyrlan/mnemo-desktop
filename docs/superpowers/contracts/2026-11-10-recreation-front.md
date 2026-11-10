---
feature: recreation-front
created: 2026-11-10
verdict: parallel
---

<!--
  The first front wave of the recreation. The design is
  docs/superpowers/specs/2026-11-10-recreation-design.md; what each piece delivers and what
  all of them hold to is docs/superpowers/specs/2026-11-10-recreation-front.md, one section
  per piece. A dispatch prompt carries a piece's files and signatures and not this text, so
  every signature names that section.

  The seam is the branch this sits on (redesign/app). It carries the model every view reads
  (src/world/), the design system's primitives (src/ds/), the frame, a working placeholder
  for every piece that exports the component the frame already renders, the preview
  harness's fixture for the new front, and the three prototypes the views are built from.
  The pieces pass the test: each is one folder, written against World, Actions and the
  signatures below, and tested on the synthetic world without reading another's interior.

  Pull requests target redesign/app, not main.
-->

## ds

- **files:** src/ds/, tools/preview/scenarios/next-ds.mjs
- **exposes:** `StateMark, Kbd, Label, Pill, Meter, Ring, Figure, Mark, Lattice, Starfield with the props src/ds/index.tsx has today, finished and added to as the section "ds" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

## pending

- **files:** src/pending/, tools/preview/scenarios/next-pending.mjs
- **exposes:** `PendingCard({ pending, armed }: { pending: Pending; armed: boolean })`, `armedPending(world: World, route: Route): Pending | null`, `nextPending(world: World, route: Route): Pending | null`, `WaitingCount(): JSX.Element`, `answerArmed(key: number): Promise<Outcome | null>`, `replyArmed(): boolean`, `all as the section "pending" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

## orbit

- **files:** src/orbit/, tools/preview/scenarios/next-orbit-states.mjs
- **exposes:** `OrbitView(): JSX.Element`, `OrbitMap({ focus }: { focus: string | null }): JSX.Element`, `both as the section "orbit" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** `PendingCard({ pending, armed }: { pending: Pending; armed: boolean })` from pending, `Lattice({ pulse, onReady, className, style })` from ds
- **model:** fable
- **effort:** high
- **may:** pr

## roster

- **files:** src/roster/, tools/preview/scenarios/next-roster.mjs
- **exposes:** `Roster(): JSX.Element as the section "roster" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** `PendingCard({ pending, armed }: { pending: Pending; armed: boolean })` from pending, `OrbitMap({ focus }: { focus: string | null }): JSX.Element` from orbit
- **model:** fable
- **effort:** high
- **may:** pr

## stage

- **files:** src/stage/, tools/preview/scenarios/next-stage.mjs
- **exposes:** `Stage(): JSX.Element as the section "stage" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** `canHost(session: Session): boolean` from runtime, `LiveTerminal({ sessionId, active }: { sessionId: string; active: boolean })` from runtime, `PendingCard({ pending, armed }: { pending: Pending; armed: boolean })` from pending
- **model:** fable
- **effort:** high
- **may:** pr

## instruments

- **files:** src/instruments/, tools/preview/scenarios/next-instruments.mjs
- **exposes:** `Instruments({ sessionId, at }: { sessionId: string; at?: number | null }): JSX.Element as the section "instruments" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

## score

- **files:** src/score/, tools/preview/scenarios/next-score-states.mjs
- **exposes:** `ScoreView(): JSX.Element as the section "score" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** `Instruments({ sessionId, at }: { sessionId: string; at?: number | null }): JSX.Element` from instruments, `PendingCard({ pending, armed }: { pending: Pending; armed: boolean })` from pending
- **model:** fable
- **effort:** high
- **may:** pr

## frame

- **files:** src/frame/, src/command/, tools/preview/scenarios/next-frame.mjs
- **exposes:** `Frame(): JSX.Element, with the top bar, the layouts, the fleet-wide keys and the command line, as the section "frame" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); src/frame/flag.ts and src/frame/view.tsx keep what they do; the pull request targets the branch redesign/app`
- **consumes:** `OrbitView(): JSX.Element` from orbit, `Roster(): JSX.Element` from roster, `Stage(): JSX.Element` from stage, `Instruments({ sessionId, at }: { sessionId: string; at?: number | null }): JSX.Element` from instruments, `ScoreView(): JSX.Element` from score, `WaitingCount(): JSX.Element` from pending, `answerArmed(key: number): Promise<Outcome | null>` from pending, `nextPending(world: World, route: Route): Pending | null` from pending, `startRuntime(): () => void` from runtime
- **model:** fable
- **effort:** high
- **may:** pr

## runtime

- **files:** src/runtime/
- **exposes:** `canHost(session: Session): boolean`, `LiveTerminal({ sessionId, active }: { sessionId: string; active: boolean })`, `startRuntime(): () => void`, `all as the section "runtime" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

## world-live

- **files:** src/world/live/, tools/world/
- **exposes:** `startLive(set: (world: World) => void): () => void as the section "world-live" of docs/superpowers/specs/2026-11-10-recreation-front.md says (read "What every piece holds to" there first); the pull request targets the branch redesign/app`
- **consumes:** nothing
- **model:** fable
- **effort:** high
- **may:** pr

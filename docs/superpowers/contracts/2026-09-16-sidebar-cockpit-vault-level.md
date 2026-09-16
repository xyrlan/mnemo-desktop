---
feature: sidebar-cockpit-vault-level
created: 2026-09-16
verdict: parallel
---

Three pieces from `docs/superpowers/specs/2026-09-16-sidebar-cockpit-vault-level-design.md`.
Read the spec first — it holds the reasoning, the measured numbers, and what was
deliberately left out.

The cut. `cockpit-body` owns the sidebar and the cockpit; `vault-level` owns a new
module and never opens `src/mission/Sidebar.tsx`; `map-removal` deletes a module
neither of the others reads. The one file two pieces would otherwise share is the
Sidebar, so `cockpit-body` mounts the square's slot and publishes its signature,
and `vault-level` is written against that signature while it waits.

Wiring rules from `docs/contracts/panes.md` hold. `src/graph/`, `src/github/` and
`src/avatar/` are read-only for every piece — `src/avatar/` in particular shipped
in #90 and this feature consumes it as-is, adding only a new scene where the
contract says so.

Run `tauri dev` in the background with a private target
(`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece> pnpm tauri dev --port 17xx`),
kill any leftover `vite` first, and look at the real app before claiming a piece
is done. `pnpm test` must be green; a piece that touches Rust runs `cargo test`
in `src-tauri/` too.

## cockpit-body

- **files:** src/cockpit/, src/mission/Sidebar.tsx, src/mission/store.ts, src/mission/store.test.ts, src/mission/mission.css, src/theme.css
- **exposes:** `VaultLevelSlot(props: { className?: string }) -> JSX.Element`
- **consumes:** nothing

The sidebar renders the whole cockpit body — `needs`, `andando:`, `feito hoje:` —
instead of `NeedsList` alone, and the `cockpit` pane keeps rendering the same body
plus its head, its `MissionMap` and its keyboard handling.

Collapse state is shared by both surfaces, which means it can no longer be the
`useState` in `Cockpit.tsx:200`. It moves to the mission store, keeping today's
rules exactly: `needs` always open, `andando` open when `needs` is empty, `feito`
collapsed. The `⤢` button stays and still opens the pane.

`VaultLevelSlot` is this piece's deliverable to `vault-level`: a fixed-size
element docked at the foot of `.sidebar`, a sibling of `.sidebar-body` with
`flex: 0 0 auto`, rendering nothing but its own box. Ship it with a placeholder
inside — an empty bordered square is enough. `vault-level` replaces the contents;
nobody but this piece edits the Sidebar.

`.sidebar-body` is already `flex: 1 1 auto; overflow: auto` (`src/theme.css:104`),
so the slot needs no layout surgery. Keyboard navigation stays pane-only in this
cut; the sidebar is for reading and clicking.

## vault-level

- **files:** src/vaultlevel/, src/avatar/scenes.ts, src/avatar/scenes.test.ts, src-tauri/src/vault.rs, src-tauri/src/lib.rs
- **exposes:** `vault_level() -> VaultLevel`
- **consumes:** `VaultLevelSlot(props: { className?: string }) -> JSX.Element` from cockpit-body

The square: a halo of dots, the mnemo octopus, and a level with a bar. Spec §3
describes the three layers and the exit/return cycle — when a `mnemo://pulse`
arrives the octopus scales to zero and fades, the presence overlay plays over the
causing pane, and it returns when the scene ends. The halo never leaves.

`vault_level()` exists because `vault_health()` shells out to `mnemo status` and
`mnemo doctor` on every call (`vault.rs:1305-1310`), which no continuously
updating square can afford. Deliver the cheap path: the page walk and
`read_fires`, no subprocess. Pick the struct's fields from what the square
actually renders.

`src/avatar/` is read-only except for one new `idle` scene in `scenes.ts` — the
octopus at rest, breathing. Everything else there shipped in #90 and stays.

**The XP formula is not decided.** Spec §5 has the measured numbers (3,579 pages,
104 slugs ever fired, 135 emissions in the log) and three candidate values for
`K` in `xp = pages + K × rules_fired`. Do not pick one silently: put `K`, the
health weights and the fire threshold in one named, commented constants block so
the maintainer can calibrate against the real vault by looking at the screen.
Say in the PR body which values you shipped as the starting point and why.

The level never regresses: persist the highest xp ever seen and compute the level
from that, so a rule retired by the friction loop moves the colour and not the bar.
`src/mission/Sidebar.tsx` belongs to `cockpit-body` — mount through the slot.

## map-removal

- **files:** src/vault/, src-tauri/src/vaultmap.rs, src-tauri/src/lib.rs, package.json, pnpm-lock.yaml
- **exposes:** nothing
- **consumes:** nothing

The sigma.js vault Map goes. Spec §2 lists every callsite: the "Mapa" button and
the `vault.map` palette action in `src/vault/view.tsx`, the lazy `MapPane` import
and its `<Suspense>`, the whole `src/vault/map/` directory,
`src-tauri/src/vaultmap.rs` with its `notify` watcher, the three `vault_map*`
commands and the watcher start in `lib.rs`, the `mnemo://vault-born` and
`mnemo://vault-changed` events, the `.vm-*` CSS, and the five sigma/graphology
dependencies.

The ego view (`src/vault/EgoView.tsx`, React Flow through `src/graph/`) **stays** —
it answers "this rule and its neighbours", which is the question the hairball never
answered. The vault pane's mode bar goes from `health | pages | Mapa` to
`health | pages`.

Leave `~/.mnemo-desktop/vault-map-positions.json` on disk. It becomes a dead file;
deleting a user's data to remove a feature is the worse default.

`lib.rs` is also named by `vault-level`, which adds a command while this piece
removes three. Touch only the `// -- vault` anchor blocks, and expect to resolve
that one hunk at merge.

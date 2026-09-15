---
feature: round10
created: 2026-09-15
verdict: parallel
---

Tenth round, one piece: the vault's living map (user decision A, 2026-09-15 —
"mapa vivo" first, structure/organisation next round). Wiring rules from
`docs/contracts/panes.md` hold; `src/graph/`, `src/pulse/`, `src/github/`,
`src-tauri/src/pulse.rs` are read-only. The `// -- vaultmap` anchors already
exist in `src-tauri/src/lib.rs`. Run `tauri dev` in the background with a
private target (`CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-map pnpm tauri dev
--port 1750`), kill leftover `vite` processes first, and look at the real app
with the real vault (~3.6k pages): smoothness is the acceptance test.

## map

- **files:** src/vault/map/, src/vault/view.tsx, src/vault/vault.css, src-tauri/src/vaultmap.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, package.json, pnpm-lock.yaml
- **exposes:** `vault_map(scope: String) -> VaultMap`, `vault_map_positions_read(scope: String) -> HashMap<String, [f32; 2]>`, `vault_map_positions_write(scope: String, positions: HashMap<String, [f32; 2]>) -> ()`, event `mnemo://vault-born { path: String, slug: String }`
- **consumes:** nothing

Issue #71. New dependencies `sigma`, `graphology`, `graphology-layout-forceatlas2`
(and `notify` on the Rust side) are yours to add. In `src/vault/view.tsx` only
add the "Mapa" tab next to Health/Pages; the health table and the ego view are
not yours. Reuse `vault.rs`'s page reader and heat function by calling them
(make them `pub(crate)` if needed — that one-line change in `vault.rs` is
allowed, nothing else there).

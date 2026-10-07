# Working in this repo

How work is run here.

## Run `pnpm test` with `DEVELOPER_DIR`, `PATH`

```sh
DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH pnpm test
```

3 dispatched children of the 59 that ran `pnpm test` ran it without this first and added it after (2026-09-24, `mnemo procedures`). Say here why it is needed.

`pnpm test` is vitest and runs no cargo, so it needs no `CARGO_TARGET_DIR`. This line used to set one (`~/.cache/mnemo-desktop-r20-tailer`), and children carried it into their cargo commands. That dir grew to 38.7 GB (#291).

## One Cargo target, plus temporary per-piece ones

- **Canonical target:** `.cargo/config.toml`'s `target-dir`, `../.mnemo-desktop-target`. Every worktree shares it. Plain `cargo` and `pnpm tauri` use it with no `CARGO_TARGET_DIR`.
- **Per-piece target, for parallel builds only:** `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece>`. It keeps a child off the shared target's lock. It is temporary: a contract that names one says so.
- **Landing removes it:** run `pnpm targets prune <piece>…` for each landed piece.
- **Bounding:** Cargo never deletes stale artifacts, so `pnpm test` first runs `pnpm targets check`. It warns when the canonical target passes 20 GB (`pnpm targets trim`) or a per-piece target has sat untouched for 24 h (`pnpm targets prune`). `pnpm targets` lists the sizes.

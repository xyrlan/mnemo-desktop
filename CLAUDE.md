# Working in this repo

How work is run here.

## Run `pnpm test` with `CARGO_TARGET_DIR`, `DEVELOPER_DIR`, `PATH`

```sh
CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-r20-tailer DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH pnpm test
```

3 dispatched children of the 59 that ran `pnpm test` ran it without this first and added it after (2026-09-24, `mnemo procedures`). Say here why it is needed. Children gave `CARGO_TARGET_DIR` 3 values — the commonest is above.

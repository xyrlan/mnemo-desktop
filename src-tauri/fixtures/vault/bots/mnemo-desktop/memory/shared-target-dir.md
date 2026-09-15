---
name: shared-target-dir
description: Every worktree builds into ../.mnemo-desktop-target, so pass a private CARGO_TARGET_DIR when two pieces build at once
metadata:
  type: project
  confidence: observed
  topics:
    - build
    - worktrees
---

Dispatch children live in sibling worktrees and `.cargo/config.toml` points them all at one target dir.

**Why:** a cold Tauri build takes minutes; sharing the dir saves it.

**How to apply:**
- One build at a time: share the dir.
- Parallel builds: `CARGO_TARGET_DIR=$HOME/.cache/mnemo-desktop-<piece>`.

See [[no-silent-contract-changes]].

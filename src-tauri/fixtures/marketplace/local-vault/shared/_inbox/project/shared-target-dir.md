---
name: shared-target-dir
slug: shared-target-dir
description: All worktrees share one cargo target dir
type: project
stability: stable
confidence: inferred
origin: imported
projects:
  - mnemo-desktop
sources: []
tags:
  - needs-review
  - workflow
imported:
  vault: 3f9c2a7e5b1d4c8a9e6f0b2d4a6c8e1f
  project: mnemo-desktop
  date: 2026-07-20
  source_count: 1
  at: 2026-09-12
---

`.cargo/config.toml` points every worktree at `../.mnemo-desktop-target`.

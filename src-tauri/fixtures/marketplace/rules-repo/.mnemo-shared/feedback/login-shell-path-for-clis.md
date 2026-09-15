---
name: login-shell-path-for-clis
slug: login-shell-path-for-clis
description: 'GUI apps must resolve CLIs through the login shell''s PATH'
type: feedback
stability: evolving
confidence: verified
tags:
  - debugging
  - deployment
published:
  vault: b7e4d1c9a3f6082e5d9c1b4a7e3f6d20
  project: mnemo-desktop
  date: 2026-09-10
  source_count: 0
---

A Dock-launched app inherits launchd's PATH; spawn every CLI with the login shell's PATH.

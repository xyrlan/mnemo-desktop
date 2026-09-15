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
  vault: 3f9c2a7e5b1d4c8a9e6f0b2d4a6c8e1f
  project: mnemo-desktop
  date: 2026-09-10
  source_count: 0
---

A Dock-launched app inherits launchd's PATH; spawn every CLI with the login shell's PATH.

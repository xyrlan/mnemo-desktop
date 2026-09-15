---
name: effects-clean-up-listeners
slug: effects-clean-up-listeners
description: Every effect that subscribes returns the unsubscribe
type: feedback
stability: stable
confidence: verified
tags:
  - react
  - ui
published:
  vault: 3f9c2a7e5b1d4c8a9e6f0b2d4a6c8e1f
  project: web-app
  date: 2026-08-15
  source_count: 1
---

A `useEffect` that calls `listen` returns a cleanup that awaits the unlisten promise.

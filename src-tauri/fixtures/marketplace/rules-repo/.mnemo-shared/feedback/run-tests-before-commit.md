---
name: run-tests-before-commit
slug: run-tests-before-commit
description: 'Run the full test suite before committing, not only the tests for the touched module'
type: feedback
stability: stable
confidence: verified
tags:
  - testing
  - workflow
evidence:
  quote: 'run everything before you commit, the module tests missed it twice'
  source: session
published:
  vault: 3f9c2a7e5b1d4c8a9e6f0b2d4a6c8e1f
  project: mnemo-desktop
  date: 2026-08-02
  source_count: 2
---

Run `pnpm test` and `cargo test` before every commit.

**Why:** a module-local run missed a cross-module break twice.

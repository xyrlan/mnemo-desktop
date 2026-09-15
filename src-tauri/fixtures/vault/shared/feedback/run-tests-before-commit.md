---
name: Run the full test suite before committing
slug: run-tests-before-commit
description: 'Run both suites before a commit, not just the one you touched'
type: feedback
stability: stable
confidence: verified
extracted_at: 2026-09-14T07:34:53
tags:
  - testing
  - workflow
evidence:
  quote: roda os testes antes
  source: bots/mnemo-desktop/briefings/sessions/0000-session.md
---

Run `pnpm test` and `cargo test` before every commit.

**Why:** a front-end change can break a Rust fixture test, and the other way round.

<!-- mnemo:graph-section -->
## Sources
- [[bots/mnemo-desktop/briefings/sessions/0000-session]]

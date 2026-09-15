# Round 5: pane chrome, graph cockpit, vault graph + health

**Date:** 2026-09-15 · **Status:** approved (user chose A / A / graph in conversation; remaining calls delegated)

## What the user asked for (2026-09-15)

- "As janelas que abrem, a gente não consegue redimensionar, mudar de localidade." Above the Claude Code pane show repo, branch, parent and child tokens — "nessa abinha das janelas que a gente conseguiria redimensionar".
- The cockpit (global and per-repo live sessions) "ainda tá meio sem sal" — wants the most efficient screen for a dev workflow. Their mental image: **React Flow**.
- Vault: a better overview — `mnemo status` / `doctor` data, rules needing review, rules never fired, rules with scores, and an **Obsidian-style graph** of the vault.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Window model | **A: tiling, improved** — a header bar per pane with the drag handle (drag onto another pane swaps them), thicker dividers, close button in the bar. No floating windows. | Split resize already existed (4 px divider, `setRatio`) but was undiscoverable; floating panes hide behind each other and add state for little gain. |
| Cockpit form | **Node canvas** (React Flow + dagre): repo → parent → children; child → PR → CI; contracts as groups. Tone by state, BLOCKED pulses, tokens and "since you looked" as badges. Click = mission pane, double-click = attach. A **needs-you strip** above the canvas. | A mission is a DAG; the list flattened the parent→child relation the user keeps asking about. Triage stays one glance away in the strip. |
| Sidebar | **Replaced** by the needs-you list (narrow, always visible). The canvas is the full-size cockpit pane (⌘⇧B). | Less duplicated UI; the sidebar keeps only what needs action. |
| Vault graph | Same engine. Node per rule, edges = wikilinks + shared topics, colour = confidence, size/badge = fire count (reflex-log + access-log), grey = never fired. One agent/topic at a time (3.6k pages). | Obsidian-style was the ask; fire counts answer "which rules are dead weight". |
| Vault health | Panel beside the graph: status/doctor text + parsed tiles, needs-review list (stale, label-only verified, never fired with activation, inbox count). | `status`/`doctor` have no `--json`; parse the few numbers that matter, show the rest as text. |
| Delivery | Three dispatch pieces in parallel (`docs/contracts/round5.md`); the shared graph engine `src/graph/` and the `lib.rs` anchors were pre-built on main so no two pieces touch the same seam. | Round-2 lesson: pre-create every anchor a round will use. |

## Out of scope

Floating windows, a chronological feed (maybe a second tab of the cockpit later), multi-CLI (#5), whole-vault rendering.

## Addendum (2026-09-15, later): pulse — after round 5

User: "ver efeitos visuais na tela quando uma memória é usada, alguma tool do mnemo é usada". Decision **A + C**: the pane bar (from #35) pulses and shows `↯ <slug>` for ~3 s with a running counter; the vault graph node (from #37) glows. Toasts only for `enforce`. Source = tail of `.mnemo/{mcp-access-log,reflex-log,enrichment-log}.jsonl` → `mnemo://pulse`. Issue #44, built after round 5 lands (a separate round-6 contract already exists for cwd/quiet launch/brand; pulse joins the next one).

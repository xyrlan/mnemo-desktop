# The Nexus is the app

2026-10-15. Follows `2026-10-15-nexus-v2-design.md`. Decided with the maintainer after they used v2
installed:

> "a ideia seria tirar toda a parte de workbench … a gente só vai usar o design do Nexus agora.
> Acabou … a gente tem que conseguir fazer tudo lá dentro do Nexus."

Every recommendation below (Q1–Q9) was put to them and accepted.

## What changes

- **One design.** The app is the Nexus: the ship, its bridge, its decks, its drawer.
  - The workbench's interface goes: tab strip, splits, left and right sidebars, editor, browser and
    explorer panes.
  - Everything a person did there is either done inside the Nexus or dropped (below).
  - Every window, menu, popover and dialog the app opens looks like the ship. It uses the Nexus
    frame (`src/nexus/ui/`), not the workbench's components.
- **The drawer shows terminals only.** Conversation mode (#441) goes: no Conversation · Terminal
  switch, and ⌘⇧C is no longer the drawer's. A tab is the session's live terminal, as v2 first
  specified.
- **The octopus leaves the sessions.** Its scenes over a pane when mnemo acts (`src/pulse/Overlay.tsx`)
  and the draggable pet (`src/pet/`) go, with the avatar that draws both (`src/avatar/`). The
  maintainer: "a gente vai mudar essa ideia e a gente vai trazer para o contexto do Nexus". The
  pulse itself stays: the ship's log and ◈ read it. Bringing the octopus into the ship is a later
  round; the brand mark (`src/brand/`) stays.

## Where each workbench function goes

- **Q1 · A new session.** Right-click a deck or a dock: **New session** opens `claude` in that
  repo, in a drawer tab. The bridge's prompt also takes `/new <repo>`.
- **Q2 · Managing a session: a right-click menu, in the ship's look.**
  - **On a captain:**
    - **Open.**
    - **Close:** ends the session when the app holds its terminal, and the captain leaves the ship. A
      session running outside the app says so instead.
    - **Resume:** for an ended one.
    - **Copy id.**
  - **On a robot:**
    - **Open.**
    - **Stop:** `claude stop`.
    - **Merge PR:** the checks-gated merge, confirmed.
    - **Open PR:** in the system browser.
    - **Changes:** the full diff (Q7).
    - **Copy id.**
  - **On a deck or a dock:**
    - **New session.**
    - **Terminal here:** a shell.
    - **The repo's saved commands** (the old quick commands).
- **Q3 · Projects.** A **PROJECTS** button in the ship's bar opens a window listing every known
  repo, whether or not a session is live in it. Each repo has **New session**, and the window has
  **Add · Clone · Open folder**.
- **Q4 · Terminals and saved commands.**
  - A shell or a saved command runs in a drawer tab, from the deck's or the dock's menu, or from the
    repo's row in PROJECTS.
  - Saved commands can be added and removed there.
- **Q5 · Issues and PRs.** A **MISSIONS** button opens a window with each repo's open issues and
  PRs, **Dispatch** (issues, with model, effort and may) and **Dispatch contract**. `/dispatch`
  stays.
- **Q6 · Editor, explorer, browser panes: dropped.** A file or a link opens in the system's editor
  or browser.
  - The `desktop_*` MCP tools lose the panes they read; `desktop_app_snapshot` stays.
- **Q7 · Review.**
  - **Changes**, on a robot's menu and in its drawer tab, opens a window with the full diff of the
    child's worktree and its notes-for-the-agent (`src/diff/`).
  - Manual commit and the Checks panel are dropped: the ship shows CI and merges.
- **Q8 · The rest.**
  - A **SYSTEMS** button opens a menu, and each item opens as a Nexus window:
    - **Memory** (the vault's pages, health, inbox);
    - **What mnemo learned**;
    - **Setup**;
    - **Accounts** (add, re-sign, remove);
    - **Settings**.
  - The account switcher in the ship's bar takes the ship's look.
  - The marketplace is dropped; check its use first.
- **Q9 · Order.** Everything above lands first (wave 1), so no day goes without a function. Then the
  workbench's interface is deleted in one pass (wave 2).

## One architectural line

**The layout store stays, as the session registry. Only its interface goes.**
- It keeps holding every terminal the app runs, and restores them across a restart through the
  daemon.
- A new session or shell is a pane with no view on screen. The drawer shows it through the session
  host (`{ pane }`), as it already shows a pane's session.

Wave 2 deletes views, not the store.

## The round

Contract: `docs/superpowers/contracts/2026-10-15-nexus-app.md`.

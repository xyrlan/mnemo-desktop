# Round 6: new shells in the current repo, quiet launch, brand

**Date:** 2026-09-15 · **Status:** approved in conversation (user raised the three gaps; remaining calls delegated)

## What the user asked for (2026-09-15)

- "Quando a gente está dentro de um repositório e a gente dá o command D, ele está só abrindo um novo shell na raiz. Acho que isso não é a melhor ideia."
- "Quando eu abri o app em algum momento pediu muitas permissões de acesso, o que não é um problema… mas isso nunca aconteceu comigo no Warp."
- "Ver coisas referentes a logo, marca e tal" — "ícone do app + wordmark… algo que lembra um polvo, um bonequinho de um polvo."

## Findings (verified in the repo and on this Mac)

| Gap | Root cause |
|---|---|
| ⌘D / ⌘T land in `/` | Pane cwd is only ever set by OSC 7 (`src/terminal/view.tsx`). macOS zsh emits OSC 7 **only** when `TERM_PROGRAM=Apple_Terminal` (`/etc/zshrc` → `/etc/zshrc_Apple_Terminal`). mnemo-desktop sets no `TERM_PROGRAM` and injects no shell hook, so `Pane.cwd` is always undefined. `split()` and `tab.new` then spawn with `cwd: null`, and `pty.rs` leaves the child in the app process cwd (`/` from the Dock). Also `split()` reads the raw pane field instead of `focusedCwd()` in `src/mission/scope.ts`, which already derives a directory from editor and mission panes and sibling terminals. |
| Permission dialogs at launch | Home load (`home.rs::collect_home`) runs `git rev-parse --git-common-dir` inside **every** cwd in `~/.claude/history.jsonl` (`mission::repo_root`). 31 of the user's entries are under `~/Downloads`, so the very first launch triggers macOS's "access files in your Downloads folder" dialog (Desktop/Documents/removable volumes likewise for anyone with repos there). `Info.plist` only has the microphone string, so the dialogs come with no explanation. Warp never scans history, hence never asks. |
| No brand | `app-icon.png` is a flat `#12141A` square from a placeholder script; all 18 files in `src-tauri/icons/` are solid colour; no favicon; the only wordmark is a text span in the Home header. No logo exists in either repo. |

## Decisions

| Question | Choice | Why |
|---|---|---|
| How does the app learn the shell's cwd? | **Shell integration, zero config**: ship zsh bootstrap rc files under `~/.mnemo-desktop/shell/zsh/` and spawn with `ZDOTDIR` pointing there; the bootstrap sources the user's real files (`MNEMO_USER_ZDOTDIR`) then adds a `precmd` hook printing OSC 7. bash gets `--rcfile` with a `PROMPT_COMMAND` hook. Spawn also sets `TERM_PROGRAM=mnemo` / `TERM_PROGRAM_VERSION`. fish already emits OSC 7 natively — document, no file. | The VS Code / Warp technique; works without the user editing dotfiles and survives `exec zsh`. Asking the user to source a snippet is not a fix. |
| Where does a new shell start? | `cwdForNewShell()` = focused pane's cwd via `focusedCwd()` (terminal → OSC 7 cwd, editor → root, mission → worktree, else first sibling terminal with a cwd); on Home with a selected repo → that root; otherwise `$HOME`. Rust: `cwd: None` → home dir, **never** the process cwd. | One function, unit-testable without a PTY; both ⌘D and ⌘T use it. |
| Launch permissions | **Lazy resolution for protected folders.** cwds under `~/Desktop`, `~/Documents`, `~/Downloads`, `/Volumes/*` are grouped by their history path without running git and flagged `unresolved`; `repo_root` runs only when the user selects that repo in Home (one prompt, at a moment that makes sense). The 3 s sidebar poll takes the same guard. Add the four `NS*UsageDescription` strings so any dialog that does fire says why. | Access must follow a user action, like Warp. Unresolved repos may show a worktree as its own row until clicked — accepted. |
| Brand | **Octopus mascot + lowercase `mnemo` wordmark.** One SVG mark (`src/brand/mark.svg`, drawn in-house since the Higgsfield workspace has 0 credits) in the existing palette: accent `#7aa2f7` on `#0f1116`, JetBrains Mono 700 for the wordmark. From the SVG: `app-icon.png` 1024² with the art inside the ~82% safe area → `pnpm tauri icon` regenerates all icon files; favicon in `index.html`; `Wordmark` component in the Home header; `tauri.conf.json` bundle gets `category: DeveloperTool`, `copyright`, `shortDescription`. | Icon + wordmark was the scope the user chose. No new colours or typefaces: the Tokyo Night palette is already the brand. |
| Delivery | Three dispatch pieces in parallel (`docs/contracts/round6.md`), each on its own issue. `src/brand/mark.svg` is pre-built on main so the brand piece only does the pipeline. | Same rule as round 5: pre-create every shared seam. |

## Out of scope

Claude Code permission modes (the complaint is macOS TCC, not tool prompts — nothing in the repo writes `~/.claude` or passes permission flags), a full identity system, light theme, custom title bar, the Portuguese/English copy split (separate decision), the ⌘⇧B binding gap (README lists it, nothing binds it; filed separately).

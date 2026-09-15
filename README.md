# mnemo-desktop

Desktop shell for the mnemo agentic development environment. Sub-project 1: a terminal with tabs, splits and a command palette, enough to replace your daily terminal so the mission cockpit (sub-project 2) can live on screen.

## Dev

    brew install cmake        # whisper-rs (voice) builds against it
    pnpm install
    pnpm tauri dev

Release build + install on macOS:

    pnpm tauri build --bundles app
    rm -rf /Applications/mnemo.app && cp -R ../.mnemo-desktop-target/release/bundle/macos/mnemo.app /Applications/

Run your parent Claude Code session inside the app from the repo whose project memory you want (`cd ~/github/mnemo && claude --continue`); dispatch children then appear in the mission sidebar.

## Test

    pnpm test                                        # front-end
    cargo test --manifest-path src-tauri/Cargo.toml  # core
    MNEMO_DESKTOP_SMOKE=1 ../.mnemo-desktop-target/debug/mnemo-desktop   # shell round-trip, exit 0 (target dir is shared across worktrees, see .cargo/config.toml)

## Shortcuts

⌘T new tab · ⌘W close pane · ⌘⇧W close tab · ⌘D split right · ⌘⇧D split down · ⌘⌥arrows focus · ⌘1-9 tab · ⌘⇧[ ] cycle · ⌘K palette · ⌘B mission sidebar · ⌘⇧B cockpit · ⌥Space hold to dictate (Ctrl on Linux/Windows)

In a terminal: ⌘←/⌘→ line start/end, ⌘⌫ kill line, ⌥⌫ kill word, ⌘C/⌘V clipboard, Shift+Enter newline (Claude Code).

Panes: terminal, editor (Monaco), browser (native webview), mission (a dispatch child's timeline), cockpit (all repos), vault (mnemo rules with the native actions as buttons), marketplace (shared rule sets). Open them from ⌘K.

## Settings

`~/.mnemo-desktop/settings.json`, toggled from ⌘K: `outgoing` (`en` rewrites replies and dictation in English through your own `claude -p` before they leave; `as-typed` sends verbatim), `replyLanguage` (`pt`/`en`/`unchanged`, asks a child to answer in that language), `sidebarScope` (`repo`/`all`).

Specs and plans: `docs/superpowers/`.

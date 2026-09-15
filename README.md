# mnemo-desktop

Desktop shell for the mnemo agentic development environment. Sub-project 1: a terminal with tabs, splits and a command palette, enough to replace your daily terminal so the mission cockpit (sub-project 2) can live on screen.

## Dev

    pnpm install
    pnpm tauri dev

## Test

    pnpm test                                        # front-end
    cargo test --manifest-path src-tauri/Cargo.toml  # core
    MNEMO_DESKTOP_SMOKE=1 src-tauri/target/debug/mnemo-desktop   # shell round-trip, exit 0

## Shortcuts

⌘T new tab · ⌘W close pane · ⌘D split right · ⌘⇧D split down · ⌘⌥arrows focus · ⌘1-9 tab · ⌘⇧[ ] cycle · ⌘K palette (Ctrl on Linux/Windows)

Specs and plans: `docs/superpowers/`.

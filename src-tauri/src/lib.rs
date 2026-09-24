pub mod commands;
pub mod pty;

// -- process spawning (src/proc.rs) --
pub mod proc;

// Feature modules register below. Each one owns its own block, separated by
// blank lines, so two branches adding a module never touch the same hunk.

// -- editor (src/fs.rs) --
pub mod fs;

// -- tool-path (src/tools.rs) --
pub mod tools;

// -- browser (src/browser.rs) --
pub mod browser;

// -- settings (src/settings.rs) --
pub mod settings;

// -- mission (src/mission.rs) --
pub mod mission;
pub mod mission_commands;

// -- child-memory (src-tauri/src/child_memory.rs) --
pub mod child_memory;

// -- voice (src/voice.rs) --
pub mod voice;

// -- marketplace (src/marketplace.rs) --
pub mod marketplace;

// -- vault (src/vault.rs) --
pub mod vault;

// -- memory-feed (src/memory_feed.rs) --
pub mod memory_feed;

// -- cockpit: no Rust --

// -- home (src/home.rs) --
pub mod home;
pub mod home_commands;

// -- pr-review (src/review.rs) --
pub mod review;

// -- chrome (src/chrome.rs) --
pub mod chrome;

// -- graph: no Rust --

// -- workspace (src/workspace.rs) --
pub mod workspace;

// -- worktrees (src/worktree.rs) --
pub mod worktree;

// -- mcp (src/mcp.rs) --
pub mod mcp;

// -- system-path (src/tools_path.rs) --
pub mod tools_path;

// -- pulse (src/pulse.rs) --
pub mod pulse;

// -- agent hooks (src/agent_hooks.rs) --
pub mod agent_hooks;

// -- conversation (src/conversation.rs) --
pub mod conversation;

// -- github (src/github.rs) --
pub mod github;

// -- ai-commit-pr (src/commit.rs) --
pub mod commit;

// -- job (src/job.rs) --
pub mod job;
pub mod tools_install;

// -- build info (src/build_info.rs) --
pub mod build_info;

// -- usage (src/usage.rs) --
pub mod usage;

// -- app dir (src/app_dir.rs) --
pub mod app_dir;

// -- install review (src/install_review.rs) --
pub mod install_review;

// -- test helpers (src/testutil.rs) --
#[cfg(test)]
mod testutil;

use commands::PtyState;
use tauri::Manager;

/// `MNEMO_DESKTOP_SMOKE=1`: spawn the default shell, send `exit`, and exit the app with 0
/// when the PTY reports the shell ended within 5 s, 1 otherwise. Used by CI.
fn run_smoke(app: &tauri::App) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let (tx, rx) = std::sync::mpsc::channel();
    let id = state.0.spawn(
        pty::SpawnOptions { program: None, args: vec![], cwd: None, cols: 80, rows: 24, login: true },
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
    )?;
    state.0.write(id, b"exit\n")?;
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut ok = false;
        while std::time::Instant::now() < deadline {
            if let Ok(pty::Event::Exit(_)) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
                ok = true;
                break;
            }
        }
        eprintln!("smoke: shell round-trip {}", if ok { "ok" } else { "FAILED" });
        handle.exit(if ok { 0 } else { 1 });
    });
    Ok(())
}

pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyState(pty::PtyManager::new()))
        // -- voice state --
        .manage(voice::VoiceState::default())
        // A webview loading a page (a reload) leaves its transcript follows with nobody to
        // unfollow them; end them here.
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                conversation::page_loading(webview.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_list,
            commands::pty_attach,
            // Feature commands, one block each, blank-line separated (see the
            // module anchors at the top of this file).

            // -- editor commands --
            fs::fs_read,
            fs::fs_write,
            fs::fs_list,

            // -- tool-path commands --
            tools::tools_status,

            // -- browser commands --
            browser::browser_create,
            browser::browser_navigate,
            browser::browser_set_bounds,
            browser::browser_destroy,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_pr_url,
            browser::browser_open_external,
            browser::browser_data_store,
            browser::browser_save_shot,

            // -- mission commands --
            mission_commands::mission_snapshot,
            mission_commands::mission_timeline,
            mission_commands::mission_reply,
            mission_commands::mission_mark_looked,
            mission_commands::mission_looked,
            mission_commands::mission_translate,
            mission_commands::mission_waiting_for,

            // -- child-memory commands --
            child_memory::child_memory,
            settings::settings_read,
            settings::settings_write,

            // -- voice commands --
            voice::voice_start,
            voice::voice_stop,
            voice::voice_set_language,

            // -- vault commands --
            vault::vault_tree,
            vault::vault_page,
            vault::vault_run,
            vault::vault_rules,
            vault::vault_ego,
            vault::vault_health,
            vault::vault_doctor,

            // -- memory-feed commands --
            memory_feed::memory_feed,

            // -- vaultlevel commands --
            vault::vault_level,
            vault::vault_level_best,

            // -- home commands --
            home_commands::home_snapshot,
            home_commands::home_register_repo,
            home_commands::home_resolve_repo,
            home_commands::home_refresh_github,

            // -- pr-review commands --
            review::review_pr,

            // -- chrome commands --
            chrome::chrome_session,
            commands::pty_pid,

            // -- workspace commands --
            workspace::workspace_read,
            workspace::workspace_write,
            workspace::workspace_live_sessions,

            // -- worktrees commands --
            worktree::worktree_list,
            worktree::worktree_create,
            worktree::worktree_remove,
            worktree::worktree_cleanup_facts,

            // -- mcp commands --
            mcp::mcp_socket_path,
            mcp::mcp_answer,
            mcp::mcp_browser_eval,
            mcp::mcp_browser_snapshot,

            // -- system-path commands --
            tools_path::tools_add_to_path,

            chrome::chrome_branch,
            chrome::chrome_repo,

            // -- pulse commands --
            pulse::pulse_start,

            // -- agent hooks commands --
            agent_hooks::agent_hooks_install,
            agent_hooks::agent_hooks_uninstall,
            agent_hooks::agent_notify,

            // -- conversation commands --
            conversation::conversation_follow,
            conversation::conversation_unfollow,
            conversation::conversation_earlier,

            // -- github commands --
            github::gh_auth,
            github::gh_issues,
            github::gh_project,

            // -- ai-commit-pr commands --
            commit::commit_status,
            commit::commit_message,
            commit::commit_create,
            commit::commit_push,
            commit::commit_pr_find,
            commit::commit_pr_draft,
            commit::commit_pr_create,

            // -- job commands --
            job::job_run,
            tools_install::tools_install_mnemo,

            // -- build info commands --
            build_info::app_build_info,

            // -- usage commands --
            usage::usage_log,

            // -- install review commands --
            install_review::install_review_project,
            install_review::install_review_step,
            install_review::install_review_run,
            install_review::install_review_decided,
            install_review::install_review_record,

            // -- marketplace commands --
            marketplace::marketplace_list,
            marketplace::marketplace_refresh,
            marketplace::marketplace_add_source,
            marketplace::marketplace_remove_source,
            marketplace::marketplace_import,
            marketplace::marketplace_repo,
            marketplace::marketplace_publish,
            marketplace::marketplace_open_pr,
            marketplace::marketplace_import_new,
        ])
        .setup(|app| {
            if std::env::var_os("MNEMO_DESKTOP_SMOKE").is_some() {
                run_smoke(app)?;
            }

            // -- agent hooks --
            // Claude Code's hooks tell the app where each session is (src/agent_hooks.rs).
            agent_hooks::start(app.handle())?;

            // -- menu --
            // App chords as native menu accelerators, so they reach the app while a browser
            // pane's child webview has keyboard focus. Each item emits `app://action` with
            // its action id; `src/actions/keys.ts` runs it (and reads this table in its test,
            // so keep one `("id", "Title", "Accelerator")` tuple per line). macOS only: other
            // platforms would grow a visible menu bar, and keep the keydown handler.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
                use tauri::Emitter;

                const TAB: &[(&str, &str, &str)] = &[
                    ("tab.new", "New Tab", "CmdOrCtrl+T"),
                    ("tab.prev", "Previous Tab", "CmdOrCtrl+Shift+["),
                    ("tab.next", "Next Tab", "CmdOrCtrl+Shift+]"),
                    ("tab.go.1", "Tab 1", "Ctrl+1"),
                    ("tab.go.2", "Tab 2", "Ctrl+2"),
                    ("tab.go.3", "Tab 3", "Ctrl+3"),
                    ("tab.go.4", "Tab 4", "Ctrl+4"),
                    ("tab.go.5", "Tab 5", "Ctrl+5"),
                    ("tab.go.6", "Tab 6", "Ctrl+6"),
                    ("tab.go.7", "Tab 7", "Ctrl+7"),
                    ("tab.go.8", "Tab 8", "Ctrl+8"),
                    ("tab.go.9", "Tab 9", "Ctrl+9"),
                ];
                const WORKTREE: &[(&str, &str, &str)] = &[
                    ("worktree.jump", "Jump to Worktree", "CmdOrCtrl+J"),
                    ("workspace.new", "New Workspace", "CmdOrCtrl+N"),
                    ("worktree.go.1", "Worktree 1", "CmdOrCtrl+1"),
                    ("worktree.go.2", "Worktree 2", "CmdOrCtrl+2"),
                    ("worktree.go.3", "Worktree 3", "CmdOrCtrl+3"),
                    ("worktree.go.4", "Worktree 4", "CmdOrCtrl+4"),
                    ("worktree.go.5", "Worktree 5", "CmdOrCtrl+5"),
                    ("worktree.go.6", "Worktree 6", "CmdOrCtrl+6"),
                    ("worktree.go.7", "Worktree 7", "CmdOrCtrl+7"),
                    ("worktree.go.8", "Worktree 8", "CmdOrCtrl+8"),
                    ("worktree.go.9", "Worktree 9", "CmdOrCtrl+9"),
                ];
                const PANE: &[(&str, &str, &str)] = &[
                    ("pane.split.row", "Split Right", "CmdOrCtrl+D"),
                    ("pane.split.col", "Split Down", "CmdOrCtrl+Shift+D"),
                    ("pane.close", "Close Pane", "CmdOrCtrl+W"),
                    ("tab.close", "Close Tab", "CmdOrCtrl+Shift+W"),
                    ("focus.left", "Focus Pane Left", "CmdOrCtrl+Alt+Left"),
                    ("focus.right", "Focus Pane Right", "CmdOrCtrl+Alt+Right"),
                    ("focus.up", "Focus Pane Up", "CmdOrCtrl+Alt+Up"),
                    ("focus.down", "Focus Pane Down", "CmdOrCtrl+Alt+Down"),
                ];
                const VIEW: &[(&str, &str, &str)] = &[
                    ("palette.open", "Command Palette", "CmdOrCtrl+K"),
                    ("sidebar.toggle-left", "Toggle Left Sidebar", "CmdOrCtrl+B"),
                    ("sidebar.toggle-right", "Toggle Right Sidebar", "CmdOrCtrl+L"),
                    ("pane.toggle-face", "Toggle Conversation", "CmdOrCtrl+Shift+C"),
                ];
                const PREFIX: &str = "action:";

                let h = app.handle();
                let submenu = |title: &str, items: &[(&str, &str, &str)]| {
                    items.iter().try_fold(SubmenuBuilder::new(h, title), |b, (id, text, accel)| {
                        let item = MenuItemBuilder::with_id(format!("{PREFIX}{id}"), *text).accelerator(*accel).build(h)?;
                        Ok::<_, tauri::Error>(b.item(&item))
                    })
                };
                // Rebuilt rather than `Menu::default`, whose File > Close Window takes ⌘W.
                let name = h.package_info().name.clone();
                let app_menu = SubmenuBuilder::new(h, name)
                    .about(None)
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .quit()
                    .build()?;
                let edit = SubmenuBuilder::new(h, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let view = submenu("View", VIEW)?.separator().item(&PredefinedMenuItem::fullscreen(h, None)?).build()?;
                let window = SubmenuBuilder::new(h, "Window").minimize().maximize().build()?;
                let menu = MenuBuilder::new(h)
                    .items(&[&app_menu, &edit, &view, &submenu("Worktree", WORKTREE)?.build()?, &submenu("Tab", TAB)?.build()?, &submenu("Pane", PANE)?.build()?, &window])
                    .build()?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if let Some(id) = event.id().as_ref().strip_prefix(PREFIX) {
                        let _ = app.emit_to("main", "app://action", serde_json::json!({ "id": id }));
                    }
                });
            }

            Ok(())
        })
        // The shells outlive the window: the daemon keeps them for the next launch (src/pty.rs).
        // Only terminals the app held itself, with no daemon to hand them to, end here.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<PtyState>().0.release();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running mnemo-desktop");
}

#[cfg(test)]
mod handler_tests {
    use std::collections::BTreeSet;
    use std::path::Path;

    /// Every `#[tauri::command]` in the crate, by function name.
    fn declared() -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).expect("src is readable") {
                let p = e.expect("entry").path();
                if p.is_dir() {
                    stack.push(p);
                    continue;
                }
                if p.extension().is_none_or(|x| x != "rs") {
                    continue;
                }
                let text = std::fs::read_to_string(&p).expect("source is utf-8");
                let mut lines = text.lines().peekable();
                while let Some(line) = lines.next() {
                    if !line.trim_start().starts_with("#[tauri::command") {
                        continue;
                    }
                    // The signature follows, possibly after other attributes.
                    for next in lines.by_ref() {
                        let t = next.trim_start();
                        if t.starts_with('#') {
                            continue;
                        }
                        if let Some(rest) = t.split("fn ").nth(1) {
                            // `browser_create<R: Runtime>(…)`: the generics are part of the
                            // signature, never of the name the handler lists.
                            if let Some(name) = rest.split(['(', '<']).next() {
                                out.insert(name.trim().to_string());
                            }
                        }
                        break;
                    }
                }
            }
        }
        out
    }

    /// Every name listed in `generate_handler!`, without its module path.
    fn registered() -> BTreeSet<String> {
        let text = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
            .expect("lib.rs is utf-8");
        let start = text.find("generate_handler!").expect("the handler exists");
        let body = &text[start..];
        let end = body.find("])").expect("the handler list closes");
        body[..end]
            .lines()
            .skip(1)
            .filter_map(|l| {
                let t = l.trim().trim_end_matches(',');
                if t.is_empty() || t.starts_with("//") || t.starts_with('[') {
                    return None;
                }
                t.rsplit("::").next().map(|s| s.to_string())
            })
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// A command the front calls is only reachable once it is in `generate_handler!`; the Rust
    /// tests call these functions directly and the TypeScript ones mock `invoke`, so nothing else
    /// notices a missing line. `home_refresh_github` shipped unregistered this way.
    #[test]
    fn every_command_is_registered() {
        let missing: Vec<_> = declared().difference(&registered()).cloned().collect();
        assert!(missing.is_empty(), "declared but never registered: {missing:?}");
    }
}

pub mod commands;
pub mod pty;

// -- process spawning (src/proc.rs) --
pub mod proc;

// -- the process table (src/procs.rs) --
pub mod procs;

// Feature modules register below. Each one owns its own block, separated by
// blank lines, so two branches adding a module never touch the same hunk.

// -- accounts (src/accounts.rs) --
pub mod accounts;

// -- editor (src/fs.rs) --
pub mod fs;

// -- search (src/search.rs) --
pub mod search;

// -- tool-path (src/tools.rs) --
pub mod tools;

// -- browser (src/browser.rs) --
pub mod browser;
// What a key does in a browser pane and in the app's own webview, on Windows (src/browser_keys.rs).
pub mod browser_keys;

// -- settings (src/settings.rs) --
pub mod settings;
// One JSON object in one file: how settings.json and workspace.json are read and written.
pub mod json_file;

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

// -- diff-comments (src/worktree_diff.rs) --
pub mod worktree_diff;

// -- chrome (src/chrome.rs) --
pub mod chrome;

// -- graph: no Rust --

// -- workspace (src/workspace.rs) --
pub mod workspace;

// -- worktrees (src/worktree.rs) --
pub mod worktree;
// Which programs sit in a worktree, asked before cleaning it up.
pub mod programs;

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

// -- checks (src/checks.rs) --
pub mod checks;

// -- ai-commit-pr (src/commit.rs) --
pub mod commit;

// -- job (src/job.rs) --
pub mod job;
pub mod tools_install;

// -- source-control (src/source_control.rs) --
pub mod source_control;

// -- build info (src/build_info.rs) --
pub mod build_info;

// -- usage (src/usage.rs) --
pub mod usage;

// -- nexus feed (src/nexus_feed.rs): what Nexus v2 reads beyond the snapshot --
pub mod nexus_feed;

// -- app dir (src/app_dir.rs) --
pub mod app_dir;

// -- install review (src/install_review.rs) --
pub mod install_review;

// -- plan-usage (src/plan_usage.rs) --
pub mod plan_usage;

// -- crash (src/crash.rs) --
// The log, a panic written into it, and a start that fails said in a dialog.
pub mod crash;

// -- console (src/console.rs) --
pub mod console;

// -- single instance (src/single_instance.rs) --
// One app per state dir: a second launch brings the running window forward.
pub mod single_instance;

// -- newer release (src/newer_release.rs) --
pub mod newer_release;

// -- test helpers (src/testutil.rs) --
#[cfg(test)]
mod testutil;

use commands::PtyState;
use tauri::Manager;

/// `MNEMO_DESKTOP_SMOKE=1`: spawn the default shell, send `exit`, and exit the app with 0
/// when the PTY reports the shell ended within 5 s, 1 otherwise. Used by CI, on every OS.
fn run_smoke(app: &tauri::App) -> Result<(), String> {
    let state = app.state::<PtyState>();
    let (tx, rx) = std::sync::mpsc::channel();
    let id = state.0.spawn(
        pty::SpawnOptions { program: None, args: vec![], cwd: None, cols: 80, rows: 24, login: true },
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
    )?;
    if cfg!(windows) {
        // A pseudoconsole asks where the cursor is before the shell starts; xterm.js answers it
        // in the app, nobody does here. Enter is `\r`, as a terminal sends it.
        state.0.write(id, b"\x1b[1;1R")?;
        state.0.write(id, b"exit\r")?;
    } else {
        state.0.write(id, b"exit\n")?;
    }
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
    crash::init_log();
    crash::install_panic_hook();
    crash::starting();
    // Before any window: a second launch on the same state brings the first one forward and
    // ends here, with nothing opened or restored (#366).
    let instance = match single_instance::claim(&app_dir::app_dir(), std::time::Duration::from_secs(5)) {
        Ok(single_instance::Claim::First(primary)) => Some(primary),
        Ok(single_instance::Claim::HandedOff) => {
            log::info!("mnemo is already running on {}: brought it forward", app_dir::app_dir().display());
            return;
        }
        Ok(single_instance::Claim::Silent) => {
            crash::failed_start(&format!(
                "mnemo is already running on {}, and it did not come forward. Close it (or end it in the task manager) and start mnemo again.",
                app_dir::app_dir().display()
            ));
            std::process::exit(1);
        }
        // A dir or loopback socket the app cannot use: it runs as it did before the check.
        Err(e) => {
            log::warn!("could not check for a running mnemo ({e}); starting anyway");
            None
        }
    };
    let ran = tauri::Builder::default()
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
            pty::shells::pty_shells,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_list,
            commands::pty_attach,
            // Feature commands, one block each, blank-line separated (see the
            // module anchors at the top of this file).

            // -- accounts commands --
            accounts::accounts_list,
            accounts::accounts_switch,
            accounts::accounts_add,
            accounts::accounts_rename,
            accounts::accounts_remove,
            accounts::accounts_share,
            accounts::accounts_panes,
            accounts::accounts_move_pane,

            // -- editor commands --
            fs::fs_read,
            fs::fs_load,
            fs::fs_write,
            fs::fs_list,

            // -- search commands --
            search::search_worktree,

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
            browser::system_open,
            browser::browser_data_store,
            browser::browser_save_shot,
            browser_keys::browser_chords,

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

            // -- diff-comments commands --
            worktree_diff::worktree_diff_files,
            worktree_diff::worktree_diff_file,

            // -- chrome commands --
            chrome::chrome_session,
            chrome::chrome_claude_running,
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

            // -- checks commands --
            checks::checks_read,
            checks::checks_details,
            checks::checks_merge,
            checks::checks_ready,

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
            tools_install::tools_mnemo_latest,

            // -- source-control commands --
            source_control::source_control_status,
            source_control::source_control_stage,
            source_control::source_control_unstage,
            source_control::source_control_discard,
            source_control::source_control_watch,

            // -- build info commands --
            build_info::app_build_info,
            newer_release::app_newer_release,

            // -- usage commands --
            usage::usage_log,

            // -- nexus commands --
            nexus_feed::nexus_feed,

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

            // -- plan-usage commands --
            plan_usage::plan_usage,
        ])
        .setup(|app| {
            match std::env::var_os("MNEMO_DESKTOP_SMOKE") {
                // A picture of the window instead of the shell (mcp.rs).
                Some(v) if v == "snapshot" => mcp::smoke_snapshot(app.handle().clone()),
                Some(_) => run_smoke(app)?,
                None => {}
            }

            // -- accounts --
            // Every Claude Code account's shared links and MCP servers in step (src/accounts.rs).
            accounts::start(app.handle());

            // -- agent hooks --
            // Claude Code's hooks tell the app where each session is (src/agent_hooks.rs).
            agent_hooks::start(app.handle())?;

            // -- voice --
            // Loads the dictation model in the background if it is on disk (src/voice.rs).
            voice::warm(app.handle());

            // -- app webview --
            // The app, not a web page: on Windows F5 does not reload it (src/browser_keys.rs).
            if let Some(main) = app.get_webview("main") {
                browser_keys::no_browser_keys(&main);
            }

            // -- menu --
            // App chords as native menu accelerators: ⌘W and ⇧⌘W reach the drawer's claim through
            // them (`src/nexus/drawer/keys.ts`), and the default menu's File > Close Window would
            // take ⌘W otherwise. Each item emits `app://action` with its action id;
            // `src/actions/keys.ts` runs it (and reads this table in its test, so keep one
            // `("id", "Title", "Accelerator")` tuple per line). macOS only: other platforms would
            // grow a visible menu bar, and keep the keydown handler.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
                use tauri::Emitter;

                const FILE: &[(&str, &str, &str)] = &[
                    ("pane.close", "Close", "CmdOrCtrl+W"),
                    ("tab.close", "Close Tab", "CmdOrCtrl+Shift+W"),
                ];
                const VIEW: &[(&str, &str, &str)] = &[
                    ("dictation.toggle", "Toggle Dictation", "CmdOrCtrl+E"),
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
                    .items(&[&app_menu, &submenu("File", FILE)?.build()?, &edit, &view, &window])
                    .build()?;
                app.set_menu(menu)?;
                app.on_menu_event(|app, event| {
                    if let Some(id) = event.id().as_ref().strip_prefix(PREFIX) {
                        let _ = app.emit_to("main", "app://action", serde_json::json!({ "id": id }));
                    }
                });
            }

            // -- single instance --
            if let Some(primary) = instance {
                let handle = app.handle().clone();
                primary.serve(move || {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            crash::started();
            Ok(())
        })
        // The shells outlive the window: the daemon keeps them for the next launch (src/pty.rs).
        // Only terminals the app held itself, with no daemon to hand them to, end here.
        .on_window_event(|window, event| match event {
            // Where they do end with the window, it asks first when one is running something (#338).
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if let Some(question) = pty::closing::question(&window.state::<PtyState>().0.busy()) {
                    api.prevent_close();
                    ask_to_close(window, question);
                }
            }
            tauri::WindowEvent::Destroyed => window.state::<PtyState>().0.release(),
            _ => {}
        })
        .run(tauri::generate_context!());
    // `build` failing (a plugin, the event loop) is the one failed start Tauri returns rather
    // than panics on (`crash::install_panic_hook`).
    if let Err(e) = ran {
        crash::failed_start(&e.to_string());
        std::process::exit(1);
    }
}

/// Asks `question` over a window that was asked to close, and closes it on a yes. One question
/// at a time: a second click on the close button while it is up asks nothing more.
fn ask_to_close(window: &tauri::Window, question: String) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    static ASKING: AtomicBool = AtomicBool::new(false);
    if ASKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let closing = window.clone();
    window
        .dialog()
        .message(question)
        .title("Close mnemo?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("End them and close".into(), "Keep open".into()))
        .parent(window)
        .show(move |close| {
            ASKING.store(false, Ordering::SeqCst);
            if close {
                // Past the question: `destroy` does not ask the window again.
                let _ = closing.destroy();
            }
        });
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

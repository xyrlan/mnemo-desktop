//! What a Windows pane takes as Enter (#331). The app types commands into a pane's shell, and
//! ended three of them with a line feed: `claude --resume <id>` at launch among them, the only
//! thing that brings a session back where no terminal daemon keeps it running. Here the app's own
//! `PtyManager` starts the default shell, `%COMSPEC%`, on a real ConPTY and types into it.
//!
//! `echo MNEMO^_RAN` shows on screen as typed, caret included; only cmd running it prints
//! `MNEMO_RAN`.

#![cfg(windows)]

use std::sync::mpsc;
use std::time::{Duration, Instant};

use mnemo_desktop_lib::pty::{Event, PtyManager, SpawnOptions};

const RAN: &str = "MNEMO_RAN";

/// Types `echo MNEMO^_RAN` and `enter` into a fresh default shell, and says whether it ran
/// within `wait`, with everything the pane printed.
fn typed_runs(enter: &str, wait: Duration) -> (bool, String) {
    let m = PtyManager::with_shell_dir(None);
    let (tx, rx) = mpsc::channel();
    let id = m
        .spawn(
            SpawnOptions { program: None, args: vec![], cwd: None, cols: 120, rows: 30, login: false },
            Box::new(move |e| {
                let _ = tx.send(e);
            }),
        )
        .expect("spawn the default shell");
    let mut out = String::new();
    // ConPTY opens by asking where the cursor is (`CSI 6 n`) and holds everything until a
    // terminal answers; in the app xterm.js does.
    let mut answered = 0;
    let mut read = |until: Instant, out: &mut String, stop: &dyn Fn(&str) -> bool| {
        while Instant::now() < until && !stop(out.as_str()) {
            if let Ok(Event::Output(b)) = rx.recv_timeout(Duration::from_millis(100)) {
                out.push_str(&String::from_utf8_lossy(&b));
            }
            while let Some(at) = out[answered..].find("\x1b[6n") {
                answered += at + 4;
                m.write(id, b"\x1b[1;1R").expect("answer the cursor report");
            }
        }
    };
    // The prompt first, as the app waits for it (`PROMPT_DELAY_MS`).
    read(Instant::now() + Duration::from_secs(20), &mut out, &|o: &str| o.contains('>'));
    assert!(out.contains('>'), "no prompt from the default shell: {out:?}");
    m.write(id, format!("echo MNEMO^_RAN{enter}").as_bytes()).expect("write");
    read(Instant::now() + wait, &mut out, &|o: &str| o.contains(RAN));
    m.kill(id);
    (out.contains(RAN), out)
}

#[test]
fn a_carriage_return_runs_the_typed_command() {
    let (ran, out) = typed_runs("\r", Duration::from_secs(20));
    assert!(ran, "cmd did not run a command ended with \\r: {out:?}");
}

#[test]
fn a_line_feed_does_not_run_the_typed_command() {
    let (ran, out) = typed_runs("\n", Duration::from_secs(5));
    assert!(!ran, "cmd ran a command ended with \\n, so #331's reason for typing \\r is wrong: {out:?}");
}

//! What is left to read when something goes wrong (#364): the log, a panic written into it, a
//! start that fails said in a dialog, and a read that panicked answered as an error.
//!
//! A release build writes its log to `LOG_FILE` in the app dir on every platform: a Windows
//! release build has no console (`windows_subsystem = "windows"`) and an app opened from Finder
//! has a stderr nobody reads. A debug build keeps stderr, the terminal that ran `pnpm tauri dev`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;

/// The log a release build keeps, in the app dir.
pub const LOG_FILE: &str = "app.log";
/// Past this at a start, the log starts over.
const LOG_MAX: u64 = 1024 * 1024;

/// Where the log goes: the file, or why there is none.
static LOG_AT: OnceLock<Result<PathBuf, String>> = OnceLock::new();

/// The log goes to `LOG_FILE`, warnings and errors, in a release build, and to stderr, errors
/// only, in a debug build or when the file cannot be opened. `RUST_LOG` says more in either.
/// CI's smoke run is a release build whose stderr is the job's log: it keeps stderr.
pub fn init_log() {
    let file = (!cfg!(debug_assertions) && !smoke()).then(|| crate::app_dir::app_dir().join(LOG_FILE));
    init_log_to(file);
}

/// `MNEMO_DESKTOP_SMOKE` (`run_smoke` in lib.rs): nobody is at the screen, the exit code speaks.
fn smoke() -> bool {
    std::env::var_os("MNEMO_DESKTOP_SMOKE").is_some()
}

fn init_log_to(file: Option<PathBuf>) {
    let mut log = env_logger::Builder::new();
    log.filter_level(log::LevelFilter::Error);
    let at = match file {
        None => Err("it went to the terminal that started the app".to_string()),
        Some(path) => match log_file(&path, LOG_MAX) {
            Ok(f) => {
                log.filter_level(log::LevelFilter::Warn).target(env_logger::Target::Pipe(Box::new(f)));
                Ok(path)
            }
            Err(e) => Err(format!("{} could not be opened: {e}", path.display())),
        },
    };
    let _ = LOG_AT.set(at);
    let _ = log.parse_default_env().try_init();
}

/// `path` open to be added to, started over when it has passed `max` bytes.
fn log_file(path: &std::path::Path, max: u64) -> std::io::Result<std::fs::File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if std::fs::metadata(path).is_ok_and(|m| m.len() > max) {
        std::fs::remove_file(path)?;
    }
    std::fs::OpenOptions::new().create(true).append(true).open(path)
}

/// Where a person reads what happened, as a sentence.
fn where_to_read() -> String {
    match LOG_AT.get() {
        Some(Ok(path)) => format!("What happened is written in {}.", path.display()),
        Some(Err(why)) => format!("No log file holds it: {why}."),
        None => "No log was started.".into(),
    }
}

/// Not the app (a test, a helper), the app starting, the app up.
const NOT_THE_APP: u8 = 0;
const STARTING: u8 = 1;
const STARTED: u8 = 2;
static STATE: AtomicU8 = AtomicU8::new(NOT_THE_APP);

/// The app is starting: from here a panic on the main thread is a start that failed.
pub fn starting() {
    STATE.store(STARTING, Ordering::SeqCst);
}

/// The window and `setup` are done: a panic now is a crash, not a failed start.
pub fn started() {
    STATE.store(STARTED, Ordering::SeqCst);
}

/// Every panic, on every thread, is written to the log with its thread and place, before the
/// default hook prints it to stderr. Tauri reports a `setup`, window or WebView2 creation that
/// failed as a panic on the main thread ("Failed to setup app: …"), never as `run`'s `Err`: a
/// panic there before `started` is a start that failed, and says so in a dialog.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("unnamed");
        let payload = info.payload();
        let what = payload.downcast_ref::<&str>().copied().or_else(|| payload.downcast_ref::<String>().map(String::as_str)).unwrap_or("(no message)");
        let at = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_else(|| "an unknown place".into());
        let line = format!("panic on thread '{name}' at {at}: {what}");
        let trace = std::backtrace::Backtrace::capture();
        if trace.status() == std::backtrace::BacktraceStatus::Captured {
            log::error!("{line}\n{trace}");
        } else {
            log::error!("{line}");
        }
        log::logger().flush();
        default(info);
        if fails_the_start(STATE.load(Ordering::SeqCst), name) {
            say_failed_start(what);
        }
    }));
}

/// Whether a panic on thread `name` in `state` is the app failing to start.
fn fails_the_start(state: u8, name: &str) -> bool {
    state == STARTING && name == "main"
}

/// A start that failed: written to the log, and said in a dialog that names the log. Returns
/// once the dialog is closed.
pub fn failed_start(reason: &str) {
    log::error!("mnemo could not start: {reason}");
    log::logger().flush();
    say_failed_start(reason);
}

/// Once: on macOS the setup panic crosses Objective-C and a second one, "panic in a function
/// that cannot unwind", follows it on the main thread before the process aborts.
fn say_failed_start(reason: &str) {
    static SAID: AtomicBool = AtomicBool::new(false);
    if smoke() || SAID.swap(true, Ordering::SeqCst) {
        return;
    }
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("mnemo could not start")
        .set_description(format!("{reason}\n\n{}", where_to_read()))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
}

/// What a read that panicked answers instead of an empty one. The panic itself, with its
/// place, is already in the log (`install_panic_hook`).
pub fn panicked(what: &str, e: impl std::fmt::Display) -> String {
    format!("{what} stopped on an internal error ({e}). {}", where_to_read())
}

/// `f` on the blocking pool; a panic in it is an `Err` that says so, not a default value.
pub async fn read<T: Send + 'static>(what: &'static str, f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| panicked(what, e))
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    #[test]
    fn the_log_file_is_added_to_and_starts_over_once_too_long() {
        let path = crate::testutil::temp_dir("log").join("app/app.log");
        super::log_file(&path, 8).unwrap().write_all(b"one\n").unwrap();
        super::log_file(&path, 8).unwrap().write_all(b"two\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\n");
        super::log_file(&path, 8).unwrap().write_all(b"three\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "one\ntwo\nthree\n");
        super::log_file(&path, 8).unwrap().write_all(b"four\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "four\n");
    }

    /// Set in the copy of this test binary that `a_panic_on_any_thread_lands_in_the_log` runs:
    /// the logger and the panic hook are once per process.
    const CHILD_LOG: &str = "MNEMO_TEST_CRASH_LOG";

    #[test]
    fn a_panic_on_any_thread_lands_in_the_log_with_where() {
        if let Some(path) = std::env::var_os(CHILD_LOG) {
            super::init_log_to(Some(path.into()));
            super::install_panic_hook();
            log::info!("an info line stays out of the file");
            log::warn!("a warning goes in");
            let worker = std::thread::Builder::new().name("worker".into()).spawn(|| panic!("a deliberate panic")).unwrap();
            assert!(worker.join().is_err());
            return;
        }
        let log = crate::testutil::temp_dir("crash").join("app.log");
        let out = crate::proc::command(std::env::current_exe().unwrap())
            .args(["--exact", "crash::tests::a_panic_on_any_thread_lands_in_the_log_with_where", "--nocapture", "--test-threads=1"])
            .env(CHILD_LOG, &log)
            .env_remove("RUST_LOG")
            .env_remove("RUST_BACKTRACE")
            .output()
            .unwrap();
        assert!(out.status.success(), "the child failed: {}", String::from_utf8_lossy(&out.stderr));
        let text = std::fs::read_to_string(&log).unwrap();
        let place = format!("panic on thread 'worker' at {}:", file!());
        assert!(text.contains(&place) && text.contains("a deliberate panic"), "{place:?} not in the log:\n{text}");
        assert!(text.contains("a warning goes in"), "{text}");
        assert!(!text.contains("an info line"), "{text}");
    }

    #[test]
    fn only_a_main_thread_panic_while_starting_is_a_failed_start() {
        assert!(super::fails_the_start(super::STARTING, "main"));
        assert!(!super::fails_the_start(super::STARTED, "main"));
        assert!(!super::fails_the_start(super::NOT_THE_APP, "main"));
        assert!(!super::fails_the_start(super::STARTING, "tokio-runtime-worker"));
    }

    #[test]
    fn a_read_that_panics_is_an_error_not_an_empty_answer() {
        let ok = tauri::async_runtime::block_on(super::read("the test read", || 7));
        assert_eq!(ok, Ok(7));
        let failed = tauri::async_runtime::block_on(super::read("the test read", || -> Vec<u8> { panic!("deliberate") }));
        let e = failed.unwrap_err();
        assert!(e.starts_with("the test read stopped on an internal error"), "{e}");
    }
}

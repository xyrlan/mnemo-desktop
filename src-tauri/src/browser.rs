//! Leaving the app: a web page opened in the user's own browser, a file or folder in the system's
//! own app. Each target is checked before it goes, and handed over as a plain argument, never
//! through a shell.

use tauri::Url;

/// Opens `url` in Google Chrome, else the default browser, for pages that need the user's
/// own browser identity. Web pages only: the URL is re-serialised after parsing and passed
/// as a plain argument, never through a shell.
#[tauri::command]
pub async fn browser_open_external(url: String) -> Result<(), String> {
    let target = external(&url)?;
    let launches = external_launches(&target, std::env::consts::OS, |k| std::env::var(k).ok());
    tauri::async_runtime::spawn_blocking(move || run_launches(&launches, "a browser"))
        .await
        .map_err(|e| e.to_string())?
}

/// Opens `path` in the system's own app (spec `2026-10-15-nexus-app-design.md`, Q6): a file in the
/// app its type opens with (a vault page in the system editor), a folder in the file manager. Only
/// an absolute path that exists; it is passed as a plain argument, never through a shell.
#[tauri::command]
pub async fn system_open(path: String) -> Result<(), String> {
    let target = local(&path)?;
    let launches = path_launches(&target.to_string_lossy(), std::env::consts::OS);
    tauri::async_runtime::spawn_blocking(move || run_launches(&launches, "an app for it"))
        .await
        .map_err(|e| e.to_string())?
}

/// What may leave the app for the system's apps: an absolute path that exists.
pub fn local(path: &str) -> Result<std::path::PathBuf, String> {
    let p = std::path::PathBuf::from(path.trim());
    if !p.is_absolute() {
        return Err(format!("refusing to open {path:?} outside the app: not an absolute path"));
    }
    if !p.exists() {
        return Err(format!("{path} does not exist"));
    }
    Ok(p)
}

/// How to hand a path to the system: `open` on macOS (Finder for a folder), the Explorer on
/// Windows (a file opens in its app; it reads only backslashes), `xdg-open` elsewhere.
pub fn path_launches(path: &str, os: &str) -> Vec<Launch> {
    let launch = |program: &str, arg: String, wait| Launch { program: program.to_string(), args: vec![arg], wait };
    match os {
        // Absolute path: apps started from Finder or the Dock get a bare PATH.
        "macos" => vec![launch("/usr/bin/open", path.to_string(), true)],
        // explorer.exe exits 1 even when it opened the path: it is never waited on.
        "windows" => vec![launch("explorer.exe", path.replace('/', "\\"), false)],
        _ => vec![launch("xdg-open", path.to_string(), false)],
    }
}

/// What may leave the app for the system browser: http(s) pages, not `about:blank`.
pub fn external(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url.trim()).map_err(|e| format!("invalid url {url:?}: {e}"))?;
    if matches!(parsed.scheme(), "http" | "https") {
        Ok(parsed)
    } else {
        Err(format!("refusing to open {url:?} outside the app: only http(s) urls are allowed"))
    }
}

/// One way to hand a URL to a browser, tried in order until one works. A `wait` launch
/// reports failure through its exit status (`open -a` exits 1 when the app is missing);
/// the others become the browser process, so they only fail when the program cannot start.
#[derive(Debug, PartialEq)]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub wait: bool,
}

/// Where Windows installs Chrome: for every user, then for this one. Not on PATH, and
/// `CreateProcess` does not read the App Paths registry that `start chrome` uses.
const WINDOWS_CHROME: [&str; 3] = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];

/// `env` reads an environment variable (Windows' install folders).
pub fn external_launches(url: &Url, os: &str, env: impl Fn(&str) -> Option<String>) -> Vec<Launch> {
    let url = url.to_string();
    let launch = |program: &str, args: &[&str], wait| Launch {
        program: program.to_string(),
        args: args.iter().map(|a| a.to_string()).chain([url.clone()]).collect(),
        wait,
    };
    match os {
        // Absolute path: apps started from Finder or the Dock get a bare PATH.
        "macos" => vec![launch("/usr/bin/open", &["-a", "Google Chrome"], true), launch("/usr/bin/open", &[], true)],
        // Chrome first, as the button says, then whatever the default browser is.
        "windows" => WINDOWS_CHROME
            .iter()
            .filter_map(|var| env(var))
            .map(|dir| launch(&format!("{dir}\\Google\\Chrome\\Application\\chrome.exe"), &[], false))
            .chain([launch("rundll32", &["url.dll,FileProtocolHandler"], false)])
            .collect(),
        _ => vec![launch("google-chrome", &[], false), launch("xdg-open", &[], false)],
    }
}

/// Tries each launch in turn; `what` names what none of them could open, for the error.
fn run_launches(launches: &[Launch], what: &str) -> Result<(), String> {
    use std::process::Stdio;
    let mut failures = Vec::new();
    for l in launches {
        let mut cmd = crate::proc::command(&l.program);
        cmd.args(&l.args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        if l.wait {
            match cmd.status() {
                Ok(s) if s.success() => return Ok(()),
                Ok(s) => failures.push(format!("{} exited with {s}", l.program)),
                Err(e) => failures.push(format!("{}: {e}", l.program)),
            }
        } else {
            match cmd.spawn() {
                Ok(mut child) => {
                    // Reap it whenever it exits, so a long-lived browser leaves no zombie.
                    std::thread::spawn(move || child.wait());
                    return Ok(());
                }
                Err(e) => failures.push(format!("{}: {e}", l.program)),
            }
        }
    }
    Err(format!("could not open {what}: {}", failures.join("; ")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_pages_leave_the_app() {
        assert_eq!(external(" https://github.com/o/r/pull/4 ").unwrap().as_str(), "https://github.com/o/r/pull/4");
        assert!(external("http://localhost:3000/").is_ok());
        assert!(external("about:blank").is_err());
        assert!(external("file:///etc/passwd").is_err());
        assert!(external("javascript:alert(1)").is_err());
        assert!(external("x-apple.systempreferences:").is_err());
        assert!(external("github.com").is_err());
    }

    #[test]
    fn chrome_first_then_the_default_browser() {
        let url = Url::parse("https://github.com/o/r/pull/4?x=1&y=2").unwrap();
        let none = |_: &str| None;
        let mac = external_launches(&url, "macos", none);
        assert_eq!(
            mac,
            vec![
                Launch {
                    program: "/usr/bin/open".into(),
                    args: vec!["-a".into(), "Google Chrome".into(), url.to_string()],
                    wait: true
                },
                Launch { program: "/usr/bin/open".into(), args: vec![url.to_string()], wait: true },
            ]
        );
        let linux = external_launches(&url, "linux", none);
        assert_eq!(linux.iter().map(|l| l.program.as_str()).collect::<Vec<_>>(), ["google-chrome", "xdg-open"]);
        assert!(linux.iter().all(|l| !l.wait && l.args == [url.to_string()]));
        // On Windows "Open in Chrome" opened the default browser, Edge on a stock install.
        let env = |k: &str| match k {
            "ProgramFiles" => Some(r"C:\Program Files".to_string()),
            "LOCALAPPDATA" => Some(r"C:\Users\you\AppData\Local".to_string()),
            _ => None,
        };
        let windows = external_launches(&url, "windows", env);
        assert_eq!(
            windows.iter().map(|l| l.program.as_str()).collect::<Vec<_>>(),
            [
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                r"C:\Users\you\AppData\Local\Google\Chrome\Application\chrome.exe",
                "rundll32"
            ]
        );
        assert_eq!(windows[0].args, [url.to_string()]);
        assert_eq!(windows[2].args, ["url.dll,FileProtocolHandler".to_string(), url.to_string()]);
        assert!(windows.iter().all(|l| !l.wait));
        assert_eq!(external_launches(&url, "windows", none).len(), 1);
    }

    /// The paths above are where a real Windows puts Chrome: CI's `windows-latest` image has it
    /// installed for every user. Fails there if the image ever drops Chrome.
    #[cfg(windows)]
    #[test]
    fn chrome_is_found_where_windows_installed_it() {
        let url = Url::parse("https://example.com/").unwrap();
        let launches = external_launches(&url, "windows", |k| std::env::var(k).ok());
        let found: Vec<_> = launches.iter().filter(|l| std::path::Path::new(&l.program).is_file()).collect();
        assert!(!found.is_empty(), "no chrome.exe among {launches:?}");
    }

    #[test]
    fn a_path_opens_in_the_systems_own_app_on_each_os() {
        let one = |os: &str, path: &str| path_launches(path, os).into_iter().map(|l| (l.program, l.args, l.wait)).collect::<Vec<_>>();
        assert_eq!(one("macos", "/Users/you/vault/rule.md"), [("/usr/bin/open".to_string(), vec!["/Users/you/vault/rule.md".to_string()], true)]);
        assert_eq!(one("windows", "C:/Users/you/vault"), [("explorer.exe".to_string(), vec!["C:\\Users\\you\\vault".to_string()], false)]);
        assert_eq!(one("linux", "/home/you/vault"), [("xdg-open".to_string(), vec!["/home/you/vault".to_string()], false)]);
    }

    #[test]
    fn only_an_absolute_path_that_exists_leaves_the_app() {
        let dir = std::env::temp_dir();
        assert_eq!(local(&dir.to_string_lossy()).unwrap(), dir);
        assert!(local("vault/rule.md").unwrap_err().contains("not an absolute path"));
        assert!(local("-a").is_err());
        let gone = dir.join(format!("mnemo-system-open-gone-{}", std::process::id()));
        assert!(local(&gone.to_string_lossy()).unwrap_err().contains("does not exist"));
    }

    #[test]
    fn a_failed_launch_falls_through_and_reports_every_attempt() {
        let missing = |p: &str| Launch { program: p.into(), args: vec![], wait: false };
        let err = run_launches(&[missing("/nonexistent/chrome"), missing("/nonexistent/open")], "a browser").unwrap_err();
        assert!(err.contains("/nonexistent/chrome") && err.contains("/nonexistent/open"), "{err}");
        #[cfg(unix)]
        {
            let exits = |p: &str| Launch { program: p.into(), args: vec![], wait: true };
            assert!(run_launches(&[exits("/usr/bin/false"), exits("/usr/bin/true")], "a browser").is_ok());
        }
    }
}

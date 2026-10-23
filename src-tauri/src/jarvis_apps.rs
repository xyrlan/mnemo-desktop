//! Jarvis opening things (#508): an app from the config's list, a project's page on GitHub, a web
//! address. The model only ever names things: an app by its name or alias, a project Jarvis knows,
//! a page of a closed set. What starts is the config's own executable, with a project's root as
//! its only argument when its entry takes one (decision 1); a URL is http(s) only, in the default
//! browser (decision 2). Anything else is refused with the reason.

use crate::jarvis::{self, JarvisProject};
use std::path::{Path, PathBuf};

/// What `jarvis_apps` tells the panel: an app by name, and whether it takes a project.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct AppEntry {
    pub name: String,
    pub project: bool,
}

/// One entry of the config's `apps` section: `{ name, aliases?, exe, project? }`.
#[derive(Debug, Clone, PartialEq)]
pub struct App {
    pub name: String,
    pub aliases: Vec<String>,
    pub exe: String,
    pub project: bool,
}

/// The `apps` section, empty when absent; an entry without a `name` or an `exe` is an error
/// naming it, since the file is edited by hand.
pub fn parse(section: &serde_json::Value) -> Result<Vec<App>, String> {
    let Some(entries) = section.as_array() else {
        return if section.is_null() { Ok(vec![]) } else { Err("jarvis.json: \"apps\" is not a list".into()) };
    };
    entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let text = |k: &str| e.get(k).and_then(|v| v.as_str()).map(str::trim).filter(|s| !s.is_empty()).map(String::from);
            let name = text("name").ok_or_else(|| format!("jarvis.json: apps[{i}] has no \"name\""))?;
            let exe = text("exe").ok_or_else(|| format!("jarvis.json: apps[{i}] ({name}) has no \"exe\""))?;
            let aliases = e
                .get("aliases")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|s| s.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default();
            Ok(App { name, aliases, exe, project: e.get("project").and_then(|p| p.as_bool()).unwrap_or(false) })
        })
        .collect()
}

/// The app `name` names, by its name or one of its aliases, ignoring case and spaces at the ends.
pub fn find<'a>(apps: &'a [App], name: &str) -> Option<&'a App> {
    let n = name.trim().to_lowercase();
    apps.iter().find(|a| a.name.to_lowercase() == n || a.aliases.iter().any(|x| x.to_lowercase() == n))
}

/// A program to start and its arguments.
#[derive(Debug, PartialEq)]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
}

/// What opening `app` (on `project`) starts, and how to say what was opened. The model chose only
/// the two names: the program is the entry's `exe` (`~` is `home`), and the only argument is the
/// root of a project Jarvis knows, for an entry that takes one.
pub fn plan(apps: &[App], projects: &[JarvisProject], app: &str, project: Option<&str>, home: &Path) -> Result<(Launch, String), String> {
    let entry = find(apps, app).ok_or_else(|| {
        let names = apps.iter().map(|a| a.name.as_str()).collect::<Vec<_>>();
        if names.is_empty() {
            format!("{app:?} is not on Jarvis's list of apps, which is empty (\"apps\" in {})", jarvis::config_path().display())
        } else {
            format!("{app:?} is not on Jarvis's list of apps: {}", names.join(", "))
        }
    })?;
    let program = expand(&entry.exe, home);
    let project = project.map(str::trim).filter(|p| !p.is_empty());
    match project {
        None => Ok((Launch { program, args: vec![] }, entry.name.clone())),
        Some(p) if !entry.project => Err(format!("{} takes no project, so it opens only on its own (asked for {p:?})", entry.name)),
        Some(p) => {
            let known = project_named(projects, p)?;
            // Only an absolute root reaches the command line: nothing that could read as an option.
            if !Path::new(&known.root).is_absolute() {
                return Err(format!("{}'s root {:?} is not an absolute path", known.name, known.root));
            }
            Ok((Launch { program, args: vec![known.root.clone()] }, format!("{} on {}", entry.name, known.name)))
        }
    }
}

/// The project `name` names, else an error that lists the known ones.
fn project_named<'a>(projects: &'a [JarvisProject], name: &str) -> Result<&'a JarvisProject, String> {
    jarvis::find(projects, name).ok_or_else(|| {
        let names = projects.iter().map(|p| p.name.as_str()).collect::<Vec<_>>();
        format!("{name:?} is not a project Jarvis knows: {}", if names.is_empty() { "it knows none".into() } else { names.join(", ") })
    })
}

/// `~/x` or `~\x` under `home`; anything else as written.
fn expand(p: &str, home: &Path) -> String {
    match p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        Some(rest) => home.join(rest).to_string_lossy().to_string(),
        None if p == "~" => home.to_string_lossy().to_string(),
        None => p.to_string(),
    }
}

/// `owner/repo` of a GitHub remote URL: `https://github.com/o/r(.git)`, `git@github.com:o/r.git`
/// or `ssh://git@github.com/o/r.git`. Anything else is not GitHub.
pub fn github_repo(remote: &str) -> Option<String> {
    let r = remote.trim();
    let path = ["https://github.com/", "http://github.com/", "git@github.com:", "ssh://git@github.com/", "git://github.com/"]
        .iter()
        .find_map(|prefix| r.strip_prefix(prefix))
        .or_else(|| r.strip_prefix("https://").and_then(|rest| rest.split_once('@')).and_then(|(_, h)| h.strip_prefix("github.com/")))?;
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.split('/');
    let (owner, repo) = (parts.next()?, parts.next()?);
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    (parts.next().is_none() && ok(owner) && ok(repo)).then(|| format!("{owner}/{repo}"))
}

/// The GitHub page of `repo` (`owner/name`): `repo`, `pr` and `issue` (one by number, else the
/// list), `actions`.
pub fn page_url(repo: &str, page: &str, number: Option<u64>) -> Result<String, String> {
    let base = format!("https://github.com/{repo}");
    match (page, number) {
        ("repo", None) => Ok(base),
        ("actions", None) => Ok(format!("{base}/actions")),
        ("pr", Some(n)) => Ok(format!("{base}/pull/{n}")),
        ("pr", None) => Ok(format!("{base}/pulls")),
        ("issue", Some(n)) => Ok(format!("{base}/issues/{n}")),
        ("issue", None) => Ok(format!("{base}/issues")),
        ("repo" | "actions", Some(n)) => Err(format!("the {page} page takes no number (got {n})")),
        _ => Err(format!("{page:?} is not a page Jarvis opens: repo, pr, issue, actions")),
    }
}

/// How to hand a URL to the default browser, never through a shell.
pub fn default_browser(url: &str, os: &str) -> Launch {
    let (program, mut args) = match os {
        "windows" => ("rundll32", vec!["url.dll,FileProtocolHandler".to_string()]),
        // Absolute path: apps started from Finder or the Dock get a bare PATH.
        "macos" => ("/usr/bin/open", vec![]),
        _ => ("xdg-open", vec![]),
    };
    args.push(url.to_string());
    Launch { program: program.to_string(), args }
}

/// Starts `l` detached, on the login PATH (a bare `code` is `code.cmd` on Windows), and reaps it
/// whenever it exits.
fn start(l: &Launch) -> Result<(), String> {
    use std::process::Stdio;
    let mut cmd = crate::proc::tool(&l.program, &crate::mission::login_path());
    cmd.args(&l.args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("could not start {}: {e}", l.program))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn apps() -> Result<Vec<App>, String> {
    parse(&jarvis::section("apps")?)
}

fn origin(root: &str) -> Result<String, String> {
    let out = crate::proc::command("git")
        .arg("-C")
        .arg(PathBuf::from(root))
        .args(["remote", "get-url", "origin"])
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(format!("{root} has no origin remote: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn jarvis_apps() -> Result<Vec<AppEntry>, String> {
    blocking(|| Ok(apps()?.into_iter().map(|a| AppEntry { name: a.name, project: a.project }).collect())).await
}

/// Opens an app of the list, on a project when its entry takes one; what was opened, in words.
#[tauri::command]
pub async fn jarvis_open_app(app: String, project: Option<String>) -> Result<String, String> {
    blocking(move || {
        let (launch, opened) = plan(&apps()?, &jarvis::projects(), &app, project.as_deref(), &crate::app_dir::home())?;
        start(&launch)?;
        Ok(opened)
    })
    .await
}

/// Opens the project's page on GitHub in the default browser; the URL it opened.
#[tauri::command]
pub async fn jarvis_open_in_browser(project: String, page: String, number: Option<u64>) -> Result<String, String> {
    blocking(move || {
        let projects = jarvis::projects();
        let known = project_named(&projects, &project)?;
        let remote = origin(&known.root)?;
        let repo = github_repo(&remote).ok_or_else(|| format!("{}'s origin is not on GitHub: {remote}", known.name))?;
        let url = page_url(&repo, &page, number)?;
        start(&default_browser(&url, std::env::consts::OS))?;
        Ok(url)
    })
    .await
}

/// Opens a web address in the default browser: http and https only.
#[tauri::command]
pub async fn jarvis_open_url(url: String) -> Result<(), String> {
    let target = crate::browser::external(&url)?;
    blocking(move || start(&default_browser(target.as_str(), std::env::consts::OS))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn config() -> Vec<App> {
        parse(&json!([
            { "name": "VS Code", "aliases": ["code", "o editor"], "exe": "code", "project": true },
            { "name": "Spotify", "exe": "~/AppData/Roaming/Spotify/Spotify.exe" }
        ]))
        .unwrap()
    }

    fn projects(home: &Path) -> Vec<JarvisProject> {
        let root = home.join("code").join("mnemo-src").to_string_lossy().to_string();
        vec![JarvisProject { name: "mnemo-src".into(), aliases: vec!["a cli do mnemo".into()], root }]
    }

    fn home() -> PathBuf {
        if cfg!(windows) { PathBuf::from(r"C:\Users\you") } else { PathBuf::from("/Users/you") }
    }

    #[test]
    fn the_section_lists_names_and_whether_they_take_a_project() {
        let apps = config();
        assert_eq!(apps[0].aliases, ["code", "o editor"]);
        assert!(apps[0].project && !apps[1].project);
        assert_eq!(parse(&serde_json::Value::Null).unwrap(), vec![]);
        assert!(parse(&json!([{ "name": "Sem exe" }])).unwrap_err().contains("Sem exe"));
        assert!(parse(&json!({ "name": "x" })).is_err());
    }

    #[test]
    fn an_app_not_on_the_list_is_refused_with_the_list() {
        let err = plan(&config(), &projects(&home()), "cmd.exe", None, &home()).unwrap_err();
        assert!(err.contains("not on Jarvis's list") && err.contains("VS Code, Spotify"), "{err}");
        let err = plan(&config(), &projects(&home()), r"C:\Windows\System32\cmd.exe", None, &home()).unwrap_err();
        assert!(err.contains("not on Jarvis's list"), "a path is not an app: {err}");
    }

    #[test]
    fn an_app_is_found_by_its_alias_without_case_and_opens_on_its_own() {
        let (launch, opened) = plan(&config(), &projects(&home()), " O Editor ", None, &home()).unwrap();
        assert_eq!(launch, Launch { program: "code".into(), args: vec![] });
        assert_eq!(opened, "VS Code");
        let (launch, _) = plan(&config(), &projects(&home()), "spotify", None, &home()).unwrap();
        assert_eq!(Path::new(&launch.program), home().join("AppData/Roaming/Spotify/Spotify.exe"));
    }

    #[test]
    fn a_project_resolves_through_its_alias_and_is_the_only_argument() {
        let (launch, opened) = plan(&config(), &projects(&home()), "code", Some("A CLI do mnemo"), &home()).unwrap();
        assert_eq!(launch.args, [home().join("code").join("mnemo-src").to_string_lossy().to_string()]);
        assert_eq!(opened, "VS Code on mnemo-src");
    }

    #[test]
    fn a_path_or_argument_outside_the_entry_is_refused() {
        let ps = projects(&home());
        for project in ["--new-window", r"C:\Windows", "../etc", "mnemo-src --disable-extensions"] {
            let err = plan(&config(), &ps, "VS Code", Some(project), &home()).unwrap_err();
            assert!(err.contains("not a project Jarvis knows") && err.contains("mnemo-src"), "{project}: {err}");
        }
        let err = plan(&config(), &ps, "Spotify", Some("mnemo-src"), &home()).unwrap_err();
        assert!(err.contains("takes no project"), "{err}");
        let relative = vec![JarvisProject { name: "odd".into(), aliases: vec![], root: "-rf".into() }];
        assert!(plan(&config(), &relative, "code", Some("odd"), &home()).unwrap_err().contains("not an absolute path"));
    }

    #[test]
    fn a_github_remote_names_its_repository() {
        for remote in [
            "https://github.com/xyz/mnemo-desktop.git",
            "https://github.com/xyz/mnemo-desktop",
            "https://github.com/xyz/mnemo-desktop/",
            "git@github.com:xyz/mnemo-desktop.git",
            "ssh://git@github.com/xyz/mnemo-desktop.git",
            "https://token@github.com/xyz/mnemo-desktop.git",
        ] {
            assert_eq!(github_repo(remote).as_deref(), Some("xyz/mnemo-desktop"), "{remote}");
        }
        for remote in ["https://gitlab.com/xyz/app.git", "https://github.com/xyz", "https://github.com/xyz/app/tree/main", "https://github.com/x y/app", "/srv/git/app.git"] {
            assert_eq!(github_repo(remote), None, "{remote}");
        }
    }

    #[test]
    fn the_page_url_is_built_from_the_repository() {
        let r = "xyz/app";
        assert_eq!(page_url(r, "repo", None).unwrap(), "https://github.com/xyz/app");
        assert_eq!(page_url(r, "pr", Some(42)).unwrap(), "https://github.com/xyz/app/pull/42");
        assert_eq!(page_url(r, "issue", Some(7)).unwrap(), "https://github.com/xyz/app/issues/7");
        assert_eq!(page_url(r, "actions", None).unwrap(), "https://github.com/xyz/app/actions");
        assert_eq!(page_url(r, "pr", None).unwrap(), "https://github.com/xyz/app/pulls");
        assert!(page_url(r, "settings", None).is_err());
        assert!(page_url(r, "repo", Some(1)).is_err());
    }

    #[test]
    fn a_file_or_custom_scheme_url_is_refused() {
        for url in ["file:///C:/Windows/System32/cmd.exe", "vscode://file/c:/x", "javascript:alert(1)", "ms-settings:", "about:blank"] {
            assert!(crate::browser::external(url).is_err(), "{url}");
        }
        let ok = crate::browser::external("https://example.com/a?b=c").unwrap();
        assert_eq!(default_browser(ok.as_str(), "windows").args, ["url.dll,FileProtocolHandler", "https://example.com/a?b=c"]);
        assert_eq!(default_browser("https://x.dev/", "linux"), Launch { program: "xdg-open".into(), args: vec!["https://x.dev/".into()] });
    }
}

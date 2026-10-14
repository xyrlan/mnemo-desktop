//! Which shell a new terminal pane starts (#360). On macOS and Linux it is `$SHELL`, as it always
//! was, and nothing here is asked. On Windows the person chooses among the shells installed —
//! cmd, Windows PowerShell, PowerShell 7 (`pwsh`), Git Bash — and `settings.json`'s
//! `windowsShell` keeps the choice; with none, or one no longer installed, a pane starts
//! `%COMSPEC%` as before.
//!
//! Each shell is found where its installer puts it, never by name on `PATH`: a pane's `PATH` is
//! not the app's (`tools::pane_path`), and a shell picked by name could be another program.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// The settings key.
pub const SETTING: &str = "windowsShell";

/// How the app types into a shell (`src/pty/typed.ts`'s `Shell`): every shell offered is one it
/// can build a line for.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Cmd,
    Powershell,
    Posix,
}

/// A shell found on this machine.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Found {
    /// What `windowsShell` holds: `cmd`, `powershell`, `pwsh` or `git-bash`.
    pub id: &'static str,
    pub label: &'static str,
    pub kind: Kind,
    pub path: String,
}

/// What `pty_shells` answers: the shells offered, and the one a new pane starts now.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct Shells {
    pub shells: Vec<Found>,
    /// The id of the shell a new pane starts, when it is one of `shells`.
    pub current: Option<&'static str>,
    pub kind: Kind,
}

/// The kind of shell `program` is, by its file name: `pwsh.exe`, `powershell`, `-bash`, `zsh`.
pub fn kind_of(program: &str) -> Kind {
    match stem(program).as_str() {
        "cmd" => Kind::Cmd,
        "powershell" | "pwsh" => Kind::Powershell,
        _ => Kind::Posix,
    }
}

/// `program`'s file name, lowercase, without `.exe` or a login shell's leading `-`.
pub fn stem(program: &str) -> String {
    // A Windows path reads with either separator, on whichever system the test runs.
    let name = program.rsplit(['/', '\\']).next().unwrap_or("");
    let name = name.trim_start_matches('-').to_ascii_lowercase();
    name.strip_suffix(".exe").map(str::to_string).unwrap_or(name)
}

/// The shells installed, cmd first, each at the first place it is found. `env` reads a variable,
/// `exists` says whether a file is there.
pub fn installed(env: &dyn Fn(&str) -> Option<String>, exists: &dyn Fn(&Path) -> bool) -> Vec<Found> {
    let under = |var: &str, rest: &[&str]| -> Option<PathBuf> {
        let base = env(var).filter(|v| !v.is_empty())?;
        Some(rest.iter().fold(PathBuf::from(base), |p, part| p.join(part)))
    };
    let system32 = |rest: &[&str]| {
        let mut parts = vec!["System32"];
        parts.extend_from_slice(rest);
        under("SystemRoot", &parts)
    };
    let candidates: [(&str, &str, Kind, Vec<Option<PathBuf>>); 4] = [
        ("cmd", "Command Prompt", Kind::Cmd, vec![env("COMSPEC").filter(|c| stem(c) == "cmd").map(PathBuf::from), system32(&["cmd.exe"])]),
        ("powershell", "Windows PowerShell", Kind::Powershell, vec![system32(&["WindowsPowerShell", "v1.0", "powershell.exe"])]),
        (
            "pwsh",
            "PowerShell 7",
            Kind::Powershell,
            vec![under("ProgramFiles", &["PowerShell", "7", "pwsh.exe"]), under("LOCALAPPDATA", &["Microsoft", "WindowsApps", "pwsh.exe"])],
        ),
        (
            "git-bash",
            "Git Bash",
            Kind::Posix,
            // `bin\bash.exe`, not `usr\bin\bash.exe`: the first sets up Git's PATH, as its own shortcut does.
            vec![
                under("ProgramFiles", &["Git", "bin", "bash.exe"]),
                under("ProgramFiles(x86)", &["Git", "bin", "bash.exe"]),
                under("LOCALAPPDATA", &["Programs", "Git", "bin", "bash.exe"]),
            ],
        ),
    ];
    candidates
        .into_iter()
        .filter_map(|(id, label, kind, places)| {
            let path = places.into_iter().flatten().find(|p| exists(p))?;
            Some(Found { id, label, kind, path: path.to_string_lossy().into_owned() })
        })
        .collect()
}

/// What a new pane starts on Windows: the chosen shell when it is installed, else `%COMSPEC%`
/// (`pty::default_shell`), and which of `shells` that is.
pub fn resolve(choice: Option<&str>, shells: &[Found], default: String) -> (String, Option<&'static str>) {
    if let Some(f) = choice.and_then(|c| shells.iter().find(|f| f.id == c)) {
        return (f.path.clone(), Some(f.id));
    }
    let same = |f: &&Found| f.path.eq_ignore_ascii_case(&default) || (f.id == "cmd" && stem(&default) == "cmd");
    let current = shells.iter().find(same).map(|f| f.id);
    (default, current)
}

fn system_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn chosen() -> Option<String> {
    crate::settings::read().ok()?.get(SETTING)?.as_str().map(str::to_string)
}

/// The program a new terminal pane starts. macOS and Linux: `$SHELL`, the setting unread.
pub fn for_new_pane() -> String {
    if !cfg!(windows) {
        return super::default_shell();
    }
    resolve(chosen().as_deref(), &installed(&system_env, &|p| p.is_file()), super::default_shell()).0
}

/// The shells offered and the one a new pane starts (`pty_shells`). Nothing is offered on macOS
/// or Linux, where a pane starts `$SHELL`.
pub fn list() -> Shells {
    let shells = if cfg!(windows) { installed(&system_env, &|p| p.is_file()) } else { vec![] };
    let (program, current) = if cfg!(windows) { resolve(chosen().as_deref(), &shells, super::default_shell()) } else { (super::default_shell(), None) };
    Shells { kind: kind_of(&program), shells, current }
}

#[tauri::command]
pub fn pty_shells() -> Shells {
    list()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn windows_env() -> HashMap<&'static str, &'static str> {
        HashMap::from([
            ("COMSPEC", r"C:\Windows\system32\cmd.exe"),
            ("SystemRoot", r"C:\Windows"),
            ("ProgramFiles", r"C:\Program Files"),
            ("ProgramFiles(x86)", r"C:\Program Files (x86)"),
            ("LOCALAPPDATA", r"C:\Users\me\AppData\Local"),
        ])
    }

    /// `installed` on a machine whose files are `files`, compared with either separator.
    fn found(env: &HashMap<&str, &str>, files: &[&str]) -> Vec<(&'static str, String)> {
        let norm = |s: &str| s.replace('\\', "/").to_ascii_lowercase();
        let files: Vec<String> = files.iter().map(|f| norm(f)).collect();
        installed(&|v| env.get(v).map(|s| s.to_string()), &|p| files.contains(&norm(&p.to_string_lossy())))
            .into_iter()
            .map(|f| (f.id, norm(&f.path)))
            .collect()
    }

    #[test]
    fn the_shells_offered_are_those_installed_in_their_order() {
        let env = windows_env();
        let all = [
            r"C:\Windows\system32\cmd.exe",
            r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
            r"C:\Program Files\PowerShell\7\pwsh.exe",
            r"C:\Program Files\Git\bin\bash.exe",
        ];
        assert_eq!(
            found(&env, &all),
            vec![
                ("cmd", "c:/windows/system32/cmd.exe".into()),
                ("powershell", "c:/windows/system32/windowspowershell/v1.0/powershell.exe".into()),
                ("pwsh", "c:/program files/powershell/7/pwsh.exe".into()),
                ("git-bash", "c:/program files/git/bin/bash.exe".into()),
            ]
        );
        // A machine with no pwsh and no Git: neither is offered.
        assert_eq!(found(&env, &all[..2]).iter().map(|f| f.0).collect::<Vec<_>>(), ["cmd", "powershell"]);
        // A per-user Git and a Store pwsh are found where those installers put them.
        let elsewhere = [r"C:\Users\me\AppData\Local\Programs\Git\bin\bash.exe", r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\pwsh.exe"];
        assert_eq!(found(&env, &elsewhere).iter().map(|f| f.0).collect::<Vec<_>>(), ["pwsh", "git-bash"]);
    }

    #[test]
    fn cmd_is_found_without_comspec_and_a_comspec_naming_another_program_is_not_cmd() {
        let mut env = windows_env();
        env.remove("COMSPEC");
        assert_eq!(found(&env, &[r"C:\Windows\System32\cmd.exe"]), vec![("cmd", "c:/windows/system32/cmd.exe".into())]);
        env.insert("COMSPEC", r"C:\tools\tcc.exe");
        assert_eq!(found(&env, &[r"C:\tools\tcc.exe"]), vec![]);
    }

    fn shell(id: &'static str, kind: Kind, path: &str) -> Found {
        Found { id, label: id, kind, path: path.into() }
    }

    #[test]
    fn the_choice_is_started_when_installed_and_comspec_otherwise() {
        let comspec = r"C:\Windows\system32\cmd.exe".to_string();
        let shells = [shell("cmd", Kind::Cmd, r"C:\Windows\System32\cmd.exe"), shell("powershell", Kind::Powershell, r"C:\ps\powershell.exe")];
        // No choice: what a pane always started, and cmd is it, whatever the case of its path.
        assert_eq!(resolve(None, &shells, comspec.clone()), (comspec.clone(), Some("cmd")));
        assert_eq!(resolve(Some("powershell"), &shells, comspec.clone()), (r"C:\ps\powershell.exe".into(), Some("powershell")));
        // Chosen, then uninstalled; or a value no version of the app wrote.
        assert_eq!(resolve(Some("git-bash"), &shells, comspec.clone()), (comspec.clone(), Some("cmd")));
        assert_eq!(resolve(Some("fish"), &shells, comspec.clone()), (comspec, Some("cmd")));
        // A COMSPEC that names none of them is still what starts, as before.
        assert_eq!(resolve(None, &shells, r"C:\tools\tcc.exe".into()), (r"C:\tools\tcc.exe".into(), None));
    }

    #[test]
    fn a_shell_is_known_by_its_file_name() {
        assert_eq!(kind_of(r"C:\Windows\system32\CMD.EXE"), Kind::Cmd);
        assert_eq!(kind_of(r"C:\Program Files\PowerShell\7\pwsh.exe"), Kind::Powershell);
        assert_eq!(kind_of("powershell.exe"), Kind::Powershell);
        assert_eq!(kind_of(r"C:\Program Files\Git\bin\bash.exe"), Kind::Posix);
        assert_eq!(kind_of("/bin/zsh"), Kind::Posix);
        assert_eq!(stem("-zsh"), "zsh");
        assert_eq!(stem(r"C:\Program Files\Git\bin\bash.exe"), "bash");
    }

    #[test]
    fn macos_and_linux_offer_nothing_and_start_shell() {
        if cfg!(windows) {
            return;
        }
        assert_eq!(for_new_pane(), super::super::default_shell());
        let l = list();
        assert!(l.shells.is_empty() && l.current.is_none());
    }
}

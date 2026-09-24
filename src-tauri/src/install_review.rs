//! The install review (#180, piece D1 of mnemo's `2026-09-24-install-review-design.md`): the
//! one screen where the user decides what mnemo learned from their Claude Code history.
//!
//! Every `mnemo` call here is spelled out in this file, with only the project name and the
//! page keys coming from the front-end, both checked (`is_project`, `is_key`). The JSON each
//! call prints is the front-end's to read (`src/learned/types.ts`): this side returns stdout,
//! stderr and the exit code, like `vault_run`.
//!
//! Whether a project was already decided has two sources. The app's own record,
//! `install-review.json` in its dir, holds every answer given on this screen: kept, decided
//! later, or not now at the consent step (the last two write nothing to the vault). The
//! vault's `.mnemo/inbox-offers.jsonl` holds a decision taken anywhere with `"via": "review"`,
//! the terminal's `mnemo inbox --review` included.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::job::{JobEvent, EXIT_EVENT, LINE_EVENT};
use crate::vault::RunResult;

/// The repo a working directory belongs to, named as mnemo names it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct ReviewProject {
    /// `resolve_canonical_agent(cwd).name`: the main checkout's folder name, sanitized.
    pub project: String,
    /// The main checkout, where every `mnemo` call of the review runs.
    pub root: String,
}

/// mnemo's `agent._sanitize`: runs of anything but `[A-Za-z0-9._-]` become one `-`, then
/// `-` is trimmed from both ends; nothing left is `root`.
pub fn sanitize(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || "._-".contains(c) {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let t = out.trim_matches('-');
    if t.is_empty() { "root".into() } else { t.into() }
}

/// A project name as `sanitize` leaves it, and never a flag.
pub fn is_project(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && s != "." && s != ".." && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

/// A page key, `<type>/<slug>`: one line, no flag, no traversal.
pub fn is_key(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && !s.contains("..")
        && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:/".contains(c))
}

/// The four one-shot calls of the review.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Step {
    /// `mnemo inbox --origin backfill --project P --json`
    List,
    /// `mnemo backfill --project P --dry-run --json`
    DryRun,
    /// `mnemo inbox --promote --keys-stdin --json`
    Promote,
    /// `mnemo inbox --drop --keys-stdin --json`
    Drop,
}

/// The argv after `mnemo` for `step`, and whether it reads keys on stdin.
pub fn step_args(step: Step, project: &str) -> (Vec<String>, bool) {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    match step {
        Step::List => (a(&["inbox", "--origin", "backfill", "--project", project, "--json"]), false),
        Step::DryRun => (a(&["backfill", "--project", project, "--dry-run", "--json"]), false),
        // The keys name their pages across projects; the cwd (the project's root) is what
        // mnemo records the decision under.
        Step::Promote => (a(&["inbox", "--promote", "--keys-stdin", "--json"]), true),
        Step::Drop => (a(&["inbox", "--drop", "--keys-stdin", "--json"]), true),
    }
}

/// The streamed run, after the user said yes.
pub fn run_args(project: &str) -> Vec<String> {
    ["backfill", "--project", project, "--yes", "--extract", "--progress-json"].iter().map(|s| s.to_string()).collect()
}

/// Checks everything the front-end sent before anything runs.
pub fn check(step: Step, project: &str, keys: &[String]) -> Result<(), String> {
    if !is_project(project) {
        return Err(format!("install review: bad project name {project:?}"));
    }
    match step {
        Step::List | Step::DryRun if !keys.is_empty() => Err("install review: this step takes no keys".into()),
        Step::Promote | Step::Drop if keys.is_empty() => Err("install review: no keys to decide".into()),
        _ => match keys.iter().find(|k| !is_key(k)) {
            Some(k) => Err(format!("install review: bad key {k:?}")),
            None => Ok(()),
        },
    }
}

// ------------------------------------------------------------ decisions --

/// One answer given on this screen.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Decision {
    /// `kept` (Keep selected), `later` (Decide later) or `not-now` (at the consent step).
    pub decision: String,
    /// Unix seconds.
    pub at: u64,
}

pub const DECISIONS: &[&str] = &["kept", "later", "not-now"];

fn read_record(p: &Path) -> BTreeMap<String, Decision> {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Sets `project`'s answer in the record at `p`, keeping every other project's.
pub fn record_at(p: &Path, project: &str, decision: &str, at: u64) -> Result<(), String> {
    if !is_project(project) {
        return Err(format!("install review: bad project name {project:?}"));
    }
    if !DECISIONS.contains(&decision) {
        return Err(format!("install review: {decision:?} is not a decision ({})", DECISIONS.join(", ")));
    }
    let mut all = read_record(p);
    all.insert(project.into(), Decision { decision: decision.into(), at });
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    // Written aside and renamed, so a crash mid-write never loses the other projects' answers.
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, p).map_err(|e| e.to_string())
}

/// Whether the vault's ledger holds a decision of `project` taken through a review.
pub fn ledger_decided(vault: &Path, project: &str) -> bool {
    [".mnemo/inbox-offers.jsonl.1", ".mnemo/inbox-offers.jsonl"].iter().any(|rel| {
        std::fs::read_to_string(vault.join(rel)).is_ok_and(|text| {
            text.lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).any(|row| {
                row["via"] == "review" && row["project"] == project && (row["event"] == "promoted" || row["event"] == "dropped")
            })
        })
    })
}

/// The answer this screen recorded for `project`, else `review` when the vault's ledger holds
/// one, else None.
pub fn decided_at(record: &Path, vault: Option<&Path>, project: &str) -> Option<String> {
    if let Some(d) = read_record(record).remove(project) {
        return Some(d.decision);
    }
    vault.filter(|v| ledger_decided(v, project)).map(|_| "review".into())
}

// ------------------------------------------------------------------ io --

fn record_path() -> PathBuf {
    crate::app_dir::app_dir().join("install-review.json")
}

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The project of `cwd`, or None when it is not in a git repo. Quiet: a cwd macOS guards with a
/// dialog is not probed (`may_probe`), since the launch check runs without a gesture.
pub fn project_of(cwd: &str) -> Option<ReviewProject> {
    if cwd.trim().is_empty() || !crate::mission::may_probe(cwd) {
        return None;
    }
    let root = crate::mission::repo_root(cwd)?;
    let name = Path::new(&root).file_name()?.to_string_lossy().to_string();
    Some(ReviewProject { project: sanitize(&name), root })
}

/// Runs `program <args>` in `cwd` with the app's PATH, `stdin` written to it when given.
pub fn exec(program: &str, path_env: &str, args: &[String], cwd: &str, stdin: Option<&str>) -> RunResult {
    let refuse = |stderr: String| RunResult { stderr, ..Default::default() };
    if !Path::new(cwd).is_dir() {
        return refuse(format!("{cwd}: not a directory"));
    }
    let spawned = crate::proc::command(program)
        .args(args)
        .current_dir(cwd)
        .env("PATH", path_env)
        .env("NO_COLOR", "1")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => return refuse(format!("{program}: {e}")),
    };
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        // A process that exits without reading gives a broken pipe: its own output says why.
        let _ = pipe.write_all(text.as_bytes());
    }
    match child.wait_with_output() {
        Ok(o) => RunResult {
            stdout: crate::vault::strip_ansi(&String::from_utf8_lossy(&o.stdout)),
            stderr: crate::vault::strip_ansi(&String::from_utf8_lossy(&o.stderr)),
            code: o.status.code(),
        },
        Err(e) => refuse(format!("{program}: {e}")),
    }
}

/// `step` for `project`, run in `root` after `check`.
pub fn run_step_with(program: &str, path_env: &str, step: Step, project: &str, root: &str, keys: &[String]) -> RunResult {
    if let Err(stderr) = check(step, project, keys) {
        return RunResult { stderr, ..Default::default() };
    }
    let (args, reads_keys) = step_args(step, project);
    let stdin = reads_keys.then(|| keys.iter().map(|k| format!("{k}\n")).collect::<String>());
    exec(program, path_env, &args, root, stdin.as_deref())
}

// ------------------------------------------------------------ commands --

#[tauri::command]
pub async fn install_review_project(cwd: String) -> Option<ReviewProject> {
    tauri::async_runtime::spawn_blocking(move || project_of(&cwd)).await.ok().flatten()
}

#[tauri::command]
pub async fn install_review_step(step: Step, project: String, root: String, keys: Vec<String>) -> RunResult {
    tauri::async_runtime::spawn_blocking(move || run_step_with("mnemo", &crate::mission::login_path(), step, &project, &root, &keys))
        .await
        .unwrap_or_else(|e| RunResult { stderr: e.to_string(), ..Default::default() })
}

/// The job id the run streams under, on `job-line` / `job-exit`.
pub fn run_id(project: &str) -> String {
    format!("install-review:{project}")
}

/// Starts the harvest and first extraction for `project` in `root`, streamed as `job-line` /
/// `job-exit` under `run_id(project)`. It runs in the core, so closing the screen leaves it
/// running; a second start while it runs is refused.
#[tauri::command]
pub fn install_review_run(app: AppHandle, project: String, root: String) -> Result<String, String> {
    check(Step::List, &project, &[])?;
    let id = run_id(&project);
    let argv: Vec<String> = std::iter::once("mnemo".to_string()).chain(run_args(&project)).collect();
    crate::job::run(
        &id,
        &root,
        &argv,
        Arc::new(move |e| {
            let _ = match e {
                JobEvent::Line(l) => app.emit(LINE_EVENT, l),
                JobEvent::Exit(x) => app.emit(EXIT_EVENT, x),
            };
        }),
    )?;
    Ok(id)
}

/// The recorded answer for `project` (`kept`, `later`, `not-now`, or `review` from the vault's
/// ledger), or None when it was never decided.
#[tauri::command]
pub async fn install_review_decided(project: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || decided_at(&record_path(), crate::vault::vault_root().as_deref(), &project))
        .await
        .ok()
        .flatten()
}

#[tauri::command]
pub fn install_review_record(project: String, decision: String) -> Result<(), String> {
    record_at(&record_path(), &project, &decision, now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    fn strs(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn names_sanitize_as_mnemo_does() {
        assert_eq!(sanitize("clubinho"), "clubinho");
        assert_eq!(sanitize("my repo (old)"), "my-repo-old");
        assert_eq!(sanitize("--x--"), "x");
        assert_eq!(sanitize("çà"), "root");
        assert_eq!(sanitize("mnemo_desktop.v2"), "mnemo_desktop.v2");
    }

    #[test]
    fn projects_and_keys_are_checked_before_anything_runs() {
        assert!(check(Step::List, "clubinho", &[]).is_ok());
        assert!(check(Step::DryRun, "mnemo-desktop", &[]).is_ok());
        assert!(check(Step::Promote, "clubinho", &strs(&["project/clubinho__cron-183", "feedback/b"])).is_ok());
        for bad in ["", "-rf", "..", "a b", "a/b", "$(x)"] {
            assert!(check(Step::List, bad, &[]).is_err(), "{bad:?} passed");
        }
        assert!(check(Step::List, "p", &strs(&["feedback/a"])).is_err());
        assert!(check(Step::Drop, "p", &[]).is_err());
        for bad in ["--all", "../../etc/passwd", "a\nb", "a b", ""] {
            assert!(check(Step::Drop, "p", &strs(&[bad])).is_err(), "{bad:?} passed");
        }
    }

    #[test]
    fn each_step_runs_the_command_the_spec_defines() {
        assert_eq!(step_args(Step::List, "p").0.join(" "), "inbox --origin backfill --project p --json");
        assert_eq!(step_args(Step::DryRun, "p").0.join(" "), "backfill --project p --dry-run --json");
        assert_eq!(step_args(Step::Promote, "p"), (strs(&["inbox", "--promote", "--keys-stdin", "--json"]), true));
        assert_eq!(step_args(Step::Drop, "p"), (strs(&["inbox", "--drop", "--keys-stdin", "--json"]), true));
        assert_eq!(run_args("p").join(" "), "backfill --project p --yes --extract --progress-json");
    }

    #[cfg(unix)]
    #[test]
    fn keys_go_to_stdin_one_per_line_and_the_call_runs_in_the_root() {
        let dir = temp_dir("install-review-run");
        let bin = dir.join("mnemo");
        crate::testutil::write_script(&bin, "#!/bin/sh\necho \"$* in $(pwd)\"\ncat\necho warn >&2\nexit 0\n");
        let root = dir.canonicalize().unwrap();
        let r = run_step_with(&bin.to_string_lossy(), "/usr/bin:/bin", Step::Promote, "p", &root.to_string_lossy(), &strs(&["project/a", "feedback/b"]));
        assert_eq!(
            (r.stdout.as_str(), r.stderr.trim(), r.code),
            (format!("inbox --promote --keys-stdin --json in {}\nproject/a\nfeedback/b\n", root.display()).as_str(), "warn", Some(0))
        );
        // A step without keys reads nothing: stdin is closed, so `cat` ends at once.
        let l = run_step_with(&bin.to_string_lossy(), "/usr/bin:/bin", Step::List, "p", &root.to_string_lossy(), &[]);
        assert_eq!(l.stdout, format!("inbox --origin backfill --project p --json in {}\n", root.display()));
        let refused = run_step_with(&bin.to_string_lossy(), "/usr/bin:/bin", Step::Drop, "p", &root.to_string_lossy(), &strs(&["--all"]));
        assert_eq!((refused.code, refused.stdout.as_str()), (None, ""));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_project_of_a_repo_is_its_main_checkout_folder() {
        let here = env!("CARGO_MANIFEST_DIR");
        let p = project_of(here).expect("the crate is in a git repo");
        // The main checkout, which a worktree (like this one may be) is not under.
        assert!(Path::new(&p.root).join(".git").is_dir(), "{p:?}");
        assert_eq!(p.project, sanitize(Path::new(&p.root).file_name().unwrap().to_str().unwrap()));
        assert_eq!(project_of(""), None);
        let not_repo = temp_dir("install-review-norepo");
        assert_eq!(project_of(&not_repo.to_string_lossy()), None);
    }

    #[test]
    fn answers_are_recorded_per_project_and_read_back() {
        let dir = temp_dir("install-review-record");
        let rec = dir.join("sub").join("install-review.json");
        assert_eq!(decided_at(&rec, None, "clubinho"), None);
        record_at(&rec, "clubinho", "later", 5).unwrap();
        record_at(&rec, "clearframe", "not-now", 6).unwrap();
        record_at(&rec, "clubinho", "kept", 7).unwrap();
        assert_eq!(decided_at(&rec, None, "clubinho").as_deref(), Some("kept"));
        assert_eq!(decided_at(&rec, None, "clearframe").as_deref(), Some("not-now"));
        assert_eq!(decided_at(&rec, None, "mnemo"), None);
        assert!(record_at(&rec, "clubinho", "maybe", 8).is_err());
        assert!(record_at(&rec, "../x", "kept", 8).is_err());
        assert_eq!(decided_at(&rec, None, "clubinho").as_deref(), Some("kept"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_review_decision_in_the_vault_ledger_counts_and_nothing_else_does() {
        let dir = temp_dir("install-review-ledger");
        let rec = dir.join("install-review.json");
        let vault = dir.join("vault");
        std::fs::create_dir_all(vault.join(".mnemo")).unwrap();
        let rows = [
            r#"{"event":"promoted","key":"project/a","project":"clubinho"}"#,
            r#"{"event":"offered","key":"project/b","project":"mnemo","via":"review"}"#,
            r#"{"event":"dropped","key":"project/c","project":"other","via":"review"}"#,
            "not json",
        ];
        std::fs::write(vault.join(".mnemo/inbox-offers.jsonl"), rows.join("\n")).unwrap();
        assert_eq!(decided_at(&rec, Some(&vault), "clubinho"), None, "a promote outside a review");
        assert_eq!(decided_at(&rec, Some(&vault), "mnemo"), None, "an offer is no decision");
        assert_eq!(decided_at(&rec, Some(&vault), "other").as_deref(), Some("review"));
        // The rotated ledger is read too.
        std::fs::write(vault.join(".mnemo/inbox-offers.jsonl.1"), r#"{"event":"promoted","key":"k","project":"clubinho","via":"review"}"#).unwrap();
        assert_eq!(decided_at(&rec, Some(&vault), "clubinho").as_deref(), Some("review"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

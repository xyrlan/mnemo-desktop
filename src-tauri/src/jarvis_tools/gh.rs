//! `gh_*`: GitHub through `gh`, which also writes, so it is never allowed whole. Only the
//! subcommands of `ALLOWED` run, one at a time, in the project's root; every argument is one of
//! `FLAGS` or a number Jarvis checked (`args`). `allowed` refuses anything else before `gh` runs.

use super::GhRun;
use crate::jarvis::JarvisProject;
use std::path::Path;

/// The subcommands Jarvis may run, all of them reads.
pub const ALLOWED: [(&str, &str); 6] = [("pr", "list"), ("pr", "view"), ("pr", "checks"), ("run", "list"), ("issue", "list"), ("issue", "view")];

/// What `gh pr list` returns per PR.
const PR_FIELDS: &str = "number,title,headRefName,isDraft,author,updatedAt";
/// What `gh issue list` returns per issue.
const ISSUE_FIELDS: &str = "number,title,labels,updatedAt";

/// Every argument besides a subcommand and a number.
const FLAGS: [&str; 8] = ["--state", "open", "--limit", "30", "15", "--json", PR_FIELDS, ISSUE_FIELDS];

/// One read, with the number the model gave when it takes one.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Read {
    PrList,
    PrView(Option<u64>),
    PrChecks(Option<u64>),
    RunList,
    IssueList,
    IssueView(u64),
}

/// `gh`'s arguments for `read`.
pub fn args(read: Read) -> Vec<String> {
    let n = |n: Option<u64>| n.map(|n| n.to_string());
    let v: Vec<Option<String>> = match read {
        Read::PrList => ["pr", "list", "--state", "open", "--limit", "30", "--json", PR_FIELDS].map(|s| Some(s.to_string())).to_vec(),
        Read::PrView(num) => vec![Some("pr".into()), Some("view".into()), n(num)],
        Read::PrChecks(num) => vec![Some("pr".into()), Some("checks".into()), n(num)],
        Read::RunList => ["run", "list", "--limit", "15"].map(|s| Some(s.to_string())).to_vec(),
        Read::IssueList => ["issue", "list", "--state", "open", "--limit", "30", "--json", ISSUE_FIELDS].map(|s| Some(s.to_string())).to_vec(),
        Read::IssueView(num) => vec![Some("issue".into()), Some("view".into()), Some(num.to_string())],
    };
    v.into_iter().flatten().collect()
}

/// Whether `args` is a read Jarvis may run: an `ALLOWED` subcommand, then only `FLAGS` and
/// numbers. The error names what was refused.
pub fn allowed(args: &[String]) -> Result<(), String> {
    let (cmd, sub) = match args {
        [c, s, ..] => (c.as_str(), s.as_str()),
        _ => return Err(format!("gh {}: refused, not a read Jarvis may run", args.join(" "))),
    };
    if !ALLOWED.contains(&(cmd, sub)) {
        let list: Vec<String> = ALLOWED.iter().map(|(c, s)| format!("gh {c} {s}")).collect();
        return Err(format!("gh {cmd} {sub}: refused; Jarvis only reads, through {}", list.join(", ")));
    }
    match args[2..].iter().find(|a| !FLAGS.contains(&a.as_str()) && !(a.len() <= 12 && !a.is_empty() && a.bytes().all(|b| b.is_ascii_digit()))) {
        Some(a) => Err(format!("gh {cmd} {sub}: the argument \"{a}\" is refused")),
        None => Ok(()),
    }
}

/// `read` in `p`'s root, through `gh`, once `allowed` passes it.
fn ask(gh: GhRun, p: &JarvisProject, read: Read) -> Result<String, String> {
    let a = args(read);
    allowed(&a)?;
    gh(&a, Path::new(&p.root))
}

/// `read` in `p`'s root: `gh`'s own text.
pub fn run(gh: GhRun, p: &JarvisProject, read: Read) -> Result<String, String> {
    let out = ask(gh, p, read)?;
    Ok(if out.trim().is_empty() { "(nothing)".to_string() } else { out })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pr {
    number: u64,
    title: String,
    #[serde(default)]
    head_ref_name: String,
    #[serde(default)]
    is_draft: bool,
    #[serde(default)]
    author: Option<Author>,
    #[serde(default)]
    updated_at: String,
}

#[derive(serde::Deserialize)]
struct Author {
    login: String,
}

/// `gh pr list --json` as lines: `#12 title (branch; draft; by login; updated 2026-10-22)`.
fn pr_lines(json: &str) -> Result<String, String> {
    let prs: Vec<Pr> = serde_json::from_str(json).map_err(|e| format!("gh pr list: {e}"))?;
    if prs.is_empty() {
        return Ok("no open pull requests".to_string());
    }
    let lines: Vec<String> = prs
        .iter()
        .map(|p| {
            let mut about = vec![p.head_ref_name.clone()];
            if p.is_draft {
                about.push("draft".into());
            }
            if let Some(a) = &p.author {
                about.push(format!("by {}", a.login));
            }
            if let Some(day) = p.updated_at.get(..10) {
                about.push(format!("updated {day}"));
            }
            format!("#{} {} ({})", p.number, p.title, about.join("; "))
        })
        .collect();
    Ok(lines.join("\n"))
}

/// The open pull requests of `p`.
pub fn pr_list(gh: GhRun, p: &JarvisProject) -> Result<String, String> {
    pr_lines(&ask(gh, p, Read::PrList)?)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Issue {
    number: u64,
    title: String,
    #[serde(default)]
    labels: Vec<Label>,
    #[serde(default)]
    updated_at: String,
}

#[derive(serde::Deserialize)]
struct Label {
    name: String,
}

/// `gh issue list --json` as lines: `#12 title (bug; p1; updated 2026-10-22)`.
fn issue_lines(json: &str) -> Result<String, String> {
    let issues: Vec<Issue> = serde_json::from_str(json).map_err(|e| format!("gh issue list: {e}"))?;
    if issues.is_empty() {
        return Ok("no open issues".to_string());
    }
    let lines: Vec<String> = issues
        .iter()
        .map(|i| {
            let mut about: Vec<String> = i.labels.iter().map(|l| l.name.clone()).collect();
            if let Some(day) = i.updated_at.get(..10) {
                about.push(format!("updated {day}"));
            }
            if about.is_empty() {
                format!("#{} {}", i.number, i.title)
            } else {
                format!("#{} {} ({})", i.number, i.title, about.join("; "))
            }
        })
        .collect();
    Ok(lines.join("\n"))
}

/// The open issues of `p`.
pub fn issue_list(gh: GhRun, p: &JarvisProject) -> Result<String, String> {
    issue_lines(&ask(gh, p, Read::IssueList)?)
}

/// The open pull requests of every project, under a heading each (`each_project`).
pub fn pr_list_all(gh: GhRun, projects: &[JarvisProject]) -> String {
    each_project(gh, projects, pr_list)
}

/// The open issues of every project, under a heading each (`each_project`).
pub fn issue_list_all(gh: GhRun, projects: &[JarvisProject]) -> String {
    each_project(gh, projects, issue_list)
}

/// `list` of every project, asked at once, under a heading each; a project `gh` fails on says why.
fn each_project(gh: GhRun, projects: &[JarvisProject], list: fn(GhRun, &JarvisProject) -> Result<String, String>) -> String {
    if projects.is_empty() {
        return "no known projects".to_string();
    }
    let got: Vec<(String, Result<String, String>)> = std::thread::scope(|s| {
        let asks: Vec<_> = projects.iter().map(|p| (p.name.clone(), s.spawn(move || list(gh, p)))).collect();
        asks.into_iter().map(|(n, h)| (n, h.join().unwrap_or_else(|_| Err("gh panicked".to_string())))).collect()
    });
    let parts: Vec<String> = got
        .into_iter()
        .map(|(name, r)| match r {
            Ok(t) => format!("## {name}\n{t}"),
            Err(e) => format!("## {name}\n(gh failed: {e})"),
        })
        .collect();
    parts.join("\n\n")
}

// ------------------------------------------------------------------ io --

/// The real `gh`: no prompt, no colour, no update notice. A read whose exit is not 0 but that
/// printed (`gh pr checks` exits 8 while checks run, 1 when one failed) is its output.
pub fn run_gh(args: &[String], cwd: &Path) -> Result<String, String> {
    let out = crate::proc::tool("gh", &crate::mission::login_path())
        .args(args)
        .current_dir(cwd)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "gh not found in PATH".to_string() } else { format!("gh: {e}") })?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() || !stdout.trim().is_empty() {
        return Ok(stdout);
    }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("gh failed").to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jarvis_tools::tests::{ctx_with, project_at};
    use crate::jarvis_tools::run as tool;
    use serde_json::json;
    use std::sync::Mutex;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn only_the_read_subcommands_pass() {
        for read in [Read::PrList, Read::PrView(None), Read::PrView(Some(12)), Read::PrChecks(Some(3)), Read::RunList, Read::IssueList, Read::IssueView(7)] {
            assert_eq!(allowed(&args(read)), Ok(()), "{read:?}");
        }
        for write in [
            &["pr", "merge", "12"][..],
            &["pr", "create"],
            &["pr", "close", "1"],
            &["pr", "comment", "1"],
            &["issue", "create"],
            &["issue", "edit", "4"],
            &["run", "rerun", "9"],
            &["repo", "delete"],
            &["api", "repos"],
            &["release", "create"],
            &["pr"],
            &[],
        ] {
            let e = allowed(&s(write)).unwrap_err();
            assert!(e.contains("refused"), "{write:?}: {e}");
        }
        // A read subcommand with an argument Jarvis never builds.
        for extra in [&["pr", "view", "12", "--web"][..], &["pr", "view", "-R", "other/repo"], &["issue", "view", "1;rm"], &["pr", "list", "--json", "body"], &["issue", "list", "--json", "body"], &["issue", "list", "--state", "all"]] {
            assert!(allowed(&s(extra)).unwrap_err().contains("is refused"), "{extra:?}");
        }
    }

    #[test]
    fn a_tool_runs_its_one_read_in_the_projects_root() {
        let dir = crate::testutil::temp_dir("jarvis-gh");
        let seen: Mutex<Vec<(Vec<String>, std::path::PathBuf)>> = Mutex::new(vec![]);
        let gh = |a: &[String], cwd: &Path| {
            seen.lock().unwrap().push((a.to_vec(), cwd.to_path_buf()));
            Ok("out".to_string())
        };
        let ctx = ctx_with(vec![project_at("app", &dir)], &gh);
        assert_eq!(tool("gh_pr_view", &json!({ "project": "app", "number": "#12" }), &ctx).unwrap(), "out");
        tool("gh_pr_checks", &json!({ "project": "app" }), &ctx).unwrap();
        tool("gh_run_list", &json!({ "project": "app" }), &ctx).unwrap();
        tool("gh_issue_view", &json!({ "project": "app", "number": 5 }), &ctx).unwrap();
        assert!(tool("gh_issue_view", &json!({ "project": "app" }), &ctx).unwrap_err().contains("number"));
        let seen = seen.into_inner().unwrap();
        let cmds: Vec<String> = seen.iter().map(|(a, _)| a.join(" ")).collect();
        assert_eq!(cmds, ["pr view 12", "pr checks", "run list --limit 15", "issue view 5"]);
        assert!(seen.iter().all(|(_, cwd)| cwd == &dir));
    }

    #[test]
    fn pr_list_without_a_project_covers_every_project() {
        let (a, b) = (crate::testutil::temp_dir("jarvis-gh-a"), crate::testutil::temp_dir("jarvis-gh-b"));
        let a2 = a.clone();
        let gh = move |args: &[String], cwd: &Path| {
            assert_eq!(args[..2], s(&["pr", "list"])[..]);
            if cwd == a2 {
                Ok(r#"[{"number":7,"title":"Fix it","headRefName":"fix/it","isDraft":true,"author":{"login":"you"},"updatedAt":"2026-10-22T10:00:00Z"}]"#.to_string())
            } else {
                Err("no git remotes found".to_string())
            }
        };
        let ctx = ctx_with(vec![project_at("alpha", &a), project_at("beta", &b)], &gh);
        let got = tool("gh_pr_list", &json!({}), &ctx).unwrap();
        assert_eq!(got, "## alpha\n#7 Fix it (fix/it; draft; by you; updated 2026-10-22)\n\n## beta\n(gh failed: no git remotes found)");
        let one = tool("gh_pr_list", &json!({ "project": "beta" }), &ctx).unwrap_err();
        assert_eq!(one, "no git remotes found");
    }

    #[test]
    fn issue_list_reads_the_open_issues_of_one_project_or_all() {
        let (a, b) = (crate::testutil::temp_dir("jarvis-gh-ia"), crate::testutil::temp_dir("jarvis-gh-ib"));
        let a2 = a.clone();
        let gh = move |args: &[String], cwd: &Path| {
            assert_eq!(args.join(" "), "issue list --state open --limit 30 --json number,title,labels,updatedAt");
            if cwd == a2 {
                Ok(r#"[{"number":12,"title":"Login preso","labels":[{"name":"bug"},{"name":"p1"}],"updatedAt":"2026-10-22T10:00:00Z"},{"number":3,"title":"Docs","labels":[],"updatedAt":""}]"#.to_string())
            } else {
                Ok("[]".to_string())
            }
        };
        let ctx = ctx_with(vec![project_at("alpha", &a), project_at("beta", &b)], &gh);
        assert_eq!(tool("gh_issue_list", &json!({ "project": "alpha" }), &ctx).unwrap(), "#12 Login preso (bug; p1; updated 2026-10-22)\n#3 Docs");
        assert_eq!(tool("gh_issue_list", &json!({}), &ctx).unwrap(), "## alpha\n#12 Login preso (bug; p1; updated 2026-10-22)\n#3 Docs\n\n## beta\nno open issues");
    }
}

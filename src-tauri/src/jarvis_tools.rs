//! Jarvis's read tools (#505, decision 1): the closed set the panel runs for the model, exactly
//! `READ_TOOLS` in `src/jarvis/client.ts`, with the arguments `TOOLS` declares in
//! `src/jarvis/routing.ts`. Never a shell: git, files and search inside a project's root, mnemo's
//! briefings, rules and sessions, and `gh` one read-only subcommand at a time (`gh`). Secret files
//! are refused even inside a project (`paths`). What a tool returns is text for the model, at most
//! `MAX_CHARS`, saying where it was cut.
//!
//! A project is one of `jarvis::projects()`, named by the model through `jarvis::find`; an
//! unknown one is an error that lists the known names, so the model can correct itself.
//!
//! `jarvis_focused_window` (`window`) is the title of the window the maintainer was in before
//! this app, for the panel to tell which project a request is about (#505, decision 2).

mod files;
mod gh;
mod git;
mod mnemo;
mod paths;
mod window;

use crate::jarvis::JarvisProject;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub use window::focused_window;

/// The read tools, as `READ_TOOLS` in `client.ts` names them.
pub const READ_TOOLS: [&str; 14] = [
    "git_status",
    "git_log",
    "git_diff",
    "read_file",
    "list_dir",
    "search",
    "read_briefings",
    "query_rules",
    "list_sessions",
    "gh_pr_list",
    "gh_pr_view",
    "gh_pr_checks",
    "gh_run_list",
    "gh_issue_view",
];

/// The most a tool hands the model, in characters, the cut's note included.
pub const MAX_CHARS: usize = 12_000;

/// Runs `gh` with these arguments in a directory: its output, or a one-line reason.
pub type GhRun<'a> = &'a (dyn Fn(&[String], &Path) -> Result<String, String> + Sync);

/// What the tools read besides the project's files: the world, in tests a stand-in.
pub struct Ctx<'a> {
    pub projects: Vec<JarvisProject>,
    /// mnemo's vault, None when there is none.
    pub vault: Option<PathBuf>,
    pub gh: GhRun<'a>,
    /// The repositories the desktop knows sessions in, as the mission poll groups them.
    pub sessions: &'a dyn Fn() -> Result<Vec<crate::mission::RepoGroup>, String>,
    /// Today, `YYYY-MM-DD`: where `read_briefings`' "yesterday" counts from.
    pub today: String,
}

/// Runs the read tool `name` over `args`, the model's arguments: its output for the model, at
/// most `MAX_CHARS`. A refusal, a bad argument or a failure is the error, as text for the model.
pub fn run(name: &str, args: &Value, ctx: &Ctx) -> Result<String, String> {
    let a = Args(args);
    let out = match name {
        "git_status" => git::status(project(ctx, &a)?),
        "git_log" => git::log(project(ctx, &a)?, a.int("limit")?),
        "git_diff" => git::diff(project(ctx, &a)?, a.str("path")?),
        "read_file" => files::read(project(ctx, &a)?, a.need_str("path")?),
        "list_dir" => files::list(project(ctx, &a)?, a.str("path")?.unwrap_or("")),
        "search" => files::search(project(ctx, &a)?, a.need_str("query")?),
        "read_briefings" => mnemo::briefings(vault(ctx)?, project(ctx, &a)?, a.str("since")?, &ctx.today),
        "query_rules" => mnemo::rules(vault(ctx)?, maybe_project(ctx, &a)?, a.need_str("query")?),
        "list_sessions" => mnemo::sessions(&(ctx.sessions)()?, maybe_project(ctx, &a)?, &ctx.projects),
        "gh_pr_list" => match maybe_project(ctx, &a)? {
            Some(p) => gh::pr_list(ctx.gh, p),
            None => Ok(gh::pr_list_all(ctx.gh, &ctx.projects)),
        },
        "gh_pr_view" => gh::run(ctx.gh, project(ctx, &a)?, gh::Read::PrView(a.number()?)),
        "gh_pr_checks" => gh::run(ctx.gh, project(ctx, &a)?, gh::Read::PrChecks(a.number()?)),
        "gh_run_list" => gh::run(ctx.gh, project(ctx, &a)?, gh::Read::RunList),
        "gh_issue_view" => match a.number()? {
            Some(n) => gh::run(ctx.gh, project(ctx, &a)?, gh::Read::IssueView(n)),
            None => Err("gh_issue_view needs the issue's number".to_string()),
        },
        _ => Err(format!("{name} is not one of Jarvis's read tools: {}", READ_TOOLS.join(", "))),
    };
    out.map(|t| cap(&t, MAX_CHARS)).map_err(|e| cap(&e, MAX_CHARS))
}

/// `text`, or its start and a note saying where it was cut, `max` characters in all. The cut
/// falls at the end of a line when one ends in the last half of what fits.
pub fn cap(text: &str, max: usize) -> String {
    let total = text.chars().count();
    if total <= max {
        return text.to_string();
    }
    let note = |shown: usize| format!("\n[cut here: {shown} of {total} characters shown]");
    let budget = max.saturating_sub(note(total).chars().count());
    let mut end = text.char_indices().nth(budget).map_or(text.len(), |(i, _)| i);
    if let Some(nl) = text[..end].rfind('\n') {
        if nl >= end / 2 {
            end = nl;
        }
    }
    format!("{}{}", &text[..end], note(text[..end].chars().count()))
}

/// The known projects, for an error: `a, b (also: x, y)`.
fn known(projects: &[JarvisProject]) -> String {
    if projects.is_empty() {
        return "none (mnemo has no project with a repository the app has seen)".to_string();
    }
    let names: Vec<String> =
        projects.iter().map(|p| if p.aliases.is_empty() { p.name.clone() } else { format!("{} (also: {})", p.name, p.aliases.join(", ")) }).collect();
    names.join(", ")
}

fn named<'a>(ctx: &'a Ctx, name: &str) -> Result<&'a JarvisProject, String> {
    crate::jarvis::find(&ctx.projects, name).ok_or_else(|| format!("unknown project \"{}\"; the known projects are: {}", name.trim(), known(&ctx.projects)))
}

/// The project `args.project` names; an error when it is missing or unknown.
fn project<'a>(ctx: &'a Ctx, a: &Args) -> Result<&'a JarvisProject, String> {
    match a.str("project")? {
        Some(n) if !n.trim().is_empty() => named(ctx, n),
        _ => Err(format!("this tool needs a project; the known projects are: {}", known(&ctx.projects))),
    }
}

/// The project `args.project` names, None when it names none.
fn maybe_project<'a>(ctx: &'a Ctx, a: &Args) -> Result<Option<&'a JarvisProject>, String> {
    match a.str("project")? {
        Some(n) if !n.trim().is_empty() => named(ctx, n).map(Some),
        _ => Ok(None),
    }
}

fn vault<'a>(ctx: &'a Ctx) -> Result<&'a Path, String> {
    ctx.vault.as_deref().ok_or_else(|| "no mnemo vault found (`mnemo status` names none)".to_string())
}

/// The model's arguments: an object, each read by the type `TOOLS` declares for it.
struct Args<'a>(&'a Value);

impl Args<'_> {
    fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key).filter(|v| !v.is_null())
    }

    fn str(&self, key: &str) -> Result<Option<&str>, String> {
        match self.get(key) {
            None => Ok(None),
            Some(Value::String(s)) => Ok(Some(s.as_str())),
            Some(v) => Err(format!("{key} must be text, not {v}")),
        }
    }

    fn need_str(&self, key: &str) -> Result<&str, String> {
        self.str(key)?.filter(|s| !s.trim().is_empty()).ok_or_else(|| format!("this tool needs {key}"))
    }

    /// A whole number, given as one or as its digits (`12`, `"12"`); anything else is refused.
    fn int(&self, key: &str) -> Result<Option<u64>, String> {
        let bad = |v: &Value| format!("{key} must be a whole number, not {v}");
        match self.get(key) {
            None => Ok(None),
            Some(v @ Value::Number(n)) => n.as_u64().map(Some).ok_or_else(|| bad(v)),
            Some(v @ Value::String(s)) => {
                let s = s.trim().trim_start_matches('#');
                if !s.is_empty() && s.len() <= 12 && s.bytes().all(|b| b.is_ascii_digit()) {
                    s.parse().map(Some).map_err(|_| bad(v))
                } else {
                    Err(bad(v))
                }
            }
            Some(v) => Err(bad(v)),
        }
    }

    fn number(&self) -> Result<Option<u64>, String> {
        self.int("number")
    }
}

// ------------------------------------------------------------------ io --

/// Today's date, `YYYY-MM-DD`, in UTC.
fn today() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    mnemo::civil((secs / 86_400) as i64)
}

fn live_sessions() -> Result<Vec<crate::mission::RepoGroup>, String> {
    Ok(crate::mission::collect_snapshot(None, false).repos)
}

/// `jarvis_tool(name, args)`: one read tool, its output as text for the model (see `run`).
#[tauri::command]
pub async fn jarvis_tool(name: String, args: Value) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = Ctx { projects: crate::jarvis::projects(), vault: crate::vault::vault_root(), gh: &gh::run_gh, sessions: &live_sessions, today: today() };
        run(&name, &args, &ctx)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `jarvis_focused_window()`: the title of the last window in front that was not this app;
/// None off Windows, or when there is none.
#[tauri::command]
pub fn jarvis_focused_window() -> Option<String> {
    focused_window()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) fn no_gh(_: &[String], _: &Path) -> Result<String, String> {
        Err("gh is not run in this test".to_string())
    }

    pub(crate) fn no_sessions() -> Result<Vec<crate::mission::RepoGroup>, String> {
        Ok(vec![])
    }

    pub(crate) fn ctx_with<'a>(projects: Vec<JarvisProject>, gh: GhRun<'a>) -> Ctx<'a> {
        Ctx { projects, vault: None, gh, sessions: &no_sessions, today: "2026-10-23".to_string() }
    }

    pub(crate) fn project_at(name: &str, root: &Path) -> JarvisProject {
        JarvisProject { name: name.to_string(), aliases: vec![], root: root.to_string_lossy().to_string() }
    }

    /// Each tool once against a real project, the world as the app sees it:
    /// `JARVIS_LIVE_PROJECT=<name> cargo test --lib jarvis_tools::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads the machine's projects, vault, sessions and GitHub"]
    fn live() {
        let name = std::env::var("JARVIS_LIVE_PROJECT").expect("JARVIS_LIVE_PROJECT names a project");
        let number = std::env::var("JARVIS_LIVE_NUMBER").unwrap_or_else(|_| "1".to_string());
        let ctx = Ctx { projects: crate::jarvis::projects(), vault: crate::vault::vault_root(), gh: &gh::run_gh, sessions: &live_sessions, today: today() };
        let p = json!(name);
        let calls = [
            ("git_status", json!({ "project": p })),
            ("git_log", json!({ "project": p, "limit": 3 })),
            ("git_diff", json!({ "project": p })),
            ("read_file", json!({ "project": p, "path": "README.md" })),
            ("read_file", json!({ "project": p, "path": ".env" })),
            ("list_dir", json!({ "project": p })),
            ("search", json!({ "project": p, "query": "jarvis" })),
            ("read_briefings", json!({ "project": p, "since": "ontem" })),
            ("query_rules", json!({ "project": p, "query": "testes" })),
            ("list_sessions", json!({ "project": p })),
            ("gh_pr_list", json!({ "project": p })),
            ("gh_pr_list", json!({})),
            ("gh_pr_view", json!({ "project": p, "number": number })),
            ("gh_pr_checks", json!({ "project": p, "number": number })),
            ("gh_run_list", json!({ "project": p })),
            ("gh_issue_view", json!({ "project": p, "number": number })),
        ];
        for (tool, args) in calls {
            let t = std::time::Instant::now();
            let got = run(tool, &args, &ctx);
            let ms = t.elapsed().as_millis();
            let (kind, text) = match &got {
                Ok(t) => ("ok", t.as_str()),
                Err(e) => ("err", e.as_str()),
            };
            println!("=== {tool} {args} -> {kind}, {} chars, {ms} ms\n{}\n", text.chars().count(), text.lines().take(6).collect::<Vec<_>>().join("\n"));
        }
        println!("=== jarvis_focused_window -> {:?}", focused_window());
    }

    #[test]
    fn the_tools_are_client_ts_read_tools() {
        let ts = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/jarvis/client.ts")).unwrap();
        let start = ts.find("export const READ_TOOLS = [").unwrap();
        let block = &ts[start..start + ts[start..].find("] as const").unwrap()];
        let names: Vec<&str> = block.split('\'').skip(1).step_by(2).collect();
        assert_eq!(names, READ_TOOLS);
    }

    #[test]
    fn an_unknown_tool_is_refused_with_the_list() {
        let ctx = ctx_with(vec![], &no_gh);
        let e = run("delegate_to_parent", &json!({}), &ctx).unwrap_err();
        assert!(e.contains("not one of Jarvis's read tools") && e.contains("gh_issue_view"), "{e}");
    }

    #[test]
    fn an_unknown_project_lists_the_known_names() {
        let ps = vec![
            JarvisProject { name: "alpha".into(), aliases: vec!["o alfa".into()], root: "r1".into() },
            JarvisProject { name: "beta".into(), aliases: vec![], root: "r2".into() },
        ];
        let ctx = ctx_with(ps, &no_gh);
        let e = run("git_status", &json!({ "project": "gamma" }), &ctx).unwrap_err();
        assert_eq!(e, "unknown project \"gamma\"; the known projects are: alpha (also: o alfa), beta");
        let e = run("read_file", &json!({ "path": "README.md" }), &ctx).unwrap_err();
        assert!(e.starts_with("this tool needs a project") && e.contains("beta"), "{e}");
    }

    #[test]
    fn an_alias_names_its_project() {
        let dir = crate::testutil::temp_dir("jarvis-tools-alias");
        std::fs::write(dir.join("README.md"), "olá").unwrap();
        let ctx = ctx_with(vec![JarvisProject { name: "app".into(), aliases: vec!["o app".into()], root: dir.to_string_lossy().to_string() }], &no_gh);
        assert_eq!(run("read_file", &json!({ "project": "O App", "path": "README.md" }), &ctx).unwrap(), "olá");
    }

    #[test]
    fn arguments_of_the_wrong_type_are_refused() {
        let dir = crate::testutil::temp_dir("jarvis-tools-args");
        let ctx = ctx_with(vec![project_at("app", &dir)], &no_gh);
        assert!(run("read_file", &json!({ "project": "app", "path": 3 }), &ctx).unwrap_err().contains("path must be text"));
        for n in [json!(-1), json!(1.5), json!("12; rm -rf /"), json!("--web"), json!([1])] {
            let e = run("gh_issue_view", &json!({ "project": "app", "number": n }), &ctx).unwrap_err();
            assert!(e.contains("number must be a whole number"), "{n}: {e}");
        }
    }

    #[test]
    fn the_cap_keeps_the_text_under_the_limit_and_says_where() {
        assert_eq!(cap("short", 10), "short");
        let long: String = (0..2000).map(|i| format!("line {i}\n")).collect();
        let got = cap(&long, MAX_CHARS);
        assert!(got.chars().count() <= MAX_CHARS);
        let total = long.chars().count();
        assert!(got.ends_with(&format!(" of {total} characters shown]")), "{}", &got[got.len() - 80..]);
        let kept = got.split("\n[cut here: ").next().unwrap();
        assert!(kept.ends_with(|c: char| c.is_ascii_digit()), "cut at a line's end");
        assert!(got.contains(&format!("[cut here: {} of", kept.chars().count())));
        // Characters, not bytes: a cut never splits one.
        let wide = "ção".repeat(5000);
        let got = cap(&wide, 100);
        assert!(got.chars().count() <= 100);
        assert!(got.starts_with("çãoção"));
    }

    #[test]
    fn every_tool_output_is_capped() {
        let dir = crate::testutil::temp_dir("jarvis-tools-cap");
        std::fs::write(dir.join("big.txt"), "x".repeat(50_000)).unwrap();
        let ctx = ctx_with(vec![project_at("app", &dir)], &no_gh);
        let got = run("read_file", &json!({ "project": "app", "path": "big.txt" }), &ctx).unwrap();
        assert!(got.chars().count() <= MAX_CHARS);
        assert!(got.ends_with("of 50000 characters shown]"), "{}", &got[got.len() - 60..]);
    }
}

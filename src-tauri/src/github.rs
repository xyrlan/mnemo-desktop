//! GitHub through the `gh` CLI: who is logged in, a repo's open issues, and the Project
//! board linked to it. No token of our own: `gh` is the identity. Every call runs `gh` with
//! the login shell's PATH and answers are cached for a minute per repo; failures are not
//! cached, so a `gh auth login` or `gh auth refresh` shows up on the next call.
//! Parsing is pure and covered on fixtures captured from `gh` (`fixtures/github/`).

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::mission::{contracts_in, login_path, may_probe};

const TTL: Duration = Duration::from_secs(60);

/// What the front turns into "rodar `gh auth refresh -s project`".
pub const NEEDS_SCOPE: &str = "needs_scope";

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct Auth {
    pub installed: bool,
    pub logged: bool,
    pub login: Option<String>,
    pub scopes: Vec<String>,
}

/// A contract piece whose section names the issue ("Issue #45.").
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct IssuePiece {
    pub contract_path: String,
    pub piece: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub labels: Vec<String>,
    pub assignees: Vec<String>,
    pub state: String,
    pub url: String,
    pub updated_at: String,
    pub milestone: Option<String>,
    /// PRs that close the issue (`Closes #n` in their body, or linked by hand).
    pub prs: Vec<u64>,
    pub pieces: Vec<IssuePiece>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BoardItem {
    pub id: String,
    pub title: String,
    pub number: Option<u64>,
    /// None for a draft issue.
    pub url: Option<String>,
    /// `Issue`, `PullRequest` or `DraftIssue`.
    pub kind: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct BoardColumn {
    pub name: String,
    pub items: Vec<BoardItem>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Board {
    pub title: String,
    pub url: String,
    pub columns: Vec<BoardColumn>,
}

// ------------------------------------------------------------- parsing --

/// `gh auth status --json hosts`: the active github.com account.
pub fn parse_auth_json(json: &str) -> Option<Auth> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let accounts = v.get("hosts")?.as_object()?;
    let Some(list) = accounts.get("github.com").and_then(|a| a.as_array()) else {
        return Some(Auth { installed: true, ..Auth::default() });
    };
    let active = list.iter().find(|a| a.get("active").and_then(|x| x.as_bool()) == Some(true)).or(list.first());
    let Some(a) = active else { return Some(Auth { installed: true, ..Auth::default() }) };
    let logged = a.get("state").and_then(|x| x.as_str()) == Some("success");
    Some(Auth {
        installed: true,
        logged,
        login: logged.then(|| a.get("login").and_then(|x| x.as_str()).map(str::to_string)).flatten(),
        scopes: a.get("scopes").and_then(|x| x.as_str()).map(split_scopes).unwrap_or_default(),
    })
}

/// Plain `gh auth status`, for a `gh` older than `--json`: the block of the active account.
pub fn parse_auth_text(text: &str) -> Auth {
    let mut auth = Auth { installed: true, ..Auth::default() };
    let mut current: Option<(String, Vec<String>)> = None;
    let mut first: Option<(String, Vec<String>)> = None;
    let mut active: Option<(String, Vec<String>)> = None;
    let mut close = |cur: &mut Option<(String, Vec<String>)>, is_active: bool| {
        if let Some(c) = cur.take() {
            if is_active {
                active = Some(c.clone());
            }
            first.get_or_insert(c);
        }
    };
    let mut is_active = false;
    for line in text.lines() {
        let t = line.trim().trim_start_matches(['✓', '-', ' ']).trim();
        if let Some(rest) = t.strip_prefix("Logged in to github.com") {
            close(&mut current, is_active);
            is_active = false;
            let rest = rest.trim();
            let login = rest.strip_prefix("account ").or_else(|| rest.strip_prefix("as ")).unwrap_or("");
            let login = login.split_whitespace().next().unwrap_or("").to_string();
            current = Some((login, vec![]));
        } else if t.starts_with("Active account: true") {
            is_active = true;
        } else if let Some(s) = t.strip_prefix("Token scopes:") {
            if let Some(c) = current.as_mut() {
                c.1 = split_scopes(s);
            }
        }
    }
    close(&mut current, is_active);
    if let Some((login, scopes)) = active.or(first) {
        auth.logged = true;
        auth.login = Some(login).filter(|l| !l.is_empty());
        auth.scopes = scopes;
    }
    auth
}

fn split_scopes(s: &str) -> Vec<String> {
    s.split(',').map(|x| x.trim().trim_matches('\'').trim().to_string()).filter(|x| !x.is_empty()).collect()
}

/// `gh issue list --json …`. Rows without a number or title are skipped.
pub fn parse_issues(json: &str) -> Result<Vec<Issue>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("issues json: {e}"))?;
    let names = |v: Option<&serde_json::Value>, key: &str| -> Vec<String> {
        v.and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|x| x.get(key)?.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    Ok(rows
        .iter()
        .filter_map(|r| {
            Some(Issue {
                number: r.get("number")?.as_u64()?,
                title: r.get("title")?.as_str()?.to_string(),
                labels: names(r.get("labels"), "name"),
                assignees: names(r.get("assignees"), "login"),
                state: r.get("state").and_then(|x| x.as_str()).unwrap_or("OPEN").to_string(),
                url: r.get("url").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                updated_at: r.get("updatedAt").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                milestone: r.get("milestone").and_then(|m| m.get("title")).and_then(|x| x.as_str()).map(str::to_string),
                prs: r
                    .get("closedByPullRequestsReferences")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|p| p.get("number")?.as_u64()).collect())
                    .unwrap_or_default(),
                pieces: vec![],
            })
        })
        .collect())
}

/// Issue numbers each `## <piece>` section of a contract names: `Issue #45`, `Closes #45`,
/// `Fixes #45`, `Resolves #45`. Text before the first piece is the round's intro, not a piece.
pub fn parse_contract_issues(md: &str) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut piece: Option<String> = None;
    let mut in_front = false;
    for (i, line) in md.lines().enumerate() {
        let t = line.trim();
        if i == 0 && t == "---" {
            in_front = true;
            continue;
        }
        if in_front {
            in_front = t != "---";
            continue;
        }
        if let Some(h) = t.strip_prefix("## ") {
            piece = Some(h.trim().to_string());
            continue;
        }
        let Some(p) = &piece else { continue };
        for n in issue_refs(t) {
            if !out.contains(&(p.clone(), n)) {
                out.push((p.clone(), n));
            }
        }
    }
    out
}

fn issue_refs(line: &str) -> Vec<u64> {
    const WORDS: [&str; 4] = ["issue", "closes", "fixes", "resolves"];
    let lower = line.to_lowercase();
    let mut out = Vec::new();
    let mut rest = lower.as_str();
    while let Some(at) = rest.find('#') {
        let before = rest[..at].trim_end();
        let digits: String = rest[at + 1..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() && WORDS.iter().any(|w| before.ends_with(w)) {
            if let Ok(n) = digits.parse() {
                out.push(n);
            }
        }
        rest = &rest[at + 1..];
    }
    out
}

/// Keeps issues carrying any of `labels`; no labels keeps everything.
pub fn filter_labels(issues: &[Issue], labels: &[String]) -> Vec<Issue> {
    issues.iter().filter(|i| labels.is_empty() || i.labels.iter().any(|l| labels.contains(l))).cloned().collect()
}

/// A Project linked to the repo: `number`, `owner login`, `title`, `url`.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedProject {
    pub number: u64,
    pub owner: String,
    pub title: String,
    pub url: String,
}

/// The repository's `projectsV2` from GraphQL. Open projects only; one named like the repo
/// wins, else the first.
pub fn pick_project(json: &str, repo_name: &str) -> Result<Option<LinkedProject>, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("projects json: {e}"))?;
    if let Some(errs) = v.get("errors").and_then(|e| e.as_array()) {
        if !errs.is_empty() {
            let text = serde_json::to_string(errs).unwrap_or_default();
            return Err(if is_scope_error(&text) { NEEDS_SCOPE.into() } else { text });
        }
    }
    let nodes = v.pointer("/data/repository/projectsV2/nodes").and_then(|n| n.as_array()).cloned().unwrap_or_default();
    let open: Vec<LinkedProject> = nodes
        .iter()
        .filter(|n| n.get("closed").and_then(|c| c.as_bool()) != Some(true))
        .filter_map(|n| {
            Some(LinkedProject {
                number: n.get("number")?.as_u64()?,
                owner: n.pointer("/owner/login")?.as_str()?.to_string(),
                title: n.get("title").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
                url: n.get("url").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
            })
        })
        .collect();
    let named = open.iter().position(|p| p.title.eq_ignore_ascii_case(repo_name));
    Ok(named.map(|i| open[i].clone()).or_else(|| open.into_iter().next()))
}

/// The Status field's options in board order, from `gh project field-list --format json`.
pub fn parse_status_options(json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else { return vec![] };
    v.get("fields")
        .and_then(|f| f.as_array())
        .and_then(|fs| fs.iter().find(|f| f.get("name").and_then(|n| n.as_str()).is_some_and(|n| n.eq_ignore_ascii_case("status"))))
        .and_then(|f| f.get("options")?.as_array())
        .map(|os| os.iter().filter_map(|o| o.get("name")?.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

pub const NO_STATUS: &str = "No Status";

/// Items from `gh project item-list --format json` grouped by their Status: the field's
/// options in order (empty ones too, as GitHub shows them), a status the field no longer
/// lists after them, and `No Status` first when any item has none.
pub fn group_board(title: &str, url: &str, options: &[String], items_json: &str) -> Result<Board, String> {
    let v: serde_json::Value = serde_json::from_str(items_json).map_err(|e| format!("project items json: {e}"))?;
    let items = v.get("items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
    let mut columns: Vec<BoardColumn> = options.iter().map(|o| BoardColumn { name: o.clone(), items: vec![] }).collect();
    let mut none = BoardColumn { name: NO_STATUS.into(), items: vec![] };
    for it in &items {
        let content = it.get("content");
        let field = |k: &str| content.and_then(|c| c.get(k));
        let item = BoardItem {
            id: it.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string(),
            title: it
                .get("title")
                .or_else(|| field("title"))
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string(),
            number: field("number").and_then(|x| x.as_u64()),
            url: field("url").and_then(|x| x.as_str()).map(str::to_string),
            kind: field("type").and_then(|x| x.as_str()).unwrap_or("DraftIssue").to_string(),
        };
        let status = it
            .as_object()
            .and_then(|o| o.iter().find(|(k, _)| k.eq_ignore_ascii_case("status")))
            .and_then(|(_, s)| s.as_str())
            .filter(|s| !s.is_empty());
        match status {
            None => none.items.push(item),
            Some(s) => match columns.iter_mut().find(|c| c.name == s) {
                Some(c) => c.items.push(item),
                None => columns.push(BoardColumn { name: s.to_string(), items: vec![item] }),
            },
        }
    }
    if !none.items.is_empty() {
        columns.insert(0, none);
    }
    Ok(Board { title: title.into(), url: url.into(), columns })
}

pub fn is_scope_error(text: &str) -> bool {
    text.contains("INSUFFICIENT_SCOPES") || text.contains("missing required scopes") || text.contains("read:project")
}

// --------------------------------------------------------------- cache --

/// Successful answers per key for `TTL`. Errors are never stored: the fix is usually a
/// command the user runs in a terminal, and the next call should see it.
pub struct Ttl<T> {
    ttl: Duration,
    entries: Mutex<HashMap<String, (Instant, T)>>,
}

impl<T: Clone> Ttl<T> {
    pub fn new(ttl: Duration) -> Self {
        Self { ttl, entries: Mutex::new(HashMap::new()) }
    }

    pub fn get_or<E>(&self, key: &str, now: Instant, compute: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        if let Some((at, v)) = self.entries.lock().unwrap().get(key) {
            if now.saturating_duration_since(*at) < self.ttl {
                return Ok(v.clone());
            }
        }
        let v = compute()?;
        let mut entries = self.entries.lock().unwrap();
        entries.retain(|_, (at, _)| now.saturating_duration_since(*at) < self.ttl);
        entries.insert(key.to_string(), (now, v.clone()));
        Ok(v)
    }
}

// ------------------------------------------------------------- running --

enum Gh {
    Missing,
    Ran { ok: bool, stdout: String, stderr: String },
}

fn gh(args: &[&str], cwd: Option<&Path>) -> Gh {
    let mut cmd = crate::proc::command("gh");
    cmd.args(args).env("PATH", login_path()).stdin(std::process::Stdio::null());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    match cmd.output() {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Gh::Missing,
        Err(e) => Gh::Ran { ok: false, stdout: String::new(), stderr: e.to_string() },
        Ok(o) => Gh::Ran {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).trim().to_string(),
        },
    }
}

/// stdout of a successful `gh`, else a one-line error (`needs_scope` for a missing scope).
fn gh_ok(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    match gh(args, cwd) {
        Gh::Missing => Err("gh not found in PATH (brew install gh)".into()),
        Gh::Ran { ok: true, stdout, .. } => Ok(stdout),
        Gh::Ran { stdout, stderr, .. } => {
            let text = if stderr.is_empty() { stdout } else { stderr };
            if is_scope_error(&text) {
                Err(NEEDS_SCOPE.into())
            } else {
                Err(format!("gh {}: {}", args.first().copied().unwrap_or(""), text.lines().next().unwrap_or("").trim()))
            }
        }
    }
}

fn read_auth() -> Auth {
    let json = match gh(&["auth", "status", "--json", "hosts"], None) {
        Gh::Missing => return Auth::default(),
        Gh::Ran { stdout, .. } => parse_auth_json(&stdout),
    };
    let mut auth = json.unwrap_or_else(|| match gh(&["auth", "status"], None) {
        Gh::Missing => Auth::default(),
        // Older `gh` prints the status to stderr.
        Gh::Ran { stdout, stderr, .. } => parse_auth_text(&format!("{stdout}\n{stderr}")),
    });
    if auth.logged && auth.login.is_none() {
        auth.login = gh_ok(&["api", "user", "--jq", ".login"], None).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }
    auth
}

const ISSUE_FIELDS: &str = "number,title,labels,assignees,state,url,updatedAt,milestone";

fn probe(root: &str) -> Result<&Path, String> {
    let p = Path::new(root);
    if !p.is_dir() || !may_probe(root) {
        return Err(format!("{root}: repository not accessible"));
    }
    Ok(p)
}

/// Every open issue of the repo (up to 200), with the contract pieces that name each.
fn read_issues(root: &str) -> Result<Vec<Issue>, String> {
    let dir = probe(root)?;
    let with_prs = format!("{ISSUE_FIELDS},closedByPullRequestsReferences");
    let list = |fields: &str| gh_ok(&["issue", "list", "--state", "open", "--limit", "200", "--json", fields], Some(dir));
    // `closedByPullRequestsReferences` is recent; an older `gh` refuses the whole field list.
    let json = match list(&with_prs) {
        Err(e) if e.contains("Unknown JSON field") => list(ISSUE_FIELDS),
        r => r,
    }?;
    let mut issues = parse_issues(&json)?;
    let mut refs: HashMap<u64, Vec<IssuePiece>> = HashMap::new();
    for (path, _, _) in contracts_in(root) {
        let Ok(md) = std::fs::read_to_string(&path) else { continue };
        for (piece, n) in parse_contract_issues(&md) {
            refs.entry(n).or_default().push(IssuePiece { contract_path: path.clone(), piece });
        }
    }
    for i in &mut issues {
        i.pieces = refs.remove(&i.number).unwrap_or_default();
    }
    Ok(issues)
}

fn read_project(root: &str) -> Result<Option<Board>, String> {
    let dir = probe(root)?;
    const QUERY: &str = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){projectsV2(first:20){nodes{number title url closed owner{... on User{login} ... on Organization{login}}}}}}";
    let q = format!("query={QUERY}");
    let json = gh_ok(&["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-f", &q], Some(dir))?;
    let name = Path::new(root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let Some(p) = pick_project(&json, &name)? else { return Ok(None) };
    let number = p.number.to_string();
    let fields = gh_ok(&["project", "field-list", &number, "--owner", &p.owner, "--format", "json"], Some(dir))?;
    let items = gh_ok(&["project", "item-list", &number, "--owner", &p.owner, "--format", "json", "--limit", "500"], Some(dir))?;
    group_board(&p.title, &p.url, &parse_status_options(&fields), &items).map(Some)
}

fn auth_cache() -> &'static Ttl<Auth> {
    static C: OnceLock<Ttl<Auth>> = OnceLock::new();
    C.get_or_init(|| Ttl::new(TTL))
}

fn issues_cache() -> &'static Ttl<Vec<Issue>> {
    static C: OnceLock<Ttl<Vec<Issue>>> = OnceLock::new();
    C.get_or_init(|| Ttl::new(TTL))
}

fn project_cache() -> &'static Ttl<Option<Board>> {
    static C: OnceLock<Ttl<Option<Board>>> = OnceLock::new();
    C.get_or_init(|| Ttl::new(TTL))
}

// ------------------------------------------------------------ commands --

/// Only a logged-in answer is cached: after `gh auth login` in a terminal tab the next
/// call must see it.
#[tauri::command]
pub async fn gh_auth() -> Auth {
    tauri::async_runtime::spawn_blocking(|| {
        auth_cache()
            .get_or("github.com", Instant::now(), || {
                let a = read_auth();
                if a.logged { Ok(a) } else { Err(a) }
            })
            .unwrap_or_else(|a| a)
    })
    .await
    .unwrap_or_default()
}

/// Open issues carrying any of `labels` (all of them when empty).
#[tauri::command]
pub async fn gh_issues(root: String, labels: Vec<String>) -> Result<Vec<Issue>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let all = issues_cache().get_or(&root, Instant::now(), || read_issues(&root))?;
        Ok(filter_labels(&all, &labels))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The board of the Project linked to the repo, None when it has none. Rejects with
/// `needs_scope` when the token lacks the `project` scope.
#[tauri::command]
pub async fn gh_project(root: String) -> Result<Option<Board>, String> {
    tauri::async_runtime::spawn_blocking(move || project_cache().get_or(&root, Instant::now(), || read_project(&root)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const AUTH: &str = include_str!("../fixtures/github/auth_status.json");
    const AUTH_OUT: &str = include_str!("../fixtures/github/auth_status_logged_out.json");
    const AUTH_TXT: &str = include_str!("../fixtures/github/auth_status.txt");
    const ISSUES: &str = include_str!("../fixtures/github/issues.json");
    const PROJECTS: &str = include_str!("../fixtures/github/projects.json");
    const PROJECTS_NONE: &str = include_str!("../fixtures/github/projects_none.json");
    const FIELDS: &str = include_str!("../fixtures/github/fields.json");
    const ITEMS: &str = include_str!("../fixtures/github/items.json");
    const CONTRACT: &str = include_str!("../fixtures/github/contract.md");

    #[test]
    fn auth_json_picks_the_active_account() {
        let a = parse_auth_json(AUTH).unwrap();
        assert_eq!(
            a,
            Auth { installed: true, logged: true, login: Some("xyrlan".into()), scopes: vec!["gist".into(), "read:org".into(), "repo".into(), "workflow".into()] }
        );
        assert_eq!(parse_auth_json(AUTH_OUT), Some(Auth { installed: true, ..Auth::default() }));
        // `--json` unknown to an old gh: no JSON on stdout, fall back to text.
        assert_eq!(parse_auth_json("unknown flag: --json"), None);
        let bad = r#"{"hosts":{"github.com":[{"state":"error","active":true,"login":"x","scopes":""}]}}"#;
        assert_eq!(parse_auth_json(bad), Some(Auth { installed: true, ..Auth::default() }));
    }

    #[test]
    fn auth_text_reads_login_and_scopes() {
        let a = parse_auth_text(AUTH_TXT);
        assert!(a.logged);
        assert_eq!(a.login.as_deref(), Some("xyrlan"));
        assert!(a.scopes.contains(&"project".to_string()));
        assert_eq!(parse_auth_text("github.com\n  ✓ Logged in to github.com as old (oauth_token)\n  ✓ Token scopes: repo"), Auth {
            installed: true,
            logged: true,
            login: Some("old".into()),
            scopes: vec!["repo".into()]
        });
        assert!(!parse_auth_text("You are not logged into any GitHub hosts. To log in, run: gh auth login").logged);
    }

    #[test]
    fn issues_parse_labels_assignees_milestone_and_closing_prs() {
        let is = parse_issues(ISSUES).unwrap();
        assert_eq!(is.len(), 3);
        assert_eq!(is[0].number, 35);
        assert_eq!(is[0].labels, vec!["ui", "round5"]);
        assert_eq!(is[0].assignees, vec!["xyrlan"]);
        assert_eq!(is[0].milestone.as_deref(), Some("v0.2"));
        assert_eq!(is[0].prs, vec![52]);
        assert_eq!(is[0].updated_at, "2026-09-15T11:00:00Z");
        assert_eq!(is[1].milestone, None);
        assert!(is[1].prs.is_empty());
        assert!(parse_issues("nope").is_err());
        // An old gh without closedByPullRequestsReferences.
        let old = parse_issues(r#"[{"number":1,"title":"t","labels":[],"assignees":[],"state":"OPEN","url":"u","updatedAt":"x","milestone":null}]"#).unwrap();
        assert!(old[0].prs.is_empty());
    }

    #[test]
    fn filter_labels_keeps_any_match_and_everything_without_labels() {
        let is = parse_issues(ISSUES).unwrap();
        assert_eq!(filter_labels(&is, &[]).len(), 3);
        let n = |labels: &[&str]| filter_labels(&is, &labels.iter().map(|s| s.to_string()).collect::<Vec<_>>()).iter().map(|i| i.number).collect::<Vec<_>>();
        assert_eq!(n(&["bug"]), vec![29]);
        assert_eq!(n(&["bug", "ui"]), vec![35, 29]);
        assert_eq!(n(&["nothing"]), Vec::<u64>::new());
    }

    #[test]
    fn contract_sections_name_their_issues() {
        assert_eq!(
            parse_contract_issues(CONTRACT),
            vec![("pulse".to_string(), 44), ("github".to_string(), 45), ("github".to_string(), 46)]
        );
        assert_eq!(issue_refs("Issue #3 and issue#4, fixes #5, PR #6, see #7"), vec![3, 4, 5]);
    }

    #[test]
    fn project_pick_skips_closed_prefers_the_repo_name_and_reports_scope() {
        let p = pick_project(PROJECTS, "mnemo-desktop").unwrap().unwrap();
        assert_eq!((p.number, p.owner.as_str(), p.title.as_str()), (4, "xyrlan", "mnemo"));
        assert_eq!(pick_project(PROJECTS, "mnemo").unwrap().unwrap().number, 4);
        assert_eq!(pick_project(PROJECTS_NONE, "x").unwrap(), None);
        let scope = r#"{"errors":[{"type":"INSUFFICIENT_SCOPES","message":"requires one of the following scopes: ['read:project']"}]}"#;
        assert_eq!(pick_project(scope, "x"), Err(NEEDS_SCOPE.into()));
        assert!(is_scope_error("error: your authentication token is missing required scopes [read:project]"));
        assert!(!is_scope_error("gh: Could not resolve to a Repository"));
    }

    #[test]
    fn board_groups_items_by_status_in_field_order() {
        let opts = parse_status_options(FIELDS);
        assert_eq!(opts, vec!["Todo", "In Progress", "Done"]);
        let b = group_board("mnemo", "https://github.com/users/xyrlan/projects/4", &opts, ITEMS).unwrap();
        let names: Vec<&str> = b.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec![NO_STATUS, "Todo", "In Progress", "Done", "Blocked"]);
        let col = |n: &str| &b.columns.iter().find(|c| c.name == n).unwrap().items;
        assert!(col("Todo").is_empty());
        assert_eq!(col("In Progress")[0], BoardItem {
            id: "PVTI_1".into(),
            title: "GitHub via gh".into(),
            number: Some(45),
            url: Some("https://github.com/xyrlan/mnemo-desktop/issues/45".into()),
            kind: "Issue".into()
        });
        assert_eq!(col("Done")[0].kind, "PullRequest");
        assert_eq!(col(NO_STATUS)[0], BoardItem { id: "PVTI_3".into(), title: "Team layer".into(), number: None, url: None, kind: "DraftIssue".into() });
        assert_eq!(col("Blocked")[0].number, Some(44));
        // No Status field at all: one column per status seen, in item order.
        let bare = group_board("t", "u", &parse_status_options("{}"), ITEMS).unwrap();
        assert_eq!(bare.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec![NO_STATUS, "In Progress", "Done", "Blocked"]);
    }

    #[test]
    fn ttl_caches_successes_only() {
        let c: Ttl<u32> = Ttl::new(Duration::from_secs(60));
        let calls = Cell::new(0);
        let t0 = Instant::now();
        let ok = || -> Result<u32, String> {
            calls.set(calls.get() + 1);
            Ok(calls.get())
        };
        assert_eq!(c.get_or("/r", t0, || Err::<u32, _>("needs_scope".to_string())), Err("needs_scope".into()));
        assert_eq!(c.get_or("/r", t0, ok), Ok(1));
        assert_eq!(c.get_or("/r", t0 + Duration::from_secs(59), ok), Ok(1));
        assert_eq!(c.get_or("/other", t0, ok), Ok(2));
        assert_eq!(c.get_or("/r", t0 + Duration::from_secs(61), ok), Ok(3));
    }

    /// Against the real `gh` in this checkout: `cargo test -- --ignored gh_live`.
    #[test]
    #[ignore]
    fn gh_live() {
        let root = env!("CARGO_MANIFEST_DIR").trim_end_matches("/src-tauri");
        println!("{:?}", read_auth());
        println!("{:?}", read_issues(root).map(|is| is.iter().map(|i| (i.number, i.pieces.len())).collect::<Vec<_>>()));
        println!("{:?}", read_project(root));
    }
}

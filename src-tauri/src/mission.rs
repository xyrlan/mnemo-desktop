//! Mission cockpit data: sessions, repos, contracts and PRs joined into one snapshot.
//!
//! Pure parsing and joining live in functions that take strings, so `cargo test`
//! covers them on fixtures captured from real files. Process spawning is confined
//! to `collect_snapshot` and the small helpers under `// -- io --`.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Command;

// ---------------------------------------------------------------- model --

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParentSession {
    pub session_id: String,
    pub pid: Option<u64>,
    pub name: Option<String>,
    pub status: String,
    pub cwd: String,
    /// Input + output tokens from the session transcript; cache reads are kept apart
    /// because they are billed differently and dwarf everything else.
    #[serde(default)]
    pub tokens: u64,
    #[serde(default)]
    pub cache_read: u64,
    /// Sum of `tokens` over the children whose `parent_session` is this session.
    #[serde(default)]
    pub children_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChildSession {
    pub id: String,
    pub session_id: Option<String>,
    pub name: Option<String>,
    pub state: String,
    pub tempo: String,
    pub needs: Option<String>,
    pub detail: String,
    pub suggested_reply: Option<String>,
    pub cwd: String,
    pub tokens: u64,
    pub live: bool,
    pub updated_at: Option<String>,
    /// First line of the dispatch prompt, for rows that have no `name`.
    pub intent: Option<String>,
    /// `feat/<feature>/<piece>` when the child's worktree is on a contract branch.
    pub branch: Option<String>,
    /// Timeline lines the child has now; the front-end diffs against its looked marker.
    pub timeline_len: usize,
    /// `session_id` of the parent that dispatched this child: recorded by `mnemo
    /// dispatch` when it can, otherwise guessed by `link_children`.
    pub parent_session: Option<String>,
    /// What the child's process is stopped on, as `claude agents` says it (`permission
    /// prompt`); None while it is not waiting or when `claude agents` does not list it.
    #[serde(default)]
    pub waiting_for: Option<String>,
    /// The model Claude Code respawns the child with, as `mnemo sessions` reads it from
    /// `respawnFlags`. None is a real answer, not a failed read: a lean child passes its
    /// own `--settings`, so no `--model` is resolved and it runs on its settings' default.
    #[serde(default)]
    pub model: Option<String>,
    /// `--effort` the child was dispatched with; None means it runs at the default, since
    /// Claude Code never resolves an unpassed effort into `respawnFlags`.
    #[serde(default)]
    pub effort: Option<String>,
    /// The PR this child opened, when it belongs to no contract (a contract piece carries its
    /// PR on the piece). Its job's own record of the PR wins; failing that, the PR whose head
    /// is the child's branch.
    #[serde(default)]
    pub pr: Option<Pr>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Pr {
    pub number: u64,
    pub url: String,
    pub state: String,
    pub head: String,
    /// pass | fail | pending | none, folded from every check (`check_verdict`).
    pub ci: String,
    /// Opened as a draft: `gh pr merge` refuses it until it is marked ready.
    #[serde(default)]
    pub draft: bool,
    /// Names of the checks that failed, so a red row says which one.
    #[serde(default)]
    pub failing: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Piece {
    pub name: String,
    pub branch: String,
    pub child: Option<ChildSession>,
    pub pr: Option<Pr>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Mission {
    pub feature: String,
    pub contract_path: String,
    pub pieces: Vec<Piece>,
    pub landable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RepoGroup {
    pub root: String,
    pub name: String,
    pub parents: Vec<ParentSession>,
    pub missions: Vec<Mission>,
    /// Children of this repo that belong to no contract (issue dispatches).
    pub children: Vec<ChildSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Snapshot {
    pub repos: Vec<RepoGroup>,
    pub errors: Vec<String>,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TimelineLine {
    pub at: String,
    pub state: String,
    pub detail: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Timeline {
    pub lines: Vec<TimelineLine>,
    pub total: usize,
}

// ------------------------------------------------------------- parsers --

/// `claude agents --json --all`: keep interactive rows only; background rows are
/// better described by `mnemo sessions`.
pub fn parse_agents(json: &str) -> Result<Vec<ParentSession>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("agents json: {e}"))?;
    Ok(rows
        .iter()
        .filter(|r| r.get("kind").and_then(|k| k.as_str()) == Some("interactive"))
        .filter_map(|r| {
            Some(ParentSession {
                session_id: r.get("sessionId")?.as_str()?.to_string(),
                pid: r.get("pid").and_then(|p| p.as_u64()),
                name: r.get("name").and_then(|n| n.as_str()).map(str::to_string),
                status: r.get("status").and_then(|s| s.as_str()).unwrap_or("unknown").to_string(),
                cwd: r.get("cwd")?.as_str()?.to_string(),
                tokens: 0,
                cache_read: 0,
                children_tokens: 0,
            })
        })
        .collect())
}

/// `mnemo sessions --json --all`.
pub fn parse_sessions(json: &str) -> Result<Vec<ChildSession>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("sessions json: {e}"))?;
    let s = |v: Option<&serde_json::Value>| v.and_then(|x| x.as_str()).map(str::to_string);
    Ok(rows
        .iter()
        .filter_map(|r| {
            Some(ChildSession {
                id: r.get("short_id")?.as_str()?.to_string(),
                session_id: s(r.get("session_id")),
                name: s(r.get("name")),
                state: s(r.get("state")).unwrap_or_default(),
                tempo: s(r.get("tempo")).unwrap_or_default(),
                needs: s(r.get("needs")),
                detail: s(r.get("detail")).unwrap_or_default(),
                suggested_reply: s(r.get("suggested_reply")),
                cwd: s(r.get("cwd")).unwrap_or_default(),
                tokens: r.get("tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                live: r.get("live").and_then(|l| l.as_bool()).unwrap_or(false),
                updated_at: s(r.get("updated_at")),
                intent: s(r.get("intent")).map(|i| i.lines().next().unwrap_or("").to_string()),
                branch: None,
                timeline_len: 0,
                parent_session: s(r.get("parent_session")),
                waiting_for: None,
                model: s(r.get("model")),
                effort: s(r.get("effort")),
                pr: None,
            })
        })
        .collect())
}

/// `sessionId` → `startedAt` (epoch ms) for every row of `claude agents --json --all`.
pub fn parse_agent_starts(json: &str) -> HashMap<String, u64> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).unwrap_or_default();
    rows.iter()
        .filter_map(|r| Some((r.get("sessionId")?.as_str()?.to_string(), r.get("startedAt")?.as_u64()?)))
        .collect()
}

/// Session id and short id → `waitingFor` for every row of `claude agents --json --all`
/// that is waiting on something (`status: "waiting"`). mnemo's `needs` only guesses from
/// the transcript; this is the process saying it is parked on a prompt.
pub fn parse_agent_waiting(json: &str) -> HashMap<String, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).unwrap_or_default();
    let mut out = HashMap::new();
    for r in &rows {
        let Some(w) = r.get("waitingFor").and_then(|w| w.as_str()).filter(|w| !w.is_empty()) else { continue };
        for key in ["sessionId", "id"] {
            if let Some(k) = r.get(key).and_then(|k| k.as_str()) {
                out.insert(k.to_string(), w.to_string());
            }
        }
    }
    out
}

/// What `id` (short or session id) is parked on right now, from `claude agents --json --all`:
/// `Some("permission prompt")` while a dialog holds its keys, `None` otherwise. Err when no
/// row has that id, so nothing is typed at a session Claude Code does not know.
pub fn agent_waiting_for(json: &str, id: &str) -> Result<Option<String>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("agents json: {e}"))?;
    let row = rows
        .iter()
        .find(|r| ["id", "sessionId"].iter().any(|k| r.get(*k).and_then(|v| v.as_str()) == Some(id)))
        .ok_or_else(|| format!("{id} is not in `claude agents`"))?;
    Ok(row.get("waitingFor").and_then(|w| w.as_str()).filter(|w| !w.is_empty()).map(str::to_string))
}

pub fn waiting_for(id: &str) -> Result<Option<String>, String> {
    agent_waiting_for(&run("claude", &["agents", "--json", "--all"], None)?, id)
}

/// Marks each child with what its process waits for, matched by session id, else short id.
pub fn apply_waiting(children: &mut [ChildSession], waiting: &HashMap<String, String>) {
    for c in children {
        c.waiting_for = c.session_id.as_ref().and_then(|s| waiting.get(s)).or_else(|| waiting.get(&c.id)).cloned();
    }
}

/// A contract file: `feature:` from the frontmatter and one `## <slug>` per piece.
pub fn parse_contract(md: &str) -> Option<(String, Vec<String>)> {
    let mut feature = None;
    let mut pieces = Vec::new();
    let mut in_front = false;
    for (i, line) in md.lines().enumerate() {
        let t = line.trim();
        if i == 0 && t == "---" {
            in_front = true;
            continue;
        }
        if in_front {
            if t == "---" {
                in_front = false;
            } else if let Some(v) = t.strip_prefix("feature:") {
                feature = Some(v.trim().to_string());
            }
            continue;
        }
        if let Some(h) = t.strip_prefix("## ") {
            pieces.push(h.trim().to_string());
        }
    }
    feature.map(|f| (f, pieces))
}

/// `gh pr list --json` with these fields.
pub const PR_FIELDS: &str = "headRefName,number,url,statusCheckRollup,state,isDraft";

/// `gh pr list --json PR_FIELDS`.
pub fn parse_prs(json: &str) -> Result<Vec<Pr>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("prs json: {e}"))?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            Some(Pr {
                number: r.get("number")?.as_u64()?,
                url: r.get("url")?.as_str()?.to_string(),
                state: r.get("state")?.as_str()?.to_string(),
                head: r.get("headRefName")?.as_str()?.to_string(),
                ci: ci_state(r.get("statusCheckRollup")),
                draft: r.get("isDraft").and_then(|d| d.as_bool()).unwrap_or(false),
                failing: failing_checks(r.get("statusCheckRollup")),
            })
        })
        .collect())
}

/// One entry of a `statusCheckRollup`: a check run (`conclusion`) or a commit status
/// (`state`). Passed only on a conclusion or state that says so; skipped and neutral runs
/// count as passed, as GitHub counts them. A conclusion this does not know is never a pass:
/// it is a failure when it says the run ended badly, and pending otherwise.
/// `src/cockpit/merge.ts` has the same rule for the merge gate; both are pinned by
/// `fixtures/check-verdicts.json`.
pub fn check_verdict(c: &serde_json::Value) -> &'static str {
    let conclusion = c.get("conclusion").and_then(|x| x.as_str()).unwrap_or("");
    let state = c.get("state").and_then(|x| x.as_str()).unwrap_or("");
    match (conclusion, state) {
        ("FAILURE" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE" | "STALE", _) | (_, "FAILURE" | "ERROR") => "fail",
        ("SUCCESS" | "NEUTRAL" | "SKIPPED", _) | ("", "SUCCESS") => "pass",
        _ => "pending",
    }
}

/// pass only when there are checks and every one passed; fail when any failed.
pub fn ci_state(rollup: Option<&serde_json::Value>) -> String {
    let Some(checks) = rollup.and_then(|r| r.as_array()) else { return "none".into() };
    if checks.is_empty() {
        return "none".into();
    }
    let verdicts: Vec<&str> = checks.iter().map(check_verdict).collect();
    if verdicts.contains(&"fail") {
        "fail".into()
    } else if verdicts.contains(&"pending") {
        "pending".into()
    } else {
        "pass".into()
    }
}

fn failing_checks(rollup: Option<&serde_json::Value>) -> Vec<String> {
    let Some(checks) = rollup.and_then(|r| r.as_array()) else { return vec![] };
    checks
        .iter()
        .filter(|c| check_verdict(c) == "fail")
        .map(|c| c.get("name").or_else(|| c.get("context")).and_then(|n| n.as_str()).unwrap_or("a check").to_string())
        .collect()
}

pub fn parse_timeline(text: &str, from_line: usize) -> Timeline {
    let all: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let total = all.len();
    let lines = all
        .iter()
        .skip(from_line)
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .map(|v| {
            let g = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            TimelineLine { at: g("at"), state: g("state"), detail: g("detail"), text: g("text") }
        })
        .collect();
    Timeline { lines, total }
}

// -------------------------------------------------------------- tokens --

/// Usage totals over one session transcript, kept between polls so each poll reads
/// only what was appended since the last one.
#[derive(Debug, Default)]
pub struct Tally {
    pub tokens: u64,
    pub cache_read: u64,
    /// Epoch ms of the first line that carries a `timestamp`.
    pub first_at: Option<u64>,
    /// Lines parsed by the last `feed` or `refresh`.
    pub lines_read: usize,
    offset: u64,
    len: u64,
    mtime: Option<std::time::SystemTime>,
    /// message id → its (tokens, cache_read). Claude Code writes one line per content
    /// block of an assistant message, each repeating the message's usage, so the
    /// last line of a message replaces what the earlier ones contributed.
    by_message: HashMap<String, (u64, u64)>,
}

impl Tally {
    /// Add complete transcript lines.
    pub fn feed(&mut self, text: &str) {
        self.lines_read = 0;
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            self.lines_read += 1;
            let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
            if self.first_at.is_none() {
                self.first_at = v.get("timestamp").and_then(|t| t.as_str()).and_then(iso_ms);
            }
            let Some(u) = v.get("message").and_then(|m| m.get("usage")) else { continue };
            let n = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
            let add = (n("input_tokens") + n("output_tokens"), n("cache_read_input_tokens"));
            let id = v.get("message").and_then(|m| m.get("id")).and_then(|x| x.as_str());
            if let Some((t, c)) = id.and_then(|id| self.by_message.insert(id.to_string(), add)) {
                self.tokens -= t;
                self.cache_read -= c;
            }
            self.tokens += add.0;
            self.cache_read += add.1;
        }
    }

    /// Read what was appended to `path` since the last call. An unchanged size and
    /// mtime reads nothing; a file that shrank is re-read from the start; a trailing
    /// line still being written waits for its newline.
    pub fn refresh(&mut self, path: &Path) -> Result<(), String> {
        use std::io::{Read, Seek, SeekFrom};
        let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let (len, mtime) = (meta.len(), meta.modified().ok());
        if len == self.len && mtime == self.mtime {
            self.lines_read = 0;
            return Ok(());
        }
        if len < self.offset {
            *self = Tally::default();
        }
        let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        f.seek(SeekFrom::Start(self.offset)).map_err(|e| e.to_string())?;
        let mut buf = Vec::new();
        f.take(len - self.offset).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        match buf.iter().rposition(|b| *b == b'\n') {
            Some(end) => {
                self.feed(&String::from_utf8_lossy(&buf[..=end]));
                self.offset += end as u64 + 1;
            }
            None => self.lines_read = 0,
        }
        self.len = len;
        self.mtime = mtime;
        Ok(())
    }
}

/// `2026-09-15T00:41:39.813Z` → epoch ms. Transcripts and `state.json` write UTC.
pub fn iso_ms(s: &str) -> Option<u64> {
    let s = s.strip_suffix('Z')?;
    let (date, time) = s.split_once('T')?;
    let mut d = date.splitn(3, '-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let (hms, frac) = time.split_once('.').unwrap_or((time, "0"));
    let mut t = hms.splitn(3, ':').map(|x| x.parse::<i64>().ok());
    let (hh, mm, ss) = (t.next()??, t.next()??, t.next()??);
    let ms: i64 = format!("{:0<3}", frac).get(..3)?.parse().ok()?;
    // Days from civil (Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    u64::try_from(((days * 24 + hh) * 60 + mm) * 60 * 1000 + ss * 1000 + ms).ok()
}

/// Claude Code's project dir for a cwd: every non-alphanumeric character becomes `-`
/// (`/Users/x/.claude` → `-Users-x--claude`, as seen in `~/.claude/projects/`).
pub fn project_dir_name(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// Point every child at its parent and sum the children's tokens onto the parents.
/// A child that already names its parent keeps it. Otherwise it belongs to the
/// parent in the same repo that started before it did, the youngest of those when
/// several did. `parent_starts` is keyed by session id, `child_starts` by short id.
pub fn link_children(
    parents: &mut [ParentSession],
    children: &mut [ChildSession],
    roots: &HashMap<String, String>,
    parent_starts: &HashMap<String, u64>,
    child_starts: &HashMap<String, u64>,
) {
    for c in children.iter_mut().filter(|c| c.parent_session.is_none()) {
        let Some(born) = child_starts.get(&c.id) else { continue };
        let root = root_of(&c.cwd, roots);
        c.parent_session = parents
            .iter()
            .filter(|p| root_of(&p.cwd, roots) == root)
            .filter_map(|p| parent_starts.get(&p.session_id).filter(|s| *s < born).map(|s| (s, p)))
            .max_by_key(|(s, _)| **s)
            .map(|(_, p)| p.session_id.clone());
    }
    for p in parents.iter_mut() {
        p.children_tokens =
            children.iter().filter(|c| c.parent_session.as_deref() == Some(p.session_id.as_str())).map(|c| c.tokens).sum();
    }
}

// ---------------------------------------------------------------- join --

pub struct JoinInput<'a> {
    pub parents: Vec<ParentSession>,
    pub children: Vec<ChildSession>,
    /// cwd (session or worktree) → main checkout root. Missing entries are dropped
    /// into a repo named after the cwd itself.
    pub roots: &'a HashMap<String, String>,
    /// worktree path → branch, from `git worktree list --porcelain` of each root.
    pub branches: &'a HashMap<String, String>,
    /// root → contracts found there: (path, feature, pieces).
    pub contracts: &'a HashMap<String, Vec<(String, String, Vec<String>)>>,
    /// root → PRs.
    pub prs: &'a HashMap<String, Vec<Pr>>,
    /// Child short id → the PR urls its job recorded opening (`~/.claude/jobs/<id>/state.json`).
    pub recorded: &'a HashMap<String, Vec<String>>,
    pub focused_root: Option<&'a str>,
    /// Parent session id → epoch ms it started, for `link_children`.
    pub parent_starts: &'a HashMap<String, u64>,
    /// Child short id → epoch ms it was created, for `link_children`.
    pub child_starts: &'a HashMap<String, u64>,
}

fn root_of(cwd: &str, roots: &HashMap<String, String>) -> String {
    roots.get(cwd).cloned().unwrap_or_else(|| cwd.to_string())
}

/// The PR a child opened: the one its job recorded, else the one whose head is its branch.
/// Never a PR by time or by repo alone: siblings work the same repo in the same window.
fn pr_of(c: &ChildSession, prs: &[Pr], recorded: &HashMap<String, Vec<String>>) -> Option<Pr> {
    let norm = |u: &str| u.trim().trim_end_matches('/').to_ascii_lowercase();
    let urls: Vec<String> = recorded.get(&c.id).map(|us| us.iter().map(|u| norm(u)).collect()).unwrap_or_default();
    // A job that opened several PRs: the open one is the one that still needs someone.
    let mut mine: Vec<&Pr> = prs.iter().filter(|p| urls.contains(&norm(&p.url))).collect();
    mine.sort_by_key(|p| (p.state != "OPEN", std::cmp::Reverse(p.number)));
    mine.first()
        .copied()
        .or_else(|| c.branch.as_deref().and_then(|b| prs.iter().find(|p| p.head == b)))
        .cloned()
}

pub fn join(mut input: JoinInput) -> Vec<RepoGroup> {
    link_children(&mut input.parents, &mut input.children, input.roots, input.parent_starts, input.child_starts);
    let mut groups: BTreeMap<String, RepoGroup> = BTreeMap::new();
    let ensure = |groups: &mut BTreeMap<String, RepoGroup>, root: &str| {
        groups.entry(root.to_string()).or_insert_with(|| RepoGroup {
            root: root.to_string(),
            name: Path::new(root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.to_string()),
            parents: vec![],
            missions: vec![],
            children: vec![],
        });
    };

    for p in input.parents {
        let root = root_of(&p.cwd, input.roots);
        ensure(&mut groups, &root);
        groups.get_mut(&root).unwrap().parents.push(p);
    }

    // Children get their branch from the worktree map, then are claimed by a
    // contract piece when the branch is `feat/<feature>/<piece>`.
    let mut unclaimed: BTreeMap<String, Vec<ChildSession>> = BTreeMap::new();
    let mut by_branch: HashMap<(String, String), ChildSession> = HashMap::new();
    for mut c in input.children {
        let root = root_of(&c.cwd, input.roots);
        c.branch = input
            .branches
            .get(&c.cwd)
            .cloned()
            .or_else(|| Path::new(&c.cwd).canonicalize().ok().and_then(|p| input.branches.get(&p.to_string_lossy().to_string()).cloned()));
        match &c.branch {
            Some(b) => {
                by_branch.insert((root.clone(), b.clone()), c);
            }
            None => unclaimed.entry(root).or_default().push(c),
        }
    }

    let mut all_roots: Vec<String> = groups.keys().cloned().collect();
    all_roots.extend(by_branch.keys().map(|(r, _)| r.clone()));
    all_roots.extend(unclaimed.keys().cloned());
    all_roots.sort();
    all_roots.dedup();

    for root in all_roots {
        ensure(&mut groups, &root);
        let g = groups.get_mut(&root).unwrap();
        let prs = input.prs.get(&root).cloned().unwrap_or_default();
        for (path, feature, pieces) in input.contracts.get(&root).cloned().unwrap_or_default() {
            let mut ps = Vec::new();
            for piece in pieces {
                let branch = format!("feat/{feature}/{piece}");
                let child = by_branch.remove(&(root.clone(), branch.clone()));
                let pr = prs.iter().find(|p| p.head == branch).cloned();
                ps.push(Piece { name: piece, branch, child, pr });
            }
            // A contract nobody is working on and nobody delivered is noise.
            if ps.iter().all(|p| p.child.is_none() && p.pr.is_none()) {
                continue;
            }
            let landable = !ps.is_empty()
                && ps.iter().all(|p| p.pr.as_ref().map(|pr| pr.state == "OPEN" && pr.ci == "pass").unwrap_or(false));
            g.missions.push(Mission { feature, contract_path: path, pieces: ps, landable });
        }
        let mut leftover: Vec<ChildSession> = by_branch
            .iter()
            .filter(|((r, _), _)| *r == root)
            .map(|(_, c)| c.clone())
            .collect();
        for k in leftover.iter().filter_map(|c| c.branch.clone()).map(|b| (root.clone(), b)).collect::<Vec<_>>() {
            by_branch.remove(&k);
        }
        leftover.extend(unclaimed.remove(&root).unwrap_or_default());
        for c in &mut leftover {
            c.pr = pr_of(c, &prs, input.recorded);
        }
        leftover.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        g.children = leftover;
    }

    let mut out: Vec<RepoGroup> = groups.into_values().collect();
    // Focused repo first, then repos with live children, then the rest by name.
    let live = |g: &RepoGroup| {
        g.children.iter().any(|c| c.live)
            || g.missions.iter().flat_map(|m| &m.pieces).any(|p| p.child.as_ref().map(|c| c.live).unwrap_or(false))
    };
    out.sort_by(|a, b| {
        let fa = Some(a.root.as_str()) == input.focused_root;
        let fb = Some(b.root.as_str()) == input.focused_root;
        fb.cmp(&fa).then(live(b).cmp(&live(a))).then(a.name.cmp(&b.name))
    });
    out
}

// ------------------------------------------------------------------ io --

/// PATH as the user's *interactive* login shell sees it. An app launched from the Dock or
/// Finder inherits launchd's minimal PATH, which has neither `~/.local/bin` (claude, mnemo)
/// nor Homebrew (gh); the terminal panes are fine because they run a login shell, but
/// every `Command` here must be given the same PATH explicitly. The probe is `-lic`, not
/// `-lc`: a non-interactive login zsh never reads `.zshrc`, which is where most people
/// (this user included) export `~/.local/bin`, so `-lc` found no `claude` at all.
/// Between markers, because an interactive rc may print. Well-known tool dirs are
/// appended as a last resort when the shell probe misses them.
pub fn login_path() -> String {
    static CACHE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            let inherited = std::env::var("PATH").unwrap_or_default();
            if cfg!(windows) {
                return inherited;
            }
            let shell = crate::pty::default_shell();
            let probed = Command::new(&shell)
                .args(["-lic", "printf '\\037MNEMO_PATH=%s\\037' \"$PATH\""])
                .env("TERM", "dumb")
                .env("MNEMO_NO_SHELL_INTEGRATION", "1")
                .stdin(std::process::Stdio::null())
                .output()
                .ok()
                .and_then(|o| extract_marked_path(&String::from_utf8_lossy(&o.stdout)))
                .or_else(|| {
                    // A broken interactive rc: fall back to the plain login probe.
                    Command::new(&shell)
                        .args(["-lc", "printf %s \"$PATH\""])
                        .stdin(std::process::Stdio::null())
                        .output()
                        .ok()
                        .filter(|o| o.status.success())
                        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                        .filter(|p| !p.is_empty())
                })
                .unwrap_or_default();
            merge_paths(&probed, &inherited, &well_known_dirs())
        })
        .clone()
}

/// The PATH printed between `\x1f` markers by the interactive probe, or None.
pub fn extract_marked_path(out: &str) -> Option<String> {
    let start = out.find("\x1fMNEMO_PATH=")? + "\x1fMNEMO_PATH=".len();
    let end = out[start..].find('\x1f')? + start;
    let p = out[start..end].trim();
    (!p.is_empty()).then(|| p.to_string())
}

/// Tool dirs an app must find even when the shell probe missed them.
fn well_known_dirs() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
        .iter()
        .map(|d| d.to_string())
        .chain([".local/bin", ".bun/bin", ".cargo/bin"].iter().map(|d| format!("{home}/{d}")))
        .collect()
}

/// `probed` first, then anything in `inherited` it lacks, then any `extra` dir that exists
/// on disk and is still missing. Order is preserved, duplicates and empties dropped.
pub fn merge_paths(probed: &str, inherited: &str, extra: &[String]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut push = |p: &str| {
        if !p.is_empty() && !parts.iter().any(|q| q == p) {
            parts.push(p.to_string());
        }
    };
    for p in probed.split(':') {
        push(p);
    }
    for p in inherited.split(':') {
        push(p);
    }
    for p in extra {
        if Path::new(p).is_dir() {
            push(p);
        }
    }
    parts.join(":")
}

pub(crate) fn run(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.env("PATH", login_path());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    cmd.stdin(std::process::Stdio::null());
    let out = cmd.output().map_err(|e| format!("{program}: {e}"))?;
    if !out.status.success() {
        return Err(format!("{program} {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Main checkout root for a cwd, following worktrees back to their common dir.
/// Callers that act without a user gesture check `may_probe` first.
pub fn repo_root(cwd: &str) -> Option<String> {
    git_root(cwd).ok()
}

/// `repo_root` with git's error kept, so a TCC denial can be told apart from "not a repo".
pub fn git_root(cwd: &str) -> Result<String, String> {
    let common = run("git", &["rev-parse", "--path-format=absolute", "--git-common-dir"], Some(Path::new(cwd)))?;
    let common = PathBuf::from(common.trim());
    common.parent().map(|p| p.to_string_lossy().to_string()).ok_or_else(|| format!("git common dir: {}", common.display()))
}

/// Under a folder macOS guards with a "would like to access files in…" dialog: `~/Desktop`,
/// `~/Documents`, `~/Downloads`, or a volume under `/Volumes`. Pure path comparison — even a
/// `stat` inside one of these would raise the dialog.
pub fn is_protected(path: &str, home: &str) -> bool {
    let p = Path::new(path);
    let in_home = !home.is_empty() && ["Desktop", "Documents", "Downloads"].iter().any(|d| p.starts_with(Path::new(home).join(d)));
    in_home || p.strip_prefix("/Volumes").map(|rest| rest.components().next().is_some()).unwrap_or(false)
}

fn unlocked() -> std::sync::MutexGuard<'static, Vec<String>> {
    static UNLOCKED: std::sync::OnceLock<std::sync::Mutex<Vec<String>>> = std::sync::OnceLock::new();
    UNLOCKED.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// The user asked for `dir` (picked it, or selected it in Home): probing it and anything
/// under it may raise a dialog now. Lasts for this run only — TCC's answer outlives us,
/// but after `tccutil reset` a remembered unlock would prompt at launch again.
pub fn unlock(dir: &str) {
    let mut u = unlocked();
    if !u.iter().any(|d| d == dir) {
        u.push(dir.to_string());
    }
}

pub fn relock(dir: &str) {
    unlocked().retain(|d| d != dir);
}

/// Whether touching `path` (running git in it, reading a file under it) is quiet: not in a
/// protected folder, or under one the user unlocked. The one guard for every caller that
/// probes a path without a user gesture — Home's snapshot and the sidebar poll.
pub fn may_probe(path: &str) -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    !is_protected(path, &home) || unlock_covers(path)
}

pub fn unlock_covers(path: &str) -> bool {
    unlocked().iter().any(|d| Path::new(path).starts_with(d))
}

/// worktree path → branch name, from `git worktree list --porcelain`.
pub fn worktree_branches(root: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(text) = run("git", &["worktree", "list", "--porcelain"], Some(Path::new(root))) else { return map };
    let mut cur: Option<String> = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            cur = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            if let Some(p) = &cur {
                // Key by both the printed path and its canonical form: git prints
                // forward slashes on Windows while callers pass native paths.
                map.insert(p.clone(), b.to_string());
                if let Ok(c) = Path::new(p).canonicalize() {
                    map.insert(c.to_string_lossy().to_string(), b.to_string());
                }
            }
        }
    }
    map
}

pub fn contracts_in(root: &str) -> Vec<(String, String, Vec<String>)> {
    let dir = Path::new(root).join("docs").join("contracts");
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().map(|x| x == "md").unwrap_or(false) {
            if let Ok(md) = std::fs::read_to_string(&p) {
                if let Some((f, pieces)) = parse_contract(&md) {
                    out.push((p.to_string_lossy().to_string(), f, pieces));
                }
            }
        }
    }
    out.sort();
    out
}

fn jobs_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".claude").join("jobs")
}

pub fn timeline_len(id: &str) -> usize {
    std::fs::read_to_string(jobs_dir().join(id).join("timeline.jsonl"))
        .map(|t| t.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
}

pub fn read_timeline(id: &str, from_line: usize) -> Timeline {
    std::fs::read_to_string(jobs_dir().join(id).join("timeline.jsonl"))
        .map(|t| parse_timeline(&t, from_line))
        .unwrap_or_default()
}

/// One poll. Every failure is recorded in `errors` and never aborts the snapshot.
fn pr_cache() -> &'static std::sync::Mutex<HashMap<String, Vec<Pr>>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Vec<Pr>>>> = std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

/// The last PR list `gh` returned for a repo root, kept for the polls that skip `gh`.
pub fn remember_prs(root: &str, prs: &[Pr]) {
    pr_cache().lock().unwrap().insert(root.to_string(), prs.to_vec());
}

pub fn recall_prs(root: &str) -> Option<Vec<Pr>> {
    pr_cache().lock().unwrap().get(root).cloned()
}

pub fn collect_snapshot(focused_cwd: Option<&str>, with_prs: bool) -> Snapshot {
    let mut errors = Vec::new();
    let agents = run("claude", &["agents", "--json", "--all"], None);
    let agent_starts = agents.as_deref().map(parse_agent_starts).unwrap_or_default();
    let agent_waiting = agents.as_deref().map(parse_agent_waiting).unwrap_or_default();
    let mut parents = match agents.and_then(|j| parse_agents(&j)) {
        Ok(p) => p,
        Err(e) => {
            errors.push(e);
            vec![]
        }
    };
    let mut children = match run("mnemo", &["sessions", "--json", "--all"], None).and_then(|j| parse_sessions(&j)) {
        Ok(c) => c,
        Err(e) => {
            errors.push(e);
            vec![]
        }
    };
    apply_waiting(&mut children, &agent_waiting);
    let mut child_starts = HashMap::new();
    for c in &mut children {
        c.timeline_len = timeline_len(&c.id);
        if c.parent_session.is_none() && may_probe(&c.cwd) {
            c.parent_session = declared_parent(&c.cwd);
        }
        // Creation time survives a respawn; the process start does not.
        if let Some(t) = job_created_at(&c.id).or_else(|| c.session_id.as_ref().and_then(|s| agent_starts.get(s).copied())) {
            child_starts.insert(c.id.clone(), t);
        }
    }
    let parent_starts = tally_parents(&mut parents, &agent_starts);

    let mut roots: HashMap<String, String> = HashMap::new();
    let cwds: Vec<String> = parents
        .iter()
        .map(|p| p.cwd.clone())
        .chain(children.iter().map(|c| c.cwd.clone()))
        .chain(focused_cwd.map(str::to_string))
        .collect();
    for cwd in cwds {
        // A locked protected cwd stays its own group, as a cwd with no repo does.
        if roots.contains_key(&cwd) || !may_probe(&cwd) {
            continue;
        }
        if let Some(r) = repo_root(&cwd) {
            roots.insert(cwd, r);
        }
    }
    let focused_root = focused_cwd.and_then(|c| roots.get(c).cloned());
    // Every repo a child worked in, contract or not: most dispatches are by issue, and their
    // PRs need a merge row as much as a contract piece's do.
    let child_roots: std::collections::HashSet<String> = children.iter().filter_map(|c| roots.get(&c.cwd).cloned()).collect();

    let mut branches: HashMap<String, String> = HashMap::new();
    let mut contracts = HashMap::new();
    let mut prs = HashMap::new();
    let mut seen = std::collections::HashSet::new();
    let mut want_prs = Vec::new();
    for r in roots.values() {
        if !seen.insert(r.clone()) || !may_probe(r) {
            continue;
        }
        branches.extend(worktree_branches(r));
        let cs = contracts_in(r);
        if !cs.is_empty() || child_roots.contains(r) {
            want_prs.push(r.clone());
        }
        contracts.insert(r.clone(), cs);
    }
    // PRs are fetched every tenth poll; the polls between reuse the last answer, so a PR node
    // never blinks out of the cockpit graph and back (every id change there re-laid the
    // canvas). One `gh` per repo takes seconds, so the repos are asked at once.
    if with_prs {
        let fetched: Vec<(String, Result<Vec<Pr>, String>)> = std::thread::scope(|s| {
            let asks: Vec<_> = want_prs
                .iter()
                .map(|r| {
                    s.spawn(move || {
                        let got = run("gh", &["pr", "list", "--json", PR_FIELDS, "--state", "all", "--limit", "100"], Some(Path::new(r)))
                            .and_then(|j| parse_prs(&j));
                        (r.clone(), got)
                    })
                })
                .collect();
            asks.into_iter().filter_map(|a| a.join().ok()).collect()
        });
        for (r, got) in fetched {
            match got {
                Ok(p) => {
                    remember_prs(&r, &p);
                    prs.insert(r, p);
                }
                Err(e) => errors.push(e),
            }
        }
    }
    for r in want_prs {
        if !prs.contains_key(&r) {
            if let Some(p) = recall_prs(&r) {
                prs.insert(r, p);
            }
        }
    }

    let repos = join(JoinInput {
        parents,
        children,
        roots: &roots,
        branches: &branches,
        contracts: &contracts,
        prs: &prs,
        recorded: &recorded_prs(),
        focused_root: focused_root.as_deref(),
        parent_starts: &parent_starts,
        child_starts: &child_starts,
    });
    Snapshot { repos, errors, at: chrono_now() }
}

/// Each background job's record of the PRs it opened, read as the lens reads it
/// (`home/lens.rs`, which this only calls).
fn recorded_prs() -> HashMap<String, Vec<String>> {
    crate::home::lens::read_jobs(&crate::home::lens::jobs_dir()).into_iter().filter(|j| !j.prs.is_empty()).map(|j| (j.short, j.prs)).collect()
}

fn projects_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".claude").join("projects")
}

/// `~/.claude/projects/<escaped cwd>/<session>.jsonl`, or wherever else under
/// `projects/` that file is when the escaping guess misses (very long cwds).
pub fn transcript_path(cwd: &str, session_id: &str) -> Option<PathBuf> {
    let file = format!("{session_id}.jsonl");
    let guess = projects_dir().join(project_dir_name(cwd)).join(&file);
    if guess.is_file() {
        return Some(guess);
    }
    std::fs::read_dir(projects_dir()).ok()?.flatten().map(|e| e.path().join(&file)).find(|p| p.is_file())
}

/// Fill each parent's `tokens` and `cache_read` from its transcript, reading only the
/// bytes appended since the previous poll. Returns session id → start (epoch ms):
/// the transcript's first line when there is one, since a resumed session's process
/// is younger than the children it dispatched before the resume.
fn tally_parents(parents: &mut [ParentSession], agent_starts: &HashMap<String, u64>) -> HashMap<String, u64> {
    static TALLIES: std::sync::OnceLock<std::sync::Mutex<HashMap<String, Tally>>> = std::sync::OnceLock::new();
    let mut tallies = TALLIES.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    tallies.retain(|id, _| parents.iter().any(|p| &p.session_id == id));
    let mut starts = HashMap::new();
    for p in parents.iter_mut() {
        let tally = tallies.entry(p.session_id.clone()).or_default();
        if let Some(path) = transcript_path(&p.cwd, &p.session_id) {
            if tally.refresh(&path).is_err() {
                *tally = Tally::default();
            }
        }
        p.tokens = tally.tokens;
        p.cache_read = tally.cache_read;
        if let Some(t) = tally.first_at.or_else(|| agent_starts.get(&p.session_id).copied()) {
            starts.insert(p.session_id.clone(), t);
        }
    }
    starts
}

/// `<worktree>/.mnemo-child-profile/dispatch.json`'s `parent_session`, written by
/// `mnemo dispatch` once xyrlan/mnemo#288 lands.
pub fn declared_parent(cwd: &str) -> Option<String> {
    let text = std::fs::read_to_string(Path::new(cwd).join(".mnemo-child-profile").join("dispatch.json")).ok()?;
    parse_declared_parent(&text)
}

pub fn parse_declared_parent(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("parent_session")?.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

/// `createdAt` of a child's `~/.claude/jobs/<id>/state.json`, in epoch ms.
fn job_created_at(id: &str) -> Option<u64> {
    let text = std::fs::read_to_string(jobs_dir().join(id).join("state.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    iso_ms(v.get("createdAt")?.as_str()?)
}

fn chrono_now() -> String {
    let d = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    format!("{}", d.as_secs())
}

// ------------------------------------------------------------- looked --

fn looked_path() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".mnemo-desktop").join("looked.json")
}

pub fn read_looked() -> HashMap<String, usize> {
    std::fs::read_to_string(looked_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn mark_looked(id: &str, timeline_len: usize) -> Result<(), String> {
    let mut m = read_looked();
    m.insert(id.to_string(), timeline_len);
    let p = looked_path();
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

// --------------------------------------------------------------- tests --

#[cfg(test)]
mod tests {
    use super::*;

    const AGENTS: &str = include_str!("../fixtures/agents.json");
    const SESSIONS: &str = include_str!("../fixtures/sessions.json");
    const PRS: &str = include_str!("../fixtures/prs.json");
    const CONTRACT: &str = include_str!("../fixtures/contract.md");
    const TIMELINE: &str = include_str!("../fixtures/timeline.jsonl");
    const TRANSCRIPT: &str = include_str!("../fixtures/transcript.jsonl");

    #[test]
    fn agents_keeps_interactive_rows_with_pid_and_status() {
        let p = parse_agents(AGENTS).unwrap();
        assert!(!p.is_empty());
        assert!(p.iter().all(|x| x.pid.is_some()));
        assert!(p.iter().any(|x| x.cwd == "/Users/xyrlan/github/mnemo" && x.status == "busy"));
    }

    #[test]
    fn sessions_parse_children_with_tempo_and_first_intent_line() {
        let c = parse_sessions(SESSIONS).unwrap();
        let e = c.iter().find(|x| x.id == "a43d3832").unwrap();
        assert_eq!(e.tempo, "active");
        assert_eq!(e.cwd, "/Users/xyrlan/github/mnemo-desktop-wt-c-editor");
        assert!(e.tokens > 0);
        assert!(e.live);
        assert_eq!(e.intent.as_deref(), Some("You are building one piece of the feature \"panes\": editor"));
    }

    #[test]
    fn sessions_carry_model_and_effort_and_keep_none_as_default() {
        let c = parse_sessions(SESSIONS).unwrap();
        let by = |id: &str| c.iter().find(|x| x.id == id).unwrap().clone();
        let explicit = by("095ef1c4");
        assert_eq!(explicit.model.as_deref(), Some("opus[1m]"));
        assert_eq!(explicit.effort.as_deref(), Some("high"));
        // A lean child: mnemo emits null for both, which reads as None, not an error.
        let lean = by("a43d3832");
        assert_eq!((lean.model, lean.effort), (None, None));
        let json = serde_json::to_value(by("04082ea7")).unwrap();
        assert_eq!(json["model"], "claude-fable-5-1[1m]");
        assert!(json["effort"].is_null());
    }

    #[test]
    fn a_child_parked_on_a_permission_prompt_carries_what_it_waits_for() {
        let waiting = parse_agent_waiting(AGENTS);
        assert_eq!(waiting.get("987fb657-a6c1-4319-8547-49167aa01a65").map(String::as_str), Some("permission prompt"));
        assert!(!waiting.contains_key("a43d3832-e7a9-49b7-9496-2d86aeac8aad"), "a busy child waits for nothing");
        let mut c = parse_sessions(SESSIONS).unwrap();
        apply_waiting(&mut c, &waiting);
        let probe = c.iter().find(|x| x.id == "987fb657").unwrap();
        assert_eq!(probe.waiting_for.as_deref(), Some("permission prompt"));
        assert_eq!(probe.needs.as_deref(), Some("approve Bash: touch approve-probe.txt && ls -la"));
        assert!(c.iter().filter(|x| x.id != "987fb657").all(|x| x.waiting_for.is_none()));
        // Matched by short id when mnemo does not know the session id.
        let mut bare = vec![ChildSession { session_id: None, ..probe.clone() }];
        apply_waiting(&mut bare, &waiting);
        assert_eq!(bare[0].waiting_for.as_deref(), Some("permission prompt"));
        // A cleared prompt clears the field on the next poll.
        apply_waiting(&mut bare, &HashMap::new());
        assert_eq!(bare[0].waiting_for, None);
        let json = serde_json::to_value(probe).unwrap();
        assert_eq!(json["waiting_for"], "permission prompt");
    }

    #[test]
    fn waiting_for_reads_one_row_by_short_or_session_id() {
        assert_eq!(agent_waiting_for(AGENTS, "987fb657").unwrap().as_deref(), Some("permission prompt"));
        assert_eq!(agent_waiting_for(AGENTS, "987fb657-a6c1-4319-8547-49167aa01a65").unwrap().as_deref(), Some("permission prompt"));
        assert_eq!(agent_waiting_for(AGENTS, "a43d3832").unwrap(), None);
        assert!(agent_waiting_for(AGENTS, "nope").unwrap_err().contains("nope"));
        assert!(agent_waiting_for("not json", "987fb657").is_err());
    }

    #[test]
    fn contract_yields_feature_and_pieces() {
        let (f, p) = parse_contract(CONTRACT).unwrap();
        assert_eq!(f, "panes");
        assert_eq!(p, vec!["editor", "browser"]);
        assert!(parse_contract("# not a contract\n## x").is_none());
    }

    #[test]
    fn remembered_prs_survive_a_poll_without_gh() {
        let prs = parse_prs(PRS).unwrap();
        remember_prs("/tmp/repo-cache-test", &prs);
        assert_eq!(recall_prs("/tmp/repo-cache-test").as_deref(), Some(prs.as_slice()));
        assert_eq!(recall_prs("/tmp/never-seen"), None);
    }

    #[test]
    fn prs_parse_with_ci_state() {
        let p = parse_prs(PRS).unwrap();
        let two = p.iter().find(|x| x.number == 2).unwrap();
        assert_eq!(two.head, "feat/pane-kinds");
        assert_eq!(two.state, "MERGED");
        assert_eq!(two.ci, "pass");
    }

    #[test]
    fn ci_state_rules() {
        let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        assert_eq!(ci_state(None), "none");
        assert_eq!(ci_state(Some(&j("[]"))), "none");
        assert_eq!(ci_state(Some(&j(r#"[{"conclusion":"SUCCESS"},{"conclusion":"","status":"IN_PROGRESS"}]"#))), "pending");
        assert_eq!(ci_state(Some(&j(r#"[{"conclusion":"SUCCESS"},{"conclusion":"FAILURE"}]"#))), "fail");
        assert_eq!(ci_state(Some(&j(r#"[{"state":"SUCCESS"}]"#))), "pass");
    }

    #[test]
    fn every_check_verdict_is_the_one_the_merge_gate_reads() {
        // The same table pins `checkVerdict` in src/cockpit/merge.ts.
        let rows: Vec<serde_json::Value> = serde_json::from_str(include_str!("../fixtures/check-verdicts.json")).unwrap();
        for r in &rows {
            assert_eq!(check_verdict(&r["check"]), r["verdict"].as_str().unwrap(), "{}", r["check"]);
        }
    }

    #[test]
    fn a_rollup_is_green_only_when_every_check_passed() {
        let j = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        // PR #27: two green jobs and a red Windows job is red, whatever `gh pr merge` would say.
        let rollup = j(r#"[{"name":"test (macos-latest)","conclusion":"SUCCESS"},{"name":"test (ubuntu-latest)","conclusion":"SUCCESS"},{"name":"test (windows-latest)","conclusion":"FAILURE"}]"#);
        assert_eq!(ci_state(Some(&rollup)), "fail");
        assert_eq!(failing_checks(Some(&rollup)), ["test (windows-latest)"]);
        // A conclusion GitHub adds later never reads as green.
        assert_eq!(ci_state(Some(&j(r#"[{"conclusion":"SUCCESS"},{"conclusion":"SOMETHING_NEW"}]"#))), "pending");
        assert_eq!(ci_state(Some(&j(r#"[{"conclusion":"STARTUP_FAILURE"}]"#))), "fail");
    }

    #[test]
    fn prs_carry_draft_and_the_names_of_failing_checks() {
        let p = parse_prs(
            r#"[{"number":49,"url":"u49","state":"OPEN","headRefName":"fix/issue-40","isDraft":true,"statusCheckRollup":[{"name":"ci","conclusion":"SUCCESS"}]},
                {"number":50,"url":"u50","state":"OPEN","headRefName":"x","statusCheckRollup":[{"context":"legacy","state":"ERROR"}]}]"#,
        )
        .unwrap();
        assert!(p[0].draft && p[0].failing.is_empty() && p[0].ci == "pass");
        // A gh without `isDraft` reads as not a draft, never as a parse failure.
        assert!(!p[1].draft);
        assert_eq!(p[1].failing, ["legacy"]);
    }

    fn pr(n: u64, head: &str, state: &str) -> Pr {
        Pr { number: n, url: format!("https://github.com/me/r/pull/{n}"), state: state.into(), head: head.into(), ci: "pass".into(), draft: false, failing: vec![] }
    }

    fn issue_child(id: &str, cwd: &str) -> ChildSession {
        let mut c = parse_sessions(SESSIONS).unwrap().remove(0);
        c.id = id.into();
        c.cwd = cwd.into();
        c.pr = None;
        c.parent_session = Some("p".into());
        c
    }

    #[test]
    fn a_child_outside_any_contract_gets_the_pr_it_opened() {
        let root = "/gh/r".to_string();
        let roots: HashMap<String, String> =
            [("/gh/r-wt-40", &root), ("/gh/r-wt-41", &root), ("/gh/r-wt-42", &root), ("/gh/r-wt-43", &root)].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let branches: HashMap<String, String> =
            [("/gh/r-wt-40", "fix/issue-40"), ("/gh/r-wt-41", "fix/issue-41"), ("/gh/r-wt-43", "fix/issue-43")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        let prs = HashMap::from([(root.clone(), vec![pr(7, "fix/issue-40", "OPEN"), pr(8, "renamed-by-hand", "OPEN"), pr(6, "fix/issue-43", "MERGED"), pr(9, "fix/issue-43", "OPEN")])]);
        // 41's job recorded #8, opened from a branch that is not its worktree's.
        let recorded = HashMap::from([("c41".to_string(), vec!["https://github.com/me/r/pull/8/".to_string()])]);
        let children = vec![issue_child("c40", "/gh/r-wt-40"), issue_child("c41", "/gh/r-wt-41"), issue_child("c42", "/gh/r-wt-42"), issue_child("c43", "/gh/r-wt-43")];
        let empty = HashMap::new();
        let groups = join(JoinInput {
            parents: vec![], children, roots: &roots, branches: &branches, contracts: &HashMap::new(), prs: &prs,
            recorded: &recorded, focused_root: None, parent_starts: &empty, child_starts: &empty,
        });
        let pr_of = |id: &str| groups[0].children.iter().find(|c| c.id == id).unwrap().pr.as_ref().map(|p| p.number);
        assert_eq!(pr_of("c40"), Some(7), "by branch");
        assert_eq!(pr_of("c41"), Some(8), "the job's record wins over the branch");
        assert_eq!(pr_of("c42"), None, "no branch, no record: no PR, never a guess");
        assert_eq!(pr_of("c43"), Some(6), "the branch's first PR in gh's order (newest first in real output)");
    }

    #[test]
    fn a_job_that_opened_several_prs_is_shown_its_open_one() {
        let c = issue_child("c1", "/gh/r-wt-1");
        let prs = vec![pr(3, "a", "MERGED"), pr(4, "b", "OPEN"), pr(5, "c", "CLOSED")];
        let recorded = HashMap::from([("c1".to_string(), prs.iter().map(|p| p.url.clone()).collect())]);
        assert_eq!(pr_of(&c, &prs, &recorded).map(|p| p.number), Some(4));
    }

    #[test]
    fn timeline_tail_from_offset() {
        let all = parse_timeline(TIMELINE, 0);
        assert!(all.total >= 4);
        assert_eq!(all.lines.len(), all.total);
        assert_eq!(all.lines[0].state, "working");
        let tail = parse_timeline(TIMELINE, all.total - 1);
        assert_eq!(tail.lines.len(), 1);
        assert_eq!(tail.total, all.total);
    }

    fn fixture_join(focused: Option<&str>) -> Vec<RepoGroup> {
        let parents = parse_agents(AGENTS).unwrap();
        let children = parse_sessions(SESSIONS).unwrap();
        let mut roots = HashMap::new();
        roots.insert("/Users/xyrlan/github/mnemo-desktop-wt-c-editor".to_string(), "/Users/xyrlan/github/mnemo-desktop".to_string());
        roots.insert("/Users/xyrlan/github/mnemo-desktop-wt-c-browser".to_string(), "/Users/xyrlan/github/mnemo-desktop".to_string());
        roots.insert("/Users/xyrlan/github/mnemo".to_string(), "/Users/xyrlan/github/mnemo".to_string());
        let mut branches = HashMap::new();
        branches.insert("/Users/xyrlan/github/mnemo-desktop-wt-c-editor".to_string(), "feat/panes/editor".to_string());
        branches.insert("/Users/xyrlan/github/mnemo-desktop-wt-c-browser".to_string(), "feat/panes/browser".to_string());
        let mut contracts = HashMap::new();
        let (f, p) = parse_contract(CONTRACT).unwrap();
        contracts.insert("/Users/xyrlan/github/mnemo-desktop".to_string(), vec![("docs/contracts/panes.md".to_string(), f, p)]);
        let mut prs = HashMap::new();
        let mut list = parse_prs(PRS).unwrap();
        list.push(Pr { number: 9, url: "u".into(), state: "OPEN".into(), head: "feat/panes/editor".into(), ci: "pass".into(), draft: false, failing: vec![] });
        prs.insert("/Users/xyrlan/github/mnemo-desktop".to_string(), list);
        roots.insert("/Users/xyrlan/github/mnemo-desktop".to_string(), "/Users/xyrlan/github/mnemo-desktop".to_string());
        roots.insert("/Users/xyrlan/github/mnemo-wt-244".to_string(), "/Users/xyrlan/github/mnemo".to_string());
        // Children are created from their jobs; the fixture has only process starts.
        let starts = parse_agent_starts(AGENTS);
        let child_starts = children.iter().filter_map(|c| Some((c.id.clone(), *starts.get(c.session_id.as_ref()?)?))).collect();
        join(JoinInput {
            parents,
            children,
            roots: &roots,
            branches: &branches,
            contracts: &contracts,
            prs: &prs,
            recorded: &HashMap::new(),
            focused_root: focused,
            parent_starts: &starts,
            child_starts: &child_starts,
        })
    }

    #[test]
    fn join_claims_children_into_contract_pieces_and_attaches_prs() {
        let groups = fixture_join(None);
        let g = groups.iter().find(|g| g.name == "mnemo-desktop").unwrap();
        assert_eq!(g.missions.len(), 1);
        let m = &g.missions[0];
        assert_eq!(m.feature, "panes");
        let editor = m.pieces.iter().find(|p| p.name == "editor").unwrap();
        assert_eq!(editor.child.as_ref().unwrap().id, "a43d3832");
        assert_eq!(editor.child.as_ref().unwrap().branch.as_deref(), Some("feat/panes/editor"));
        assert_eq!(editor.pr.as_ref().unwrap().number, 9);
        let browser = m.pieces.iter().find(|p| p.name == "browser").unwrap();
        assert_eq!(browser.child.as_ref().unwrap().id, "094c6a03");
        assert!(browser.pr.is_none());
        assert!(!m.landable, "one piece has no PR yet");
        // Claimed children do not also appear as loose children.
        assert!(g.children.iter().all(|c| c.id != "a43d3832" && c.id != "094c6a03"));
    }

    #[test]
    fn join_groups_parents_by_repo_and_orders_focused_first() {
        let groups = fixture_join(Some("/Users/xyrlan/github/mnemo"));
        assert_eq!(groups[0].name, "mnemo");
        assert!(groups[0].parents.iter().any(|p| p.status == "busy"));
        let groups = fixture_join(Some("/Users/xyrlan/github/mnemo-desktop"));
        assert_eq!(groups[0].name, "mnemo-desktop");
    }

    #[test]
    fn join_leaves_unknown_cwds_as_their_own_repo() {
        let children = vec![ChildSession {
            id: "x".into(), session_id: None, name: None, state: "done".into(), tempo: "done".into(), needs: None,
            detail: String::new(), suggested_reply: None, cwd: "/tmp/elsewhere".into(), tokens: 0, live: false,
            updated_at: None, intent: None, branch: None, timeline_len: 0, parent_session: None, waiting_for: None,
            model: None, effort: None, pr: None,
        }];
        let empty = HashMap::new();
        let groups = join(JoinInput {
            parents: vec![], children, roots: &empty, branches: &empty, contracts: &HashMap::new(), prs: &HashMap::new(),
            recorded: &HashMap::new(), focused_root: None, parent_starts: &HashMap::new(), child_starts: &HashMap::new(),
        });
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].name, "elsewhere");
        assert_eq!(groups[0].children.len(), 1);
    }

    #[test]
    fn join_links_children_to_the_youngest_older_parent_in_their_repo() {
        let groups = fixture_join(None);
        let g = groups.iter().find(|g| g.name == "mnemo-desktop").unwrap();
        let dispatcher = "7c3e9d41-2b6a-4f0e-8d15-a9c4e2f7b603";
        let pieces: Vec<&ChildSession> = g.missions[0].pieces.iter().filter_map(|p| p.child.as_ref()).collect();
        assert_eq!(pieces.len(), 2);
        assert!(pieces.iter().all(|c| c.parent_session.as_deref() == Some(dispatcher)), "{pieces:?}");
        let tokens = |sid: &str| g.parents.iter().find(|p| p.session_id == sid).unwrap().children_tokens;
        assert_eq!(tokens(dispatcher), 34698 + 37338);
        assert_eq!(tokens("2f8a61c0-4d3b-4e7a-b1c9-5d0e7f3a2b14"), 0, "an older parent loses to a younger one");
        assert_eq!(tokens("c41e0b7d-8a25-4f63-9e0d-3b7a6c5f1e28"), 0, "a parent started after the child cannot own it");
        // mnemo-wt-244 started days before the only mnemo parent.
        let m = groups.iter().find(|g| g.name == "mnemo").unwrap();
        assert!(m.children.iter().find(|c| c.id == "04082ea7").unwrap().parent_session.is_none());
        assert_eq!(m.parents[0].children_tokens, 0);
    }

    #[test]
    fn a_declared_parent_wins_over_the_heuristic() {
        let parent = |sid: &str, cwd: &str| ParentSession {
            session_id: sid.into(), pid: None, name: None, status: "idle".into(), cwd: cwd.into(), tokens: 0, cache_read: 0, children_tokens: 0,
        };
        let mut parents = vec![parent("old", "/r"), parent("young", "/r")];
        let mut children = parse_sessions(SESSIONS).unwrap().into_iter().take(2).collect::<Vec<_>>();
        for c in &mut children {
            c.cwd = "/r".into();
        }
        children[0].parent_session = parse_declared_parent(r#"{"parent_session":"old","parent_pid":1,"contract":null}"#);
        assert_eq!(parse_declared_parent(r#"{"parent_session":""}"#), None);
        assert_eq!(parse_declared_parent("not json"), None);
        let parent_starts = HashMap::from([("old".to_string(), 1), ("young".to_string(), 2)]);
        let child_starts = children.iter().map(|c| (c.id.clone(), 3)).collect();
        link_children(&mut parents, &mut children, &HashMap::new(), &parent_starts, &child_starts);
        assert_eq!(children[0].parent_session.as_deref(), Some("old"));
        assert_eq!(children[1].parent_session.as_deref(), Some("young"));
        assert_eq!(parents[0].children_tokens, children[0].tokens);
        assert_eq!(parents[1].children_tokens, children[1].tokens);
    }

    #[test]
    fn transcript_sums_usage_once_per_message() {
        let mut t = Tally::default();
        t.feed(TRANSCRIPT);
        // msg …0001 is written twice (thinking, then tool_use); its last line counts.
        assert_eq!(t.tokens, (3 + 120) + (10 + 450));
        assert_eq!(t.cache_read, 12000 + 17000);
        assert_eq!(t.first_at, Some(1789431000000), "the snapshot line has no top-level timestamp");
        assert_eq!(t.lines_read, 7);
    }

    #[test]
    fn transcript_refresh_reads_only_appended_lines() {
        use std::io::Write;
        let dir = crate::testutil::temp_dir("tally");
        let path = dir.join("s.jsonl");
        std::fs::write(&path, TRANSCRIPT).unwrap();
        let mut t = Tally::default();
        t.refresh(&path).unwrap();
        assert_eq!((t.tokens, t.cache_read, t.lines_read), (583, 29000, 7));
        t.refresh(&path).unwrap();
        assert_eq!(t.lines_read, 0, "unchanged file is not read again");

        let line = |id: &str, out: u64| {
            format!(r#"{{"type":"assistant","message":{{"id":"{id}","usage":{{"input_tokens":5,"cache_read_input_tokens":100,"output_tokens":{out}}}}},"timestamp":"2026-09-15T00:30:00.000Z"}}"#)
        };
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{}
{}", line("msg_a", 20), line("msg_b", 30)).unwrap();
        t.refresh(&path).unwrap();
        assert_eq!(t.lines_read, 2);
        assert_eq!((t.tokens, t.cache_read), (583 + 25 + 35, 29000 + 200));
        assert_eq!(t.first_at, Some(1789431000000));

        // A line still being written waits for its newline.
        let half = line("msg_c", 40);
        write!(f, "{}", &half[..20]).unwrap();
        t.refresh(&path).unwrap();
        assert_eq!((t.lines_read, t.tokens), (0, 643));
        writeln!(f, "{}", &half[20..]).unwrap();
        t.refresh(&path).unwrap();
        assert_eq!((t.lines_read, t.tokens), (1, 643 + 45));

        // A rewritten, shorter file starts over.
        std::fs::write(&path, format!("{}\n", line("msg_z", 1))).unwrap();
        t.refresh(&path).unwrap();
        assert_eq!((t.lines_read, t.tokens, t.cache_read), (1, 6, 100));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn iso_timestamps_and_project_dirs() {
        assert_eq!(iso_ms("2026-09-15T00:41:39.813Z"), Some(1789432899813));
        assert_eq!(iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_ms("2024-02-29T12:00:00.5Z"), Some(1709208000500));
        assert_eq!(iso_ms("yesterday"), None);
        assert_eq!(project_dir_name("/Users/xyrlan/github/mnemo-desktop"), "-Users-xyrlan-github-mnemo-desktop");
        assert_eq!(project_dir_name("/Users/xyrlan/.claude/jobs/1f87be87/tmp"), "-Users-xyrlan--claude-jobs-1f87be87-tmp");
    }

    /// Against this machine's real `claude agents` and transcripts:
    /// `cargo test live_snapshot -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_snapshot_counts_parent_tokens() {
        let snap = collect_snapshot(None, false);
        let parents: Vec<&ParentSession> = snap.repos.iter().flat_map(|g| &g.parents).collect();
        let linked = snap.repos.iter().flat_map(|g| g.children.iter().chain(g.missions.iter().flat_map(|m| m.pieces.iter().filter_map(|p| p.child.as_ref()))));
        println!("errors: {}", snap.errors.len());
        for p in &parents {
            println!("parent {} tokens={} cache_read={} children_tokens={}", p.session_id, p.tokens, p.cache_read, p.children_tokens);
        }
        let linked: Vec<&ChildSession> = linked.collect();
        println!("children linked: {}", linked.iter().filter(|c| c.parent_session.is_some()).count());
        for c in linked.iter().filter(|c| c.waiting_for.is_some()) {
            println!("child {} waiting_for={:?} needs={:?}", c.id, c.waiting_for, c.needs);
        }
        assert!(parents.iter().any(|p| p.tokens > 0), "no parent has tokens");
        // The second poll only reads what was appended in between.
        let again = collect_snapshot(None, false);
        assert!(again.repos.iter().flat_map(|g| &g.parents).any(|p| p.tokens > 0));
    }

    #[test]
    fn protected_folders_are_the_tcc_ones() {
        let home = "/Users/me";
        for p in ["/Users/me/Downloads", "/Users/me/Downloads/x", "/Users/me/Desktop/a/b", "/Users/me/Documents/gh/r", "/Volumes/usb/r"] {
            assert!(is_protected(p, home), "{p}");
        }
        for p in ["/Users/me/github/r", "/Users/me/Downloads2/x", "/Users/me", "/Volumes", "/Users/other/Downloads/x"] {
            assert!(!is_protected(p, home), "{p}");
        }
        assert!(!is_protected("/Downloads/x", ""));
    }

    #[test]
    fn worktree_root_resolves_to_main_checkout() {
        let tmp = crate::testutil::temp_dir("wt");
        let main = tmp.join("main");
        std::fs::create_dir_all(&main).unwrap();
        let git = |args: &[&str], cwd: &Path| {
            let ok = Command::new("git").args(args).current_dir(cwd).output().unwrap().status.success();
            assert!(ok, "git {:?}", args);
        };
        git(&["init", "-q", "-b", "main"], &main);
        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], &main);
        let wt = tmp.join("wt");
        git(&["worktree", "add", "-q", "-b", "feat/x/y", wt.to_str().unwrap()], &main);
        let canon = |p: &Path| p.canonicalize().unwrap().to_string_lossy().to_string();
        assert_eq!(repo_root(wt.to_str().unwrap()).map(|r| canon(Path::new(&r))), Some(canon(&main)));
        assert_eq!(repo_root(main.to_str().unwrap()).map(|r| canon(Path::new(&r))), Some(canon(&main)));
        let b = worktree_branches(main.to_str().unwrap());
        assert_eq!(b.get(&canon(&wt)).map(String::as_str), Some("feat/x/y"), "keys: {:?}", b.keys().collect::<Vec<_>>());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn marked_path_is_read_between_markers_even_with_rc_noise() {
        assert_eq!(extract_marked_path("banner\nmotd\x1fMNEMO_PATH=/a:/b\x1f\nprompt%").as_deref(), Some("/a:/b"));
        assert_eq!(extract_marked_path("\x1fMNEMO_PATH=\x1f"), None);
        assert_eq!(extract_marked_path("no markers"), None);
    }

    #[test]
    fn merge_paths_keeps_order_dedupes_and_adds_only_existing_extras() {
        let tmp = std::env::temp_dir();
        let existing = tmp.to_string_lossy().to_string();
        let missing = tmp.join("definitely-missing-dir-xyz").to_string_lossy().to_string();
        let merged = merge_paths("/a:/b", "/b:/c:", &[existing.clone(), missing.clone()]);
        assert_eq!(merged, format!("/a:/b:/c:{existing}"));
        assert!(!merged.contains(&missing));
    }

    #[test]
    #[cfg(unix)]
    fn login_path_includes_the_profile_dirs_and_never_loses_inherited_ones() {
        let p = login_path();
        assert!(p.split(':').any(|d| d == "/usr/bin"), "got {p}");
        for d in std::env::var("PATH").unwrap_or_default().split(':').filter(|d| !d.is_empty()) {
            assert!(p.split(':').any(|x| x == d), "inherited {d} missing from {p}");
        }
    }

    #[test]
    fn run_carries_the_login_path() {
        // The login profile on a dev box adds dirs launchd would not know about;
        // whatever it adds, `run` must resolve programs through the same list.
        assert!(run("git", &["--version"], None).map(|o| o.starts_with("git version")).unwrap_or(false));
        assert!(!login_path().is_empty());
    }

    #[test]
    fn looked_marker_round_trips() {
        let home = crate::testutil::temp_dir("home");
        let prev = std::env::var_os("HOME");
        std::env::set_var("HOME", &home);
        mark_looked("abc", 7).unwrap();
        assert_eq!(read_looked().get("abc"), Some(&7));
        match prev { Some(p) => std::env::set_var("HOME", p), None => std::env::remove_var("HOME") }
        let _ = std::fs::remove_dir_all(&home);
    }
}

// -------------------------------------------------------------- reply --

/// Where a `--bg` child's inbox socket lives. The daemon's roster maps a short id
/// to its pty-host pid; the Claude session is that process's child, and the
/// session's inbox is `/tmp/cc-socks/<session pid>.sock` (or `cc-socks-<n>`).
#[derive(Debug, Deserialize)]
struct Roster {
    workers: HashMap<String, RosterWorker>,
}
#[derive(Debug, Deserialize)]
struct RosterWorker {
    pid: u32,
}

pub fn roster_pid(roster_json: &str, id: &str) -> Option<u32> {
    serde_json::from_str::<Roster>(roster_json).ok()?.workers.get(id).map(|w| w.pid)
}

fn child_pids(pid: u32) -> Vec<u32> {
    // `run` already carries the login PATH, so pgrep resolves from the Dock too.
    run("pgrep", &["-P", &pid.to_string()], None)
        .map(|s| s.lines().filter_map(|l| l.trim().parse().ok()).collect())
        .unwrap_or_default()
}

pub fn socket_dirs() -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from("/tmp/cc-socks")];
    if let Ok(rd) = std::fs::read_dir("/tmp") {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("cc-socks-") {
                out.push(e.path());
            }
        }
    }
    out
}

fn socket_for_pid(pid: u32) -> Option<PathBuf> {
    socket_dirs().into_iter().map(|d| d.join(format!("{pid}.sock"))).find(|p| p.exists())
}

/// Resolve a child's inbox socket: roster pid → its children → the one with a socket.
pub fn inbox_socket(id: &str) -> Result<PathBuf, String> {
    let roster_path = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default().join(".claude").join("daemon").join("roster.json");
    let roster = std::fs::read_to_string(&roster_path).map_err(|e| format!("roster.json: {e}"))?;
    let host = roster_pid(&roster, id).ok_or_else(|| format!("{id} is not in the daemon roster"))?;
    let mut candidates = child_pids(host);
    candidates.push(host);
    for pid in candidates {
        if let Some(p) = socket_for_pid(pid) {
            return Ok(p);
        }
    }
    Err(format!("no inbox socket found for {id} (pty host pid {host})"))
}

/// Post one user message into a session's inbox. Format taken from Claude Code's
/// own help text: an optional auth line, then a `stream-json` user turn.
#[cfg(unix)]
pub fn post_message(sock: &Path, token: Option<&str>, text: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    let mut s = UnixStream::connect(sock).map_err(|e| format!("connect {}: {e}", sock.display()))?;
    s.set_write_timeout(Some(std::time::Duration::from_secs(5))).ok();
    if let Some(t) = token {
        let auth = serde_json::json!({ "type": "auth", "token": t });
        writeln!(s, "{auth}").map_err(|e| format!("auth: {e}"))?;
    }
    let msg = serde_json::json!({ "type": "user", "message": { "role": "user", "content": text } });
    writeln!(s, "{msg}").map_err(|e| format!("write: {e}"))?;
    s.flush().map_err(|e| format!("flush: {e}"))?;
    Ok(())
}

#[cfg(not(unix))]
pub fn post_message(_sock: &Path, _token: Option<&str>, _text: &str) -> Result<(), String> {
    Err("replying through the inbox socket is not supported on this platform yet".into())
}

pub fn reply(id: &str, text: &str) -> Result<(), String> {
    let sock = inbox_socket(id)?;
    post_message(&sock, None, text)
}

#[cfg(all(test, unix))]
mod reply_tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::os::unix::net::UnixListener;

    const ROSTER: &str = include_str!("../fixtures/roster.json");

    #[test]
    fn roster_maps_short_id_to_pty_host_pid() {
        assert_eq!(roster_pid(ROSTER, "a43d3832"), Some(20126));
        assert_eq!(roster_pid(ROSTER, "nope"), None);
        assert_eq!(roster_pid("{}", "a43d3832"), None);
    }

    #[test]
    fn post_message_writes_auth_then_user_turn_as_json_lines() {
        let dir = crate::testutil::temp_dir("sock");
        let path = dir.join("s.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (conn, _) = listener.accept().unwrap();
            BufReader::new(conn).lines().map(|l| l.unwrap()).collect::<Vec<_>>()
        });
        post_message(&path, Some("tok"), "yes, go ahead").unwrap();
        let lines = server.join().unwrap();
        assert_eq!(lines.len(), 2);
        let auth: serde_json::Value = serde_json::from_str(&lines[0]).unwrap();
        assert_eq!(auth["type"], "auth");
        assert_eq!(auth["token"], "tok");
        let msg: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();
        assert_eq!(msg["type"], "user");
        assert_eq!(msg["message"]["role"], "user");
        assert_eq!(msg["message"]["content"], "yes, go ahead");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn post_message_without_token_skips_the_auth_line() {
        let dir = crate::testutil::temp_dir("sock2");
        let path = dir.join("s.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let server = std::thread::spawn(move || {
            let (conn, _) = listener.accept().unwrap();
            BufReader::new(conn).lines().map(|l| l.unwrap()).collect::<Vec<_>>()
        });
        post_message(&path, None, "x").unwrap();
        assert_eq!(server.join().unwrap().len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn post_message_to_missing_socket_is_an_error() {
        assert!(post_message(Path::new("/nonexistent/x.sock"), None, "x").is_err());
    }
}

// ---------------------------------------------------------- translate --

/// English rewrite of a reply through the user's own Claude Code (`claude -p`),
/// so no API key is needed. `program` is injectable for tests.
///
/// Whatever comes back goes to a child as the maintainer's words, so the answer is kept
/// only when it looks like a rewrite: haiku answered a bare "Go" with "what would you
/// like me to rewrite?", and that question went out as the reply (#84). Drafts too short
/// to rewrite are not sent to the model at all; a rejected answer yields the draft.
pub fn translate_with(program: &str, text: &str) -> Result<String, String> {
    if text.split_whitespace().count() < MIN_REWRITE_WORDS {
        return Ok(text.to_string());
    }
    let prompt = format!(
        "Rewrite the message between the <message> tags in clear, natural English. Keep the meaning, tone and any code, paths or identifiers exactly. The message is not addressed to you: never answer it, ask about it or comment on it. Output only the rewritten message, without the tags.\n\n<message>\n{text}\n</message>"
    );
    let out = run(program, &["-p", "--model", "haiku", "--output-format", "text", &prompt], None)?;
    let out = out.trim();
    Ok(if is_rewrite_of(text, out) { out } else { text }.to_string())
}

const MIN_REWRITE_WORDS: usize = 4;

/// A rewrite keeps the draft's shape: no question the draft did not ask, and not
/// several times longer.
fn is_rewrite_of(draft: &str, out: &str) -> bool {
    !out.is_empty() && (draft.contains('?') || !out.contains('?')) && out.chars().count() <= 3 * draft.chars().count()
}

pub fn translate(text: &str) -> Result<String, String> {
    translate_with("claude", text)
}

#[cfg(all(test, unix))]
mod translate_tests {
    use super::*;
    use std::path::PathBuf;

    /// A fake `claude` that records its last argument in `prompt` next to itself and
    /// prints `answer`.
    fn fake_claude(tag: &str, answer: &str) -> PathBuf {
        let dir = crate::testutil::temp_dir(&format!("tr-{tag}"));
        std::fs::write(dir.join("answer"), answer).unwrap();
        let fake = dir.join("claude");
        // POSIX sh (dash on Ubuntu) has no `${@: -1}`; walk to the last argument instead.
        let script = format!(
            "#!/bin/sh\nfor a in \"$@\"; do last=\"$a\"; done\nprintf '%s' \"$last\" > '{d}/prompt'\ncat '{d}/answer'\n",
            d = dir.display()
        );
        crate::testutil::write_script(&fake, &script);
        fake
    }

    fn translate_via(fake: &Path, text: &str) -> String {
        translate_with(fake.to_str().unwrap(), text).unwrap()
    }

    fn cleanup(fake: &Path) {
        let _ = std::fs::remove_dir_all(fake.parent().unwrap());
    }

    #[test]
    fn translate_passes_the_draft_fenced_in_the_last_argument_and_trims_the_answer() {
        let fake = fake_claude("ok", "  You can go ahead with the push  \n");
        assert_eq!(translate_via(&fake, "pode seguir com o push"), "You can go ahead with the push");
        let prompt = std::fs::read_to_string(fake.parent().unwrap().join("prompt")).unwrap();
        assert!(prompt.starts_with("Rewrite the message"), "{prompt}");
        assert!(prompt.ends_with("<message>\npode seguir com o push\n</message>"), "{prompt}");
        cleanup(&fake);
    }

    #[test]
    fn an_answer_that_asks_a_question_the_draft_did_not_sends_the_draft() {
        let fake = fake_claude("q", "I need to ask: what would you like me to rewrite? You've sent 'Go' but there's no message to rewrite.");
        assert_eq!(translate_via(&fake, "pode seguir com o push"), "pode seguir com o push");
        cleanup(&fake);
    }

    #[test]
    fn a_question_in_the_draft_may_stay_a_question() {
        let fake = fake_claude("q2", "Can you push it now?");
        assert_eq!(translate_via(&fake, "pode fazer o push agora?"), "Can you push it now?");
        cleanup(&fake);
    }

    #[test]
    fn an_answer_over_three_times_the_draft_sends_the_draft() {
        let draft = "sim pode seguir agora";
        let fake = fake_claude("long", &"Sure. ".repeat(draft.len()));
        assert_eq!(translate_via(&fake, draft), draft);
        cleanup(&fake);
    }

    #[test]
    fn an_empty_answer_sends_the_draft() {
        let fake = fake_claude("empty", "  \n");
        assert_eq!(translate_via(&fake, "sim pode seguir agora"), "sim pode seguir agora");
        cleanup(&fake);
    }

    #[test]
    fn a_draft_under_four_words_never_reaches_the_model() {
        // A missing program would be an error, so Ok proves nothing was spawned.
        assert_eq!(translate_with("/nonexistent/claude", "Go"), Ok("Go".to_string()));
        assert_eq!(translate_with("/nonexistent/claude", "Yes for all"), Ok("Yes for all".to_string()));
    }

    #[test]
    fn translate_reports_a_missing_program() {
        assert!(translate_with("/nonexistent/claude", "pode seguir com o push").is_err());
    }
}

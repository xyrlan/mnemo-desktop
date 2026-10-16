//! Grok Build sessions in the fleet (spec `2026-10-16-grok-accounts-design.md`, decisions 5 and 6):
//! what the cockpit, Home and the Nexus list beside Claude's sessions, and how a reply reaches one.
//!
//! The app has no ACP client of its own. Everything live comes from `mnemo grok`:
//! - **Roster:** `mnemo grok roster --json --home <dir>` for each Grok account that is logged in,
//!   asked at most once per `AGENTS_FRESH` and shared as `claude agents` is (`asked::agents`).
//!   Its rows are `{session_id, short_id, cwd, activity, resident, model_id, effort, title,
//!   last_change_ms, home}` (mnemo's `cli/commands/grok.py`, `_row`). `activity` is `working |
//!   idle | needs_input | dormant | completed | dead`; headless (`-p`) sessions are not in it.
//! - **Reply:** `mnemo grok send --home <dir> -- <id> <text>`: a user turn through the leader,
//!   never typed into a terminal. `--` keeps a reply that starts with `-` the reply (measured on
//!   mnemo's parser: `send --home H -- ID "-x hi"` reads `-x hi` as the text).
//!
//! What only the disk says comes from the session's own directory, `<home>/sessions/<encoded
//! cwd>/<id>/` (mnemo's `core/grok/paths.py`): `chat_history.jsonl` through [`history_path`], and
//! beside it `usage.json` for tokens and `events.jsonl` for what a waiting session waits on.
//!
//! Children are the ones mnemo recorded at dispatch in `<vault>/.mnemo/child-agents.jsonl`
//! (`mnemo.core.sessions.child_agents`): `{short_id, agent, session_id, home, cwd}`, one line per
//! Grok session dispatch spawned *or was run from*, the later line for a short id winning. A child
//! is a line whose cwd is a dispatch worktree; the others are Grok sessions that dispatched. mnemo
//! keys a Grok session in every `.mnemo/` ledger by [`short_id`], its *last* eight hex digits.
//!
//! A Grok row's `id` is its full session id: `grok -r` takes a UUID-shaped value as an id and
//! anything else as a title (`grok --help`, 1.0.60), so the short id would not reopen it.

use super::account_dirs::{Account, AccountEnv, Accounts};
use super::{ChildSession, ParentSession};
use crate::agent_kind::AgentKind;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// mnemo's ledger of which CLI each dispatched session runs on, under `<vault>/.mnemo/`.
pub const LEDGER: &str = "child-agents.jsonl";

/// What every other `waiting_for` in the fleet says for a session parked on a question
/// (`claude agents`' word, which `fleet/model.ts` reads as a question).
pub const INPUT_NEEDED: &str = "input needed";
/// The same for a session parked on a permission request.
pub const PERMISSION_PROMPT: &str = "permission prompt";

// ------------------------------------------------------------- parsing --

/// One row of `mnemo grok roster --json`.
#[derive(Debug, Clone, PartialEq)]
pub struct RosterRow {
    pub session_id: String,
    pub cwd: String,
    pub activity: String,
    pub resident: bool,
    pub model_id: Option<String>,
    pub effort: Option<String>,
    pub title: Option<String>,
    pub last_change_ms: Option<u64>,
}

/// `mnemo grok roster --json`. A row without a session id is skipped.
pub fn parse_roster(json: &str) -> Result<Vec<RosterRow>, String> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(json).map_err(|e| format!("grok roster json: {e}"))?;
    let s = |r: &serde_json::Value, k: &str| r.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string);
    Ok(rows
        .iter()
        .filter_map(|r| {
            Some(RosterRow {
                session_id: s(r, "session_id")?,
                cwd: s(r, "cwd").unwrap_or_default(),
                activity: s(r, "activity").unwrap_or_default(),
                resident: r.get("resident").and_then(|x| x.as_bool()).unwrap_or(false),
                model_id: s(r, "model_id"),
                effort: s(r, "effort"),
                title: s(r, "title"),
                last_change_ms: r.get("last_change_ms").and_then(|x| x.as_u64()),
            })
        })
        .collect())
}

/// Whether a session is running in its leader now: resident, and doing or waiting on something.
/// `dormant` was unloaded when its last client left; `completed` and `dead` are over.
pub fn is_live(row: &RosterRow) -> bool {
    row.resident && matches!(row.activity.as_str(), "working" | "idle" | "needs_input")
}

/// mnemo's key for a Grok session in every `.mnemo/` ledger: its last eight hex digits
/// (`paths.short_id`). Grok ids are UUIDv7, time-prefixed, so the first eight collide.
pub fn short_id(session_id: &str) -> String {
    let hex: String = session_id.chars().filter(|c| *c != '-').collect();
    hex[hex.len().saturating_sub(8)..].to_ascii_lowercase()
}

/// When a UUIDv7 was made, in epoch ms: its first 48 bits. None for anything else.
pub fn uuid7_ms(session_id: &str) -> Option<u64> {
    let hex: String = session_id.chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 || hex.as_bytes().get(12) != Some(&b'7') {
        return None;
    }
    u64::from_str_radix(hex.get(..12)?, 16).ok()
}

/// Epoch ms as the fleet's other timestamps read: `2026-10-16T14:31:11.072Z`.
pub fn iso_of_ms(ms: u64) -> String {
    let days = (ms / 86_400_000) as i64;
    let rem = ms % 86_400_000;
    // Civil from days (Howard Hinnant), the inverse of `iso_ms`.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    let (h, mi, s, milli) = (rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{milli:03}Z")
}

/// One line of mnemo's `child-agents.jsonl`.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildAgent {
    pub short_id: String,
    pub agent: String,
    pub session_id: String,
    pub home: Option<String>,
    pub cwd: String,
}

/// `short id → ChildAgent` for every Grok line, read as mnemo's `child_agents.read` reads it: a
/// line that is not an object with a short id, a known agent and a session id is skipped, and a
/// later line for a short id wins. Lines naming Claude are left out: they say nothing the jobs do
/// not.
pub fn parse_child_agents(text: &str) -> HashMap<String, ChildAgent> {
    let mut out = HashMap::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty()).map(str::to_string);
        let (Some(short), Some(agent), Some(session_id)) = (s("short_id"), s("agent"), s("session_id")) else { continue };
        if !matches!(agent.as_str(), "claude" | "grok") || v.get("cwd").and_then(|c| c.as_str()).is_none() {
            continue;
        }
        if agent == "grok" {
            out.insert(short.clone(), ChildAgent { short_id: short, agent, session_id, home: s("home"), cwd: s("cwd").unwrap_or_default() });
        } else {
            out.remove(&short);
        }
    }
    out
}

/// The ledger as the vault holds it now; empty without a vault or a file.
pub fn read_child_agents() -> HashMap<String, ChildAgent> {
    crate::vault::vault_root()
        .and_then(|v| std::fs::read_to_string(v.join(".mnemo").join(LEDGER)).ok())
        .map(|t| parse_child_agents(&t))
        .unwrap_or_default()
}

/// The ledger's children: Grok sessions dispatched into a worktree, as opposed to the Grok
/// sessions that ran `mnemo dispatch` (mnemo's `dispatch.issue_for_cwd`; the app's
/// `home::is_dispatch_child`).
pub fn ledger_children(ledger: &HashMap<String, ChildAgent>) -> Vec<&ChildAgent> {
    let mut out: Vec<&ChildAgent> = ledger.values().filter(|c| crate::home::is_dispatch_child(&c.cwd)).collect();
    out.sort_by(|a, b| a.session_id.cmp(&b.session_id));
    out
}

/// A session's token use from its `usage.json`: `(inputTokens + outputTokens, cachedReadTokens)`
/// of `session`, as Claude's tally keeps cache reads apart. Measured on grok 1.0.60: the file sits
/// beside `chat_history.jsonl` and `chat_history.jsonl` carries no usage at all; whether
/// `inputTokens` already counts the cached read could not be measured (the free account had hit
/// its limit and the session's counts were all 0).
pub fn parse_usage(json: &str) -> Option<(u64, u64)> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let s = v.get("session")?;
    let n = |k: &str| s.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    Some((n("inputTokens") + n("outputTokens"), n("cachedReadTokens")))
}

/// What a session waiting on its user (`needs_input`) waits on, from its `events.jsonl`: a
/// permission when a `permission_requested` came after the turn that is running started, a
/// question otherwise (Grok's Notification hook says `elicitation_dialog` for those).
pub fn waiting_on(events: &str) -> &'static str {
    let mut asked = false;
    for line in events.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("turn_started") => asked = false,
            Some("permission_requested") => asked = true,
            _ => {}
        }
    }
    if asked {
        PERMISSION_PROMPT
    } else {
        INPUT_NEEDED
    }
}

// ----------------------------------------------------------------- disk --

/// `chat_history.jsonl` of `session_id` under the Grok home `home`, in whatever cwd's directory
/// holds it (the long-cwd `<slug>-<hash>` form included, since the id is looked for in every one).
///
/// Stand-in for conversation-grok's `grok_history_path(home, session_id)` until it lands, with the
/// same signature and rule; then this calls it.
pub fn history_path(home: &Path, session_id: &str) -> Option<PathBuf> {
    if session_id.is_empty() || session_id.contains(['/', '\\']) || session_id.starts_with('.') {
        return None;
    }
    std::fs::read_dir(home.join("sessions")).ok()?.flatten().map(|e| e.path().join(session_id).join("chat_history.jsonl")).find(|p| p.is_file())
}

/// The token use of a session under `home`, read through its history's directory.
pub fn tokens_of(home: &Path, session_id: &str) -> Option<(u64, u64)> {
    let dir = history_path(home, session_id)?.parent()?.to_path_buf();
    parse_usage(&std::fs::read_to_string(dir.join("usage.json")).ok()?)
}

fn events_of(home: &Path, session_id: &str) -> String {
    history_path(home, session_id)
        .and_then(|h| std::fs::read_to_string(h.with_file_name("events.jsonl")).ok())
        .unwrap_or_default()
}

/// One session directory's `summary.json` as Home lists it.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub id: String,
    pub cwd: String,
    pub title: String,
    pub first_at: u64,
    pub last_at: u64,
}

/// A session's `summary.json`, None for a headless (`-p`) one, which no one opens again: the
/// rewrite helper's and mnemo's own model calls are those. Measured on grok 1.0.60: `info.id`,
/// `info.cwd`, `created_at`, `updated_at`, `last_active_at`, `generated_title`,
/// `session_summary`, `session_kind: "headless"` for `-p`.
pub fn parse_summary(json: &str) -> Option<Summary> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    if v.get("session_kind").and_then(|k| k.as_str()) == Some("headless") {
        return None;
    }
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty());
    let info = v.get("info")?;
    let ms = |k: &str| s(k).and_then(super::iso_ms);
    let first_at = ms("created_at").unwrap_or(0);
    Some(Summary {
        id: info.get("id")?.as_str()?.to_string(),
        cwd: info.get("cwd").and_then(|c| c.as_str()).unwrap_or_default().to_string(),
        title: s("generated_title").or_else(|| s("session_summary")).unwrap_or_default().lines().next().unwrap_or("").to_string(),
        first_at,
        last_at: ms("last_active_at").or_else(|| ms("updated_at")).unwrap_or(first_at),
    })
}

/// Every session a Grok home keeps that is not headless, each with a history.
pub fn summaries(home: &Path) -> Vec<Summary> {
    let Ok(cwds) = std::fs::read_dir(home.join("sessions")) else { return vec![] };
    cwds.flatten()
        .filter_map(|d| std::fs::read_dir(d.path()).ok())
        .flat_map(|ids| ids.flatten())
        .filter(|e| e.path().join("chat_history.jsonl").is_file())
        .filter_map(|e| parse_summary(&std::fs::read_to_string(e.path().join("summary.json")).ok()?))
        .filter(|s| !s.cwd.is_empty())
        .collect()
}

// ------------------------------------------------------------- accounts --

/// The Grok accounts the app has, in the list's order.
pub fn accounts_of(accounts: &Accounts) -> impl Iterator<Item = &Account> {
    accounts.iter().filter(|a| a.kind == AgentKind::Grok)
}

/// Whether a Grok home has a login to ask its leader with. A home without one has no sessions to
/// list, and `mnemo grok` would only say so on every poll.
pub fn logged_in(a: &Account) -> bool {
    a.config_dir.join("auth.json").is_file()
}

/// The Grok account whose home is `home`, the paths compared as paths.
pub fn account_at<'a>(accounts: &'a Accounts, home: &Path) -> Option<&'a Account> {
    let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    accounts_of(accounts).find(|a| a.config_dir == home || canon(&a.config_dir) == canon(home))
}

/// What a command needs to reach a session in the Grok home `home`: its account's, or for a home
/// no account names any longer (removed from the list), the same rule applied to the home itself.
pub fn env_at(accounts: &Accounts, home: &Path) -> (String, AccountEnv) {
    match account_at(accounts, home) {
        Some(a) => (a.id.clone(), a.env()),
        None => {
            let a = Account { id: home.to_string_lossy().to_string(), config_dir: home.to_path_buf(), is_default: false, kind: AgentKind::Grok };
            (a.id.clone(), a.env())
        }
    }
}

/// A ledger line's home: the one it names, else Grok's default `~/.grok`.
pub fn home_of_line(c: &ChildAgent) -> PathBuf {
    c.home.as_deref().map(PathBuf::from).unwrap_or_else(|| crate::app_dir::home().join(AgentKind::Grok.default_dir_name()))
}

// --------------------------------------------------------------- asking --

/// The shared answer's key for a Grok account, apart from every `claude agents` key.
fn roster_key(a: &Account) -> String {
    format!("grok\n{}\n{}", a.id, a.config_dir.display())
}

/// `mnemo grok roster --json --home <dir>` on `a`, asked at or after `not_before`, one ask per
/// account at a time whoever asks (`asked::agents`).
pub fn roster_answer(accounts: &Accounts, a: &Account, not_before: std::time::Instant) -> Result<String, String> {
    let home = a.config_dir.to_string_lossy().to_string();
    super::asked::agents().get(&roster_key(a), not_before, std::time::Instant::now, || {
        super::run_on(accounts, a, "mnemo", &["grok", "roster", "--json", "--home", &home], None)
    })
}

/// Every logged-in Grok account's roster, at once, asked at or after `not_before`.
pub fn rosters_since<'a>(accounts: &'a Accounts, not_before: std::time::Instant) -> Vec<(&'a Account, Result<Vec<RosterRow>, String>)> {
    std::thread::scope(|s| {
        let asks: Vec<_> = accounts_of(accounts)
            .filter(|a| logged_in(a))
            .map(|a| (a, s.spawn(move || roster_answer(accounts, a, not_before).and_then(|j| parse_roster(&j)))))
            .collect();
        asks.into_iter().map(|(a, h)| (a, h.join().unwrap_or_else(|_| Err("mnemo grok roster panicked".to_string())))).collect()
    })
}

/// `rosters_since`, at most `AGENTS_FRESH` old.
pub fn rosters<'a>(accounts: &'a Accounts) -> Vec<(&'a Account, Result<Vec<RosterRow>, String>)> {
    let now = std::time::Instant::now();
    rosters_since(accounts, now.checked_sub(super::AGENTS_FRESH).unwrap_or(now))
}

/// The last roster of every Grok account, however old, asking nothing.
pub fn rosters_last(accounts: &Accounts) -> Vec<(&Account, Vec<RosterRow>)> {
    accounts_of(accounts)
        .filter_map(|a| {
            let (_, got) = super::asked::agents().last(&roster_key(a))?;
            Some((a, got.ok().and_then(|j| parse_roster(&j).ok())?))
        })
        .collect()
}

// ----------------------------------------------------------------- rows --

/// A live Grok session that is not a child, as a parent row: `claude agents`' words for its state
/// (`busy`, `idle`, `waiting` with what it waits on), on `account`.
pub fn parent_of_row(row: &RosterRow, account: &str, env: Option<AccountEnv>, waiting: impl FnOnce() -> &'static str) -> Option<ParentSession> {
    if !is_live(row) {
        return None;
    }
    let (status, waiting_for) = match row.activity.as_str() {
        "working" => ("busy", None),
        "needs_input" => ("waiting", Some(waiting().to_string())),
        _ => ("idle", None),
    };
    Some(ParentSession {
        session_id: row.session_id.clone(),
        pid: None,
        name: row.title.clone(),
        status: status.to_string(),
        cwd: row.cwd.clone(),
        tokens: 0,
        cache_read: 0,
        children_tokens: 0,
        waiting_for,
        account: account.to_string(),
        account_env: env,
    })
}

/// A Grok child as `mnemo sessions` lists a Claude one: its state from the roster row of its own
/// home (`row`, None when that leader is down or has forgotten it: then what the disk says, which is
/// that it is not running), its account from the home it was dispatched on.
pub fn child_row(c: &ChildAgent, row: Option<&RosterRow>, account: String, env: AccountEnv, waiting: impl FnOnce() -> &'static str) -> ChildSession {
    let activity = row.map(|r| r.activity.as_str()).unwrap_or("");
    let live = row.is_some_and(is_live);
    let (state, tempo) = match activity {
        "working" => ("working", "active"),
        "needs_input" => ("blocked", "blocked"),
        "completed" => ("done", "done"),
        "dead" => ("stopped", "stopped"),
        _ => ("idle", "idle"),
    };
    let waiting_for = (activity == "needs_input").then(|| waiting().to_string());
    ChildSession {
        id: c.session_id.clone(),
        session_id: Some(c.session_id.clone()),
        name: row.and_then(|r| r.title.clone()),
        state: state.to_string(),
        tempo: tempo.to_string(),
        needs: None,
        detail: String::new(),
        suggested_reply: None,
        cwd: if c.cwd.is_empty() { row.map(|r| r.cwd.clone()).unwrap_or_default() } else { c.cwd.clone() },
        tokens: 0,
        live,
        updated_at: row.and_then(|r| r.last_change_ms).or_else(|| uuid7_ms(&c.session_id)).map(iso_of_ms),
        intent: None,
        branch: None,
        timeline_len: 0,
        parent_session: None,
        waiting_for,
        model: row.and_then(|r| r.model_id.clone()),
        effort: row.and_then(|r| r.effort.clone()),
        pr: None,
        account,
        account_env: Some(env),
        notice: None,
    }
}

/// The fleet's Grok rows from every roster: the ledger's children, each with its parent and
/// notice looked up by mnemo's Grok short id, and every other live session as a parent. A finished
/// child whose worktree is gone is left out, as `read_job_children` leaves a Claude one out.
pub fn rows(
    accounts: &Accounts,
    rosters: &[(&Account, Vec<RosterRow>)],
    ledger: &HashMap<String, ChildAgent>,
    parents: &HashMap<String, String>,
    notices: &HashMap<String, String>,
) -> (Vec<ParentSession>, Vec<ChildSession>) {
    let row_in = |home: &Path, id: &str| {
        let a = account_at(accounts, home)?;
        rosters.iter().find(|(r, _)| r.id == a.id)?.1.iter().find(|r| r.session_id == id)
    };
    let mut children = Vec::new();
    for c in ledger_children(ledger) {
        let home = home_of_line(c);
        let row = row_in(&home, &c.session_id);
        let (account, env) = env_at(accounts, &home);
        let mut child = child_row(c, row, account, env, || waiting_on(&events_of(&home, &c.session_id)));
        if !child.live && !child.cwd.is_empty() && !Path::new(&child.cwd).is_dir() && child.tempo != "blocked" {
            continue;
        }
        let short = short_id(&c.session_id);
        child.parent_session = parents.get(&short).cloned();
        child.notice = notices.get(&short).cloned();
        child.tokens = tokens_of(&home, &c.session_id).map(|(t, _)| t).unwrap_or(0);
        children.push(child);
    }
    let mut out_parents = Vec::new();
    for (a, rows) in rosters {
        for r in rows.iter().filter(|r| !children.iter().any(|c| c.id == r.session_id)) {
            let home = &a.config_dir;
            if let Some(mut p) = parent_of_row(r, &a.id, accounts.route(a), || waiting_on(&events_of(home, &r.session_id))) {
                if let Some((t, c)) = tokens_of(home, &r.session_id) {
                    (p.tokens, p.cache_read) = (t, c);
                }
                out_parents.push(p);
            }
        }
    }
    (out_parents, children)
}

// -------------------------------------------------------------- acting --

/// The Grok account holding session `id` (a full id, or mnemo's short id): the ledger's home for
/// it, else the home whose sessions keep its history, else the one whose last roster lists it.
/// None, asking nothing, when there is no Grok account.
pub fn holder(accounts: &Accounts, id: &str) -> Option<(PathBuf, String)> {
    accounts_of(accounts).next()?;
    holder_in(accounts, &read_child_agents(), id)
}

/// `holder` with the ledger given.
pub fn holder_in(accounts: &Accounts, ledger: &HashMap<String, ChildAgent>, id: &str) -> Option<(PathBuf, String)> {
    accounts_of(accounts).next()?;
    if let Some(c) = ledger.get(id).or_else(|| ledger.values().find(|c| c.session_id == id)) {
        return Some((home_of_line(c), c.session_id.clone()));
    }
    if let Some(a) = accounts_of(accounts).find(|a| history_path(&a.config_dir, id).is_some()) {
        return Some((a.config_dir.clone(), id.to_string()));
    }
    rosters_last(accounts)
        .into_iter()
        .find_map(|(a, rows)| rows.iter().find(|r| r.session_id == id).map(|r| (a.config_dir.clone(), r.session_id.clone())))
}

/// The argv of `mnemo grok send` for `id` in `home`.
pub fn send_args<'a>(home: &'a str, id: &'a str, text: &'a str) -> [&'a str; 7] {
    ["grok", "send", "--home", home, "--", id, text]
}

/// A user turn for Grok session `id` in `home`, through its leader. Errs with mnemo's reason.
pub fn send(accounts: &Accounts, home: &Path, id: &str, text: &str) -> Result<(), String> {
    let dir = home.to_string_lossy().to_string();
    let args = send_args(&dir, id, text);
    match account_at(accounts, home) {
        Some(a) => super::run_on(accounts, a, "mnemo", &args, None),
        None => super::run_with("mnemo", &args, None, |c| env_at(accounts, home).1.apply(c)),
    }
    .map(|_| ())
}

/// `grok -p`'s argv for the rewrite helper. The only model a free account has is `grok-4.7`, its
/// default (mnemo spec, Facts: there is no smaller one to pick), so none is named; one turn and low
/// effort keep it cheap. Each flag was parsed by grok 1.0.60 (an unknown one is refused before any
/// call), and a refusal (the free limit) exits 1 with its reason on stderr, never a rewrite on
/// stdout.
pub fn helper_args(prompt: &str) -> [&str; 8] {
    ["-p", prompt, "--output-format", "plain", "--max-turns", "1", "--reasoning-effort", "low"]
}

/// The environment of the rewrite helper on the active Grok account: its own home, and Grok's
/// reading of the Claude hooks off, so neither mnemo's nor the app's hooks run for it (measured by
/// mnemo: `GROK_CLAUDE_HOOKS_ENABLED=0` stops every one).
pub fn helper_env(env: &AccountEnv, cmd: &mut std::process::Command) {
    env.apply(cmd);
    cmd.env("GROK_CLAUDE_HOOKS_ENABLED", "0");
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "01a1451f-bfc0-7481-afec-c2286636bc5d";

    /// `mnemo grok roster --json` as `cli/commands/grok.py` prints it.
    fn roster(rows: &[(&str, &str, &str, bool)]) -> String {
        let rows: Vec<_> = rows
            .iter()
            .map(|(id, cwd, activity, resident)| {
                serde_json::json!({ "session_id": id, "short_id": short_id(id), "cwd": cwd, "activity": activity, "resident": resident,
                    "model_id": "grok-4.7", "effort": "high", "title": format!("t-{activity}"), "last_change_ms": 1792160000000u64, "home": "/Users/you/.grok" })
            })
            .collect();
        serde_json::to_string(&rows).unwrap()
    }

    #[test]
    fn the_short_id_is_the_last_eight_hex_digits_and_the_id_says_when() {
        assert_eq!(short_id(ID), "6636bc5d");
        assert_eq!(short_id("01A1451F-BFC0-7481-AFEC-C2286636BC5D"), "6636bc5d");
        // 0x01a1451fbfc0 ms: the UUIDv7 grok 1.0.60 gave a session started 2026-10-16T14:31:11Z.
        assert_eq!(uuid7_ms(ID), Some(0x01a1451fbfc0));
        assert_eq!(iso_of_ms(uuid7_ms(ID).unwrap()), "2026-10-16T14:31:11.040Z");
        assert_eq!(uuid7_ms("a43d3832-e7a9-49b7-9496-2d86aeac8aad"), None, "a v4 says nothing");
        assert_eq!(super::super::iso_ms(&iso_of_ms(1792159484386)), Some(1792159484386));
        assert_eq!(iso_of_ms(0), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn the_roster_parses_and_only_resident_running_sessions_are_live() {
        let rows = parse_roster(&roster(&[("a", "/r", "working", true), ("b", "/r", "dormant", false), ("c", "/r", "needs_input", true), ("d", "/r", "completed", true)])).unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!((rows[0].model_id.as_deref(), rows[0].effort.as_deref(), rows[0].last_change_ms), (Some("grok-4.7"), Some("high"), Some(1792160000000)));
        assert_eq!(rows.iter().map(is_live).collect::<Vec<_>>(), [true, false, true, false]);
        assert!(parse_roster("[{\"cwd\":\"/r\"}]").unwrap().is_empty(), "a row without an id is skipped");
        assert!(parse_roster("nope").is_err());
        assert_eq!(parse_roster("[]").unwrap(), vec![], "measured: an idle leader with no session answers []");
    }

    #[test]
    fn the_ledger_keeps_grok_lines_and_the_later_line_wins() {
        let text = [
            r#"{"short_id":"6636bc5d","agent":"grok","session_id":"old","home":"/h","cwd":"/r-wt-1"}"#,
            "not json",
            r#"{"short_id":"x","agent":"cursor","session_id":"s","home":null,"cwd":"/r"}"#,
            r#"{"short_id":"y","agent":"grok","session_id":"s","home":null}"#,
            r#"{"short_id":"6636bc5d","agent":"grok","session_id":"01a1451f-bfc0-7481-afec-c2286636bc5d","home":"/h","cwd":"/r-wt-1"}"#,
            r#"{"short_id":"z","agent":"grok","session_id":"zz","home":null,"cwd":"/r"}"#,
        ]
        .join("\n");
        let l = parse_child_agents(&text);
        assert_eq!(l.len(), 2, "{l:?}");
        assert_eq!(l["6636bc5d"].session_id, ID);
        assert_eq!(l["z"].home, None);
        // Only the line in a dispatch worktree is a child; `z` dispatched from the main checkout.
        assert_eq!(ledger_children(&l).iter().map(|c| c.short_id.as_str()).collect::<Vec<_>>(), ["6636bc5d"]);
    }

    #[test]
    fn usage_counts_input_and_output_and_keeps_cache_reads_apart() {
        // The shape grok 1.0.60 wrote (the counts of a session the free limit stopped were 0).
        let real = r#"{"sessionId":"01a1451f","updatedAt":"2026-10-16T14:31:14.097273+00:00","session":{"inputTokens":0,"outputTokens":0,"cachedReadTokens":0,"cacheCreationTokens":0,"reasoningTokens":0,"totalTokens":0,"modelCalls":0,"turnCount":1},"turns":[]}"#;
        assert_eq!(parse_usage(real), Some((0, 0)));
        assert_eq!(parse_usage(r#"{"session":{"inputTokens":1200,"outputTokens":34,"cachedReadTokens":9000}}"#), Some((1234, 9000)));
        assert_eq!(parse_usage("{}"), None);
    }

    #[test]
    fn a_waiting_session_waits_on_a_permission_only_when_this_turn_asked_one() {
        let ev = |types: &[&str]| types.iter().map(|t| format!("{{\"type\":\"{t}\"}}\n")).collect::<String>();
        assert_eq!(waiting_on(&ev(&["turn_started", "phase_changed", "permission_requested"])), PERMISSION_PROMPT);
        assert_eq!(waiting_on(&ev(&["permission_requested", "turn_ended", "turn_started"])), INPUT_NEEDED);
        assert_eq!(waiting_on(""), INPUT_NEEDED);
    }

    #[test]
    fn a_summary_lists_an_interactive_session_and_never_a_headless_one() {
        // The fields grok 1.0.60 wrote for a `-p` session, kind changed for the first.
        let json = |kind: &str| {
            serde_json::json!({ "info": { "id": ID, "cwd": "/Users/you/proj" }, "session_summary": "Reply with the single word: pong",
                "created_at": "2026-10-16T14:31:11.072851Z", "updated_at": "2026-10-16T14:31:14.142415Z", "session_kind": kind,
                "last_active_at": "2026-10-16T14:31:14.142415Z", "generated_title": "Pong reply" })
            .to_string()
        };
        let s = parse_summary(&json("interactive")).unwrap();
        assert_eq!((s.id.as_str(), s.cwd.as_str(), s.title.as_str()), (ID, "/Users/you/proj", "Pong reply"));
        assert_eq!((s.first_at, s.last_at), (super::super::iso_ms("2026-10-16T14:31:11.072Z").unwrap(), super::super::iso_ms("2026-10-16T14:31:14.142Z").unwrap()));
        assert_eq!(parse_summary(&json("headless")), None);
    }

    fn grok_accounts(home: &Path) -> Accounts {
        let text = serde_json::json!({ "accounts": [
            { "id": "g", "configDir": home.join(".grok"), "kind": "grok" },
            { "id": "g2", "configDir": home.join(".grok-two"), "kind": "grok" },
        ] })
        .to_string();
        Accounts::parse(&text, home)
    }

    fn session(home: &Path, cwd: &str, id: &str, usage: Option<&str>, events: &str) {
        // URL-encoded as Grok names it, so a Windows cwd (`C:\…`) is one segment too.
        let dir = home.join("sessions").join(cwd.replace('%', "%25").replace(['/', '\\'], "%2F").replace(':', "%3A")).join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("chat_history.jsonl"), "{\"type\":\"system\",\"content\":\"…\"}\n").unwrap();
        std::fs::write(dir.join("events.jsonl"), events).unwrap();
        if let Some(u) = usage {
            std::fs::write(dir.join("usage.json"), u).unwrap();
        }
    }

    #[test]
    fn a_history_is_found_by_id_in_any_cwd_of_its_home() {
        let home = crate::testutil::temp_dir("grok-history");
        session(&home, "/r/one", ID, Some(r#"{"session":{"inputTokens":5,"outputTokens":6,"cachedReadTokens":7}}"#), "");
        let long = home.join("sessions").join("proj-0123456789abcdef").join("other");
        std::fs::create_dir_all(&long).unwrap();
        std::fs::write(long.join("chat_history.jsonl"), "").unwrap();
        assert_eq!(history_path(&home, ID), Some(home.join("sessions").join("%2Fr%2Fone").join(ID).join("chat_history.jsonl")));
        assert_eq!(history_path(&home, "other"), Some(long.join("chat_history.jsonl")), "the long-cwd form");
        assert_eq!(history_path(&home, "missing"), None);
        assert_eq!(history_path(&home, "../x"), None);
        assert_eq!(tokens_of(&home, ID), Some((11, 7)));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rows_list_children_from_the_ledger_and_other_live_sessions_as_parents() {
        let home = crate::testutil::temp_dir("grok-rows");
        let accounts = grok_accounts(&home);
        let g = home.join(".grok");
        let wt = home.join("repo-wt-c-piece");
        std::fs::create_dir_all(&wt).unwrap();
        let wt = wt.to_string_lossy().to_string();
        let child = "01a1451f-0000-7000-8000-00000000c41d";
        let parent = "01a1451f-0000-7000-8000-0000000a7e47";
        let gone = "01a1451f-0000-7000-8000-000000009043";
        session(&g, &wt, child, Some(r#"{"session":{"inputTokens":100,"outputTokens":20,"cachedReadTokens":3}}"#), "{\"type\":\"turn_started\"}\n{\"type\":\"permission_requested\"}\n");
        session(&g, "/repo", parent, Some(r#"{"session":{"inputTokens":7,"outputTokens":1,"cachedReadTokens":50}}"#), "");
        let line = |id: &str, cwd: &str| serde_json::json!({ "short_id": short_id(id), "agent": "grok", "session_id": id, "home": g, "cwd": cwd }).to_string();
        let ledger = parse_child_agents(&[line(child, &wt), line(gone, "/nonexistent/repo-wt-9"), line(parent, "/repo")].join("\n"));
        let rosters = vec![(
            accounts.get("g").unwrap(),
            parse_roster(&roster(&[(child, &wt, "needs_input", true), (parent, "/repo", "working", true), ("01a1451f-0000-7000-8000-000000000d0e", "/repo", "dormant", false)])).unwrap(),
        )];
        let parents = HashMap::from([(short_id(child), parent.to_string())]);
        let notices = HashMap::from([(short_id(child), "held".to_string())]);
        let (ps, cs) = rows(&accounts, &rosters, &ledger, &parents, &notices);

        assert_eq!(cs.len(), 1, "a finished child whose worktree is gone is left out: {cs:?}");
        let c = &cs[0];
        assert_eq!((c.id.as_str(), c.session_id.as_deref()), (child, Some(child)), "a Grok row's id is its full session id");
        assert_eq!((c.state.as_str(), c.tempo.as_str(), c.live), ("blocked", "blocked", true));
        assert_eq!(c.waiting_for.as_deref(), Some(PERMISSION_PROMPT));
        assert_eq!((c.parent_session.as_deref(), c.notice.as_deref()), (Some(parent), Some("held")), "looked up by mnemo's Grok short id");
        assert_eq!((c.tokens, c.model.as_deref(), c.effort.as_deref(), c.name.as_deref()), (120, Some("grok-4.7"), Some("high"), Some("t-needs_input")));
        assert_eq!(c.account, "g");
        assert_eq!(c.account_env, Some(AccountEnv { config_dir: None, kind: AgentKind::Grok }), "~/.grok runs with GROK_HOME unset");
        let json = serde_json::to_value(c).unwrap();
        assert_eq!(json["account_env"]["kind"], "grok");

        assert_eq!(ps.len(), 1, "a dormant session is no live parent");
        let p = &ps[0];
        assert_eq!((p.session_id.as_str(), p.status.as_str(), p.pid, p.account.as_str()), (parent, "busy", None, "g"));
        assert_eq!((p.tokens, p.cache_read), (8, 50));
        assert_eq!(serde_json::to_value(p).unwrap()["account_env"]["kind"], "grok");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_child_state_follows_its_roster_activity() {
        let c = ChildAgent { short_id: "x".into(), agent: "grok".into(), session_id: ID.into(), home: None, cwd: "/r-wt-1".into() };
        let env = AccountEnv { config_dir: None, kind: AgentKind::Grok };
        let at = |activity: &str, resident: bool| {
            let row = RosterRow { session_id: ID.into(), cwd: "/r-wt-1".into(), activity: activity.into(), resident, model_id: None, effort: None, title: None, last_change_ms: None };
            let r = child_row(&c, Some(&row), "g".into(), env.clone(), || INPUT_NEEDED);
            (r.state, r.tempo, r.live, r.waiting_for)
        };
        let s = |a: &str, b: &str, l: bool, w: Option<&str>| (a.to_string(), b.to_string(), l, w.map(str::to_string));
        assert_eq!(at("working", true), s("working", "active", true, None));
        assert_eq!(at("idle", true), s("idle", "idle", true, None));
        assert_eq!(at("needs_input", true), s("blocked", "blocked", true, Some(INPUT_NEEDED)));
        assert_eq!(at("dormant", false), s("idle", "idle", false, None));
        assert_eq!(at("completed", false), s("done", "done", false, None));
        assert_eq!(at("dead", false), s("stopped", "stopped", false, None));
        let unlisted = child_row(&c, None, "g".into(), env, || INPUT_NEEDED);
        assert_eq!((unlisted.state.as_str(), unlisted.live), ("idle", false), "a leader that is down proves nothing running");
        assert_eq!(unlisted.updated_at, Some(iso_of_ms(uuid7_ms(ID).unwrap())), "when it started, from its id");
    }

    #[test]
    fn a_session_is_held_by_the_home_that_keeps_it() {
        let home = crate::testutil::temp_dir("grok-holder");
        let accounts = grok_accounts(&home);
        session(&home.join(".grok-two"), "/r", ID, None, "");
        let none = HashMap::new();
        assert_eq!(holder_in(&accounts, &none, ID), Some((home.join(".grok-two"), ID.to_string())));
        assert_eq!(holder_in(&accounts, &none, "a43d3832"), None);
        assert_eq!(holder(&Accounts::single(&home), ID), None, "no Grok account: nothing is looked for");
        // A child mnemo recorded is found by its short id too, in the home it was dispatched on.
        let line = serde_json::json!({ "short_id": short_id(ID), "agent": "grok", "session_id": ID, "home": home.join(".grok"), "cwd": "/r-wt-1" }).to_string();
        assert_eq!(holder_in(&accounts, &parse_child_agents(&line), &short_id(ID)), Some((home.join(".grok"), ID.to_string())));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_reply_ends_mnemos_options_before_the_id_and_text() {
        assert_eq!(send_args("/h", ID, "-x hi"), ["grok", "send", "--home", "/h", "--", ID, "-x hi"]);
    }

    #[test]
    fn a_home_no_account_names_still_gets_its_own_env() {
        let home = crate::testutil::temp_dir("grok-env");
        let accounts = grok_accounts(&home);
        assert_eq!(env_at(&accounts, &home.join(".grok-two")), ("g2".to_string(), AccountEnv { config_dir: Some(home.join(".grok-two").to_string_lossy().to_string()), kind: AgentKind::Grok }));
        let gone = home.join(".grok-gone");
        assert_eq!(env_at(&accounts, &gone).1, AccountEnv { config_dir: Some(gone.to_string_lossy().to_string()), kind: AgentKind::Grok });
        let _ = std::fs::remove_dir_all(&home);
    }
}

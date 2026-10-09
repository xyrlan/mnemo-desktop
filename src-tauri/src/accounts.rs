//! Claude Code accounts: which config dir the panes opened from now on run in
//! (`docs/superpowers/specs/2026-10-07-claude-accounts-design.md`, decisions 1 to 4).
//!
//! An account is a Claude Code config dir. The default one is `~/.claude`, run with
//! `CLAUDE_CONFIG_DIR` unset; every other one is `~/.claude-<slug>`, its own login, with the
//! user's content and history linked to `~/.claude`'s (`SHARED`). Its `.claude.json` stays its own
//! (the login is in it), but its user-scope `mcpServers` follow the default account's.
//!
//! The list is `accounts.json` in the app dir, written here and read directly by others. No file
//! means one account, the default, active.

use crate::commands::PtyState;
use crate::pty::PaneId;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Runtime, State};

/// Emitted with the new `AccountsState` after every change.
pub const CHANGED: &str = "accounts://changed";
pub const DEFAULT_ID: &str = "default";
/// The variable that names a non-default account's dir to Claude Code.
pub const CONFIG_DIR_VAR: &str = "CLAUDE_CONFIG_DIR";

const FILE: &str = "accounts.json";
/// The user-scope `mcpServers` last written into each account's `.claude.json`, by config dir:
/// a server that still reads as written there is ours to bring in step, any other is the user's.
const MCP_FILE: &str = "accounts-mcp.json";
/// Which account each pane was spawned on, by pane id: the daemon keeps panes across launches.
pub const PANES_FILE: &str = "account-panes.json";

/// What a non-default account shares with `~/.claude`, as links: the user's content and history
/// (decision 3). Everything else there — the login, `.claude.json`, the daemon and its jobs,
/// runtime state and caches — stays per account.
const SHARED: &[(&str, Kind)] = &[
    ("projects", Kind::Dir),
    ("history.jsonl", Kind::File),
    ("settings.json", Kind::File),
    ("settings.local.json", Kind::File),
    ("CLAUDE.md", Kind::File),
    ("keybindings.json", Kind::File),
    ("skills", Kind::Dir),
    ("agents", Kind::Dir),
    ("commands", Kind::Dir),
    ("plugins", Kind::Dir),
    ("plans", Kind::Dir),
    ("output-styles", Kind::Dir),
    ("hooks", Kind::Dir),
    ("file-history", Kind::Dir),
    ("todos", Kind::Dir),
    ("tasks", Kind::Dir),
];

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    /// Created in `~/.claude` when missing, so the link always has somewhere to write.
    Dir,
    /// Linked once `~/.claude` has it.
    File,
}

/// One account as `accounts.json` keeps it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    label: String,
    config_dir: PathBuf,
    #[serde(default)]
    is_default: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct List {
    active: String,
    accounts: Vec<Entry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub label: String,
    pub config_dir: String,
    pub is_default: bool,
    pub email: Option<String>,
    pub problem: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AccountsState {
    pub active: String,
    pub accounts: Vec<Account>,
}

/// The account a pane spawned now runs on: its id, and the `CLAUDE_CONFIG_DIR` it gets (`None`:
/// unset, the default account).
#[derive(Debug, Clone, PartialEq)]
pub struct PaneAccount {
    pub id: String,
    pub config_dir: Option<PathBuf>,
}

/// Every read-modify-write of the files here: the commands, the startup sync and a spawn's read
/// may run at once.
static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Where the accounts live: the user's home (`~/.claude`, `~/.claude.json`, `~/.claude-<slug>`)
/// and the app dir (the list). Tests give temporary ones.
#[derive(Debug, Clone)]
pub struct Place {
    home: PathBuf,
    app: PathBuf,
}

impl Place {
    pub fn real() -> Self {
        Self::new(crate::app_dir::home(), crate::app_dir::app_dir())
    }

    pub fn new(home: PathBuf, app: PathBuf) -> Self {
        Self { home, app }
    }

    fn default_dir(&self) -> PathBuf {
        self.home.join(".claude")
    }

    fn default_entry(&self) -> Entry {
        Entry { id: DEFAULT_ID.into(), label: "Default".into(), config_dir: self.default_dir(), is_default: true }
    }

    /// The account's `.claude.json`: `~/.claude.json` for the default account (decision 1).
    fn claude_json(&self, e: &Entry) -> PathBuf {
        if e.is_default {
            self.home.join(".claude.json")
        } else {
            e.config_dir.join(".claude.json")
        }
    }

    fn load(&self) -> Result<List, String> {
        let path = self.app.join(FILE);
        let mut list = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str::<List>(&text).map_err(|e| format!("{}: {e}", path.display()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => List { active: DEFAULT_ID.into(), accounts: vec![] },
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        // The default account is always there, first, and always `~/.claude`.
        let default_dir = self.default_dir();
        match list.accounts.iter().position(|e| e.is_default) {
            Some(i) => {
                let mut d = list.accounts.remove(i);
                d.config_dir = default_dir;
                list.accounts.insert(0, d);
            }
            None => list.accounts.insert(0, self.default_entry()),
        }
        for e in &mut list.accounts[1..] {
            e.is_default = false;
        }
        if !list.accounts.iter().any(|e| e.id == list.active) {
            list.active = list.accounts[0].id.clone();
        }
        Ok(list)
    }

    fn save(&self, list: &List) -> Result<(), String> {
        write_json(&self.app.join(FILE), &serde_json::to_value(list).map_err(|e| e.to_string())?)
    }

    fn state_of(&self, list: &List) -> AccountsState {
        let default_servers = servers_in(&read_json(&self.home.join(".claude.json")));
        let mut accounts: Vec<Account> = list.accounts.iter().map(|e| self.account(e, &default_servers)).collect();
        same_login(&mut accounts);
        AccountsState { active: list.active.clone(), accounts }
    }

    fn account(&self, e: &Entry, default_servers: &Map<String, Value>) -> Account {
        let config = read_json(&self.claude_json(e));
        let email = config.pointer("/oauthAccount/emailAddress").and_then(Value::as_str).map(String::from);
        let mut problems = vec![];
        if config.get("oauthAccount").is_none_or(Value::is_null) {
            problems.push("Not logged in yet.".to_string());
        }
        if !e.is_default {
            let drifted = self.drifted(e);
            if !drifted.is_empty() {
                problems.push(format!(
                    "{} no longer {} the default account's: Claude Code replaced the link with a copy of its own, and neither is changed.",
                    drifted.join(", "),
                    if drifted.len() == 1 { "is" } else { "are" },
                ));
            }
            let own = servers_in(&config);
            let off: Vec<_> = default_servers
                .keys()
                .chain(own.keys())
                .filter(|n| default_servers.get(*n) != own.get(*n))
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
            if !off.is_empty() {
                problems.push(format!("Its MCP servers differ from the default account's: {}.", off.join(", ")));
            }
        }
        Account {
            id: e.id.clone(),
            label: e.label.clone(),
            config_dir: e.config_dir.display().to_string(),
            is_default: e.is_default,
            email,
            problem: (!problems.is_empty()).then(|| problems.join(" ")),
        }
    }

    /// The shared entries of `e` that are there but are not the link to `~/.claude`'s.
    fn drifted(&self, e: &Entry) -> Vec<String> {
        SHARED
            .iter()
            .filter(|(name, _)| {
                let at = e.config_dir.join(name);
                match std::fs::symlink_metadata(&at) {
                    Err(_) => false,
                    Ok(m) if m.file_type().is_symlink() => std::fs::read_link(&at).is_ok_and(|t| t != self.default_dir().join(name)),
                    Ok(_) => true,
                }
            })
            .map(|(name, _)| name.to_string())
            .collect()
    }

    pub fn state(&self) -> Result<AccountsState, String> {
        let _g = lock();
        Ok(self.state_of(&self.load()?))
    }

    pub fn switch(&self, id: &str) -> Result<AccountsState, String> {
        let _g = lock();
        let mut list = self.load()?;
        if !list.accounts.iter().any(|e| e.id == id) {
            return Err(format!("no account `{id}`"));
        }
        list.active = id.to_string();
        self.save(&list)?;
        Ok(self.state_of(&list))
    }

    /// A new account in `~/.claude-<slug>`, made active so the terminal opened next logs in to
    /// it. Never logs in. A dir already there (an account removed earlier) is taken as it is.
    pub fn add(&self, label: &str) -> Result<Account, String> {
        let label = label.trim();
        if label.is_empty() {
            return Err("an account needs a name".into());
        }
        let _g = lock();
        let mut list = self.load()?;
        let base = slug(label);
        let id = (1..)
            .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
            .find(|id| id != DEFAULT_ID && !list.accounts.iter().any(|e| &e.id == id))
            .expect("some suffix is free");
        let entry = Entry { id: id.clone(), label: label.to_string(), config_dir: self.home.join(format!(".claude-{id}")), is_default: false };
        std::fs::create_dir_all(&entry.config_dir).map_err(|e| format!("{}: {e}", entry.config_dir.display()))?;
        self.bring_in_step(&entry);
        list.accounts.push(entry.clone());
        list.active = id;
        self.save(&list)?;
        let default_servers = servers_in(&read_json(&self.home.join(".claude.json")));
        Ok(self.account(&entry, &default_servers))
    }

    pub fn rename(&self, id: &str, label: &str) -> Result<AccountsState, String> {
        let label = label.trim();
        if label.is_empty() {
            return Err("an account needs a name".into());
        }
        let _g = lock();
        let mut list = self.load()?;
        let e = list.accounts.iter_mut().find(|e| e.id == id).ok_or_else(|| format!("no account `{id}`"))?;
        e.label = label.to_string();
        self.save(&list)?;
        Ok(self.state_of(&list))
    }

    /// Forgets the account; its folder stays on disk. The default account cannot be removed.
    pub fn remove(&self, id: &str) -> Result<AccountsState, String> {
        let _g = lock();
        let mut list = self.load()?;
        let i = list.accounts.iter().position(|e| e.id == id).ok_or_else(|| format!("no account `{id}`"))?;
        if list.accounts[i].is_default {
            return Err("the default account cannot be removed".into());
        }
        list.accounts.remove(i);
        if list.active == id {
            list.active = list.accounts[0].id.clone();
        }
        self.save(&list)?;
        Ok(self.state_of(&list))
    }

    /// At startup: every account's missing links made and its `mcpServers` brought in step.
    /// Drifted links are left alone and reported (`problem`).
    pub fn sync(&self) -> Result<AccountsState, String> {
        let _g = lock();
        let list = self.load()?;
        for e in list.accounts.iter().filter(|e| !e.is_default) {
            if e.config_dir.is_dir() {
                self.bring_in_step(e);
            }
        }
        Ok(self.state_of(&list))
    }

    fn bring_in_step(&self, e: &Entry) {
        if let Err(err) = self.link_shared(e) {
            log::warn!("accounts: {}: {err}", e.id);
        }
        if let Err(err) = self.sync_mcp(e) {
            log::warn!("accounts: {}: mcpServers not brought in step: {err}", e.id);
        }
    }

    /// Links each shared entry `e` does not have yet to `~/.claude`'s. An entry that is there
    /// already, link or not, is never touched.
    fn link_shared(&self, e: &Entry) -> Result<(), String> {
        let shared = self.default_dir();
        for (name, kind) in SHARED {
            let at = e.config_dir.join(name);
            if std::fs::symlink_metadata(&at).is_ok() {
                continue;
            }
            let target = shared.join(name);
            if *kind == Kind::Dir {
                std::fs::create_dir_all(&target).map_err(|err| format!("{}: {err}", target.display()))?;
            }
            if target.exists() {
                link(&target, &at, *kind).map_err(|err| format!("{}: {err}", at.display()))?;
            }
        }
        Ok(())
    }

    /// Brings `e`'s user-scope `mcpServers` in step with the default account's, server by server.
    /// A server that reads as this app last wrote it (or is absent on both sides) follows the
    /// default account; one the user changed there is left as it is and reported. Every other key
    /// of its `.claude.json` is kept.
    fn sync_mcp(&self, e: &Entry) -> Result<(), String> {
        let wanted = servers_in(&read_json(&self.home.join(".claude.json")));
        let record_path = self.app.join(MCP_FILE);
        let mut record = read_json(&record_path);
        let key = e.config_dir.display().to_string();
        let written = record.get(&key).and_then(Value::as_object).cloned().unwrap_or_default();
        let path = self.claude_json(e);
        // Claude Code writes this file too: a write of its own between the read and the rename
        // starts the round again rather than being lost.
        for _ in 0..3 {
            let before = std::fs::read_to_string(&path).ok();
            let mut config = match &before {
                Some(text) => serde_json::from_str::<Value>(text).map_err(|err| format!("{}: {err}", path.display()))?,
                None => Value::Object(Map::new()),
            };
            let Some(obj) = config.as_object_mut() else {
                return Err(format!("{} is not a JSON object", path.display()));
            };
            let have = obj.get("mcpServers").and_then(Value::as_object).cloned().unwrap_or_default();
            let (next, now_written) = step(&wanted, &written, &have);
            if next != have || before.is_none() {
                obj.insert("mcpServers".into(), Value::Object(next));
                if std::fs::read_to_string(&path).ok() != before {
                    continue;
                }
                write_json(&path, &config)?;
            }
            if record.as_object().is_none() {
                record = Value::Object(Map::new());
            }
            if record.get(&key).and_then(Value::as_object) != Some(&now_written) {
                record[&key] = Value::Object(now_written);
                write_json(&record_path, &record)?;
            }
            return Ok(());
        }
        Err(format!("{} kept changing", path.display()))
    }

    /// The account a pane spawned now runs on. An unreadable list runs it on the default account.
    pub fn for_new_pane(&self) -> PaneAccount {
        let list = {
            let _g = lock();
            self.load()
        };
        let list = list.unwrap_or_else(|e| {
            log::warn!("accounts: a new pane runs on the default account: {e}");
            List { active: DEFAULT_ID.into(), accounts: vec![self.default_entry()] }
        });
        let e = list.accounts.iter().find(|e| e.id == list.active).unwrap_or(&list.accounts[0]);
        PaneAccount { id: e.id.clone(), config_dir: (!e.is_default).then(|| e.config_dir.clone()) }
    }
}

/// The servers `have` should hold, and what was written of them: per server, the default's
/// (`wanted`) where `have` still reads as last written (`written`), `have`'s own otherwise.
/// Decision 10: an account whose login another account also holds says which ones, since
/// switching between them changes nothing.
fn same_login(accounts: &mut [Account]) {
    let notes: Vec<Option<String>> = accounts
        .iter()
        .map(|a| {
            let email = a.email.as_deref()?;
            let others: Vec<&str> = accounts.iter().filter(|o| o.id != a.id && o.email.as_deref() == Some(email)).map(|o| o.label.as_str()).collect();
            (!others.is_empty()).then(|| format!("Logged in as {email}, the same Claude account as {}.", others.join(", ")))
        })
        .collect();
    for (a, note) in accounts.iter_mut().zip(notes) {
        if let Some(note) = note {
            a.problem = Some(match a.problem.take() {
                Some(p) => format!("{p} {note}"),
                None => note,
            });
        }
    }
}

fn step(wanted: &Map<String, Value>, written: &Map<String, Value>, have: &Map<String, Value>) -> (Map<String, Value>, Map<String, Value>) {
    let mut next = have.clone();
    let mut now_written = Map::new();
    let names: std::collections::BTreeSet<&String> = wanted.keys().chain(written.keys()).chain(have.keys()).collect();
    for name in names {
        let (w, l, h) = (wanted.get(name), written.get(name), have.get(name));
        if h == w || h == l {
            match w {
                Some(v) => {
                    next.insert(name.clone(), v.clone());
                    now_written.insert(name.clone(), v.clone());
                }
                None => {
                    next.remove(name);
                }
            }
        } else if let Some(v) = l {
            // The user's: kept, and still remembered as last written so it is never taken for ours.
            now_written.insert(name.clone(), v.clone());
        }
    }
    (next, now_written)
}

fn servers_in(config: &Value) -> Map<String, Value> {
    config.get("mcpServers").and_then(Value::as_object).cloned().unwrap_or_default()
}

/// The file as JSON, or `null` when it is missing or unreadable.
fn read_json(path: &Path) -> Value {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

/// Written beside, then renamed into place: a reader never sees half of it.
fn write_json(path: &Path, v: &Value) -> Result<(), String> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("{}: {e}", d.display()))?;
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.mnemo-tmp"));
    let body = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| format!("{}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(unix)]
fn link(target: &Path, at: &Path, _kind: Kind) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, at)
}

#[cfg(windows)]
fn link(target: &Path, at: &Path, kind: Kind) -> std::io::Result<()> {
    match kind {
        Kind::Dir => std::os::windows::fs::symlink_dir(target, at),
        Kind::File => std::os::windows::fs::symlink_file(target, at),
    }
}

/// `Work Stuff!` → `work-stuff`: lowercase ASCII letters and digits, the rest one dash.
fn slug(label: &str) -> String {
    let mut out = String::new();
    for c in label.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-');
    if out.is_empty() { "account".into() } else { out.to_string() }
}

/// Which account each pane was spawned on, kept in `account-panes.json` (when given a file) so a
/// relaunched app still knows it for the daemon's panes.
pub struct PaneAccounts {
    place: Place,
    file: Option<PathBuf>,
    panes: Mutex<BTreeMap<PaneId, String>>,
}

impl PaneAccounts {
    pub fn new(place: Place, file: Option<PathBuf>) -> Self {
        let panes = file.as_deref().map(read_json).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        Self { place, file, panes: Mutex::new(panes) }
    }

    pub fn current(&self) -> PaneAccount {
        self.place.for_new_pane()
    }

    pub fn spawned(&self, id: PaneId, account: String) {
        let mut panes = self.panes.lock().unwrap_or_else(|e| e.into_inner());
        panes.insert(id, account);
        self.persist(&panes);
    }

    /// `id` now runs on `account`: its session moved there. Refuses an account not in the list.
    pub fn moved(&self, id: PaneId, account: &str) -> Result<(), String> {
        if !self.place.state()?.accounts.iter().any(|a| a.id == account) {
            return Err(format!("no account `{account}`"));
        }
        self.spawned(id, account.to_string());
        Ok(())
    }

    /// The account of each pane in `live`; the others are forgotten.
    pub fn of(&self, live: &[PaneId]) -> HashMap<PaneId, String> {
        let mut panes = self.panes.lock().unwrap_or_else(|e| e.into_inner());
        let before = panes.len();
        panes.retain(|id, _| live.contains(id));
        if panes.len() != before {
            self.persist(&panes);
        }
        panes.iter().map(|(k, v)| (*k, v.clone())).collect()
    }

    fn persist(&self, panes: &BTreeMap<PaneId, String>) {
        if let Some(file) = &self.file {
            let written = serde_json::to_value(panes).map_err(|e| e.to_string()).and_then(|v| write_json(file, &v));
            if let Err(e) = written {
                log::warn!("accounts: which account each pane runs on is not kept: {e}");
            }
        }
    }
}

fn changed<R: Runtime>(app: &AppHandle<R>, state: &AccountsState) {
    let _ = app.emit(CHANGED, state);
}

/// At startup, off the main thread: brings every account in step (`Place::sync`).
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || match Place::real().sync() {
        Ok(state) => {
            for a in state.accounts.iter().filter(|a| !a.is_default) {
                if let Some(p) = &a.problem {
                    log::warn!("accounts: {}: {p}", a.id);
                }
            }
            changed(&app, &state);
        }
        Err(e) => log::warn!("accounts: {e}"),
    });
}

#[tauri::command]
pub fn accounts_list() -> Result<AccountsState, String> {
    Place::real().state()
}

#[tauri::command]
pub fn accounts_switch<R: Runtime>(app: AppHandle<R>, id: String) -> Result<AccountsState, String> {
    let state = Place::real().switch(&id)?;
    changed(&app, &state);
    Ok(state)
}

#[tauri::command]
pub fn accounts_add<R: Runtime>(app: AppHandle<R>, label: String) -> Result<Account, String> {
    let place = Place::real();
    let account = place.add(&label)?;
    if let Ok(state) = place.state() {
        changed(&app, &state);
    }
    Ok(account)
}

#[tauri::command]
pub fn accounts_rename<R: Runtime>(app: AppHandle<R>, id: String, label: String) -> Result<AccountsState, String> {
    let state = Place::real().rename(&id, &label)?;
    changed(&app, &state);
    Ok(state)
}

#[tauri::command]
pub fn accounts_remove<R: Runtime>(app: AppHandle<R>, id: String) -> Result<AccountsState, String> {
    let state = Place::real().remove(&id)?;
    changed(&app, &state);
    Ok(state)
}

/// The account each pane still held runs on, by pane id. Off the main thread, as `pty_list`:
/// the first call of a launch may start the daemon.
#[tauri::command(async)]
pub fn accounts_panes(state: State<'_, PtyState>) -> Result<HashMap<PaneId, String>, String> {
    state.0.pane_accounts()
}

/// Pane `pane` now runs on account `id`: its Claude session moved there (decision 9).
/// `accounts_panes` reports it there from now on.
#[tauri::command(async)]
pub fn accounts_move_pane(state: State<'_, PtyState>, pane: PaneId, id: String) -> Result<(), String> {
    state.0.move_pane(pane, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn place(tag: &str) -> Place {
        let root = crate::testutil::temp_dir(&format!("accounts-{tag}"));
        std::fs::create_dir_all(root.join("home/.claude")).unwrap();
        Place::new(root.join("home"), root.join("app"))
    }

    fn write(path: &Path, v: Value) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_string_pretty(&v).unwrap()).unwrap();
    }

    fn logged_in(p: &Place, email: &str) {
        write(&p.home.join(".claude.json"), json!({ "oauthAccount": { "emailAddress": email }, "numStartups": 4 }));
    }

    #[test]
    fn no_file_is_one_default_account_active() {
        let p = place("none");
        logged_in(&p, "me@x.io");
        let s = p.state().unwrap();
        assert_eq!(s.active, "default");
        assert_eq!(
            s.accounts,
            vec![Account {
                id: "default".into(),
                label: "Default".into(),
                config_dir: p.home.join(".claude").display().to_string(),
                is_default: true,
                email: Some("me@x.io".into()),
                problem: None,
            }]
        );
        assert!(!p.app.join(FILE).exists(), "reading writes nothing");
    }

    #[test]
    fn the_state_serializes_as_the_contract_says() {
        let p = place("wire");
        let v = serde_json::to_value(p.state().unwrap()).unwrap();
        let a = &v["accounts"][0];
        assert_eq!(v["active"], "default");
        for key in ["id", "label", "configDir", "isDefault", "email", "problem"] {
            assert!(a.get(key).is_some(), "missing {key} in {a}");
        }
        assert_eq!(a["problem"], "Not logged in yet.");
    }

    #[test]
    fn adding_makes_a_dir_that_shares_history_and_is_not_logged_in() {
        let p = place("add");
        logged_in(&p, "me@x.io");
        std::fs::write(p.home.join(".claude/history.jsonl"), "{}\n").unwrap();
        std::fs::create_dir_all(p.home.join(".claude/projects/-r")).unwrap();
        let a = p.add("  Work Stuff! ").unwrap();
        assert_eq!(a.id, "work-stuff");
        assert_eq!(a.label, "Work Stuff!");
        let dir = p.home.join(".claude-work-stuff");
        assert_eq!(a.config_dir, dir.display().to_string());
        assert!(!a.is_default);
        assert_eq!(a.email, None);
        assert_eq!(a.problem.as_deref(), Some("Not logged in yet."));
        assert_eq!(std::fs::read_link(dir.join("history.jsonl")).unwrap(), p.home.join(".claude/history.jsonl"));
        assert_eq!(std::fs::read_link(dir.join("projects")).unwrap(), p.home.join(".claude/projects"));
        assert!(dir.join("projects/-r").is_dir());
        // A shared dir the default account has not made yet is made, so the link works.
        assert_eq!(std::fs::read_link(dir.join("agents")).unwrap(), p.home.join(".claude/agents"));
        assert!(p.home.join(".claude/agents").is_dir());
        // A shared file it does not have is not linked to nothing.
        assert!(std::fs::symlink_metadata(dir.join("CLAUDE.md")).is_err());
        // The login, the daemon and the jobs stay its own.
        for own in [".credentials.json", "daemon", "jobs"] {
            assert!(std::fs::symlink_metadata(dir.join(own)).is_err(), "{own} is linked");
        }
        let s = p.state().unwrap();
        assert_eq!(s.active, "work-stuff", "the terminal opened next logs in to it");
        assert_eq!(s.accounts.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["default", "work-stuff"]);
    }

    #[test]
    fn ids_never_meet() {
        let p = place("ids");
        assert_eq!(p.add("Work").unwrap().id, "work");
        assert_eq!(p.add("work").unwrap().id, "work-2");
        assert_eq!(p.add("Default").unwrap().id, "default-2");
        assert_eq!(p.add("☃").unwrap().id, "account");
        assert!(p.add("   ").is_err());
    }

    #[test]
    fn switching_renaming_and_removing() {
        let p = place("switch");
        p.add("Work").unwrap();
        assert_eq!(p.switch("default").unwrap().active, "default");
        assert!(p.switch("nope").is_err());
        let s = p.switch("work").unwrap();
        assert_eq!(s.active, "work");

        let s = p.rename("work", "Job").unwrap();
        assert_eq!(s.accounts[1].label, "Job");
        assert_eq!(s.accounts[1].id, "work");
        assert!(p.rename("work", " ").is_err());
        assert!(p.rename("nope", "x").is_err());

        assert!(p.remove("default").is_err());
        let s = p.remove("work").unwrap();
        assert_eq!(s.active, "default", "removing the active account makes the default active");
        assert_eq!(s.accounts.len(), 1);
        assert!(p.home.join(".claude-work").is_dir(), "its folder stays on disk");
        assert!(p.remove("work").is_err());
    }

    #[test]
    fn a_new_pane_runs_on_the_active_account() {
        let p = place("pane");
        assert_eq!(p.for_new_pane(), PaneAccount { id: "default".into(), config_dir: None });
        p.add("Work").unwrap();
        assert_eq!(p.for_new_pane(), PaneAccount { id: "work".into(), config_dir: Some(p.home.join(".claude-work")) });
        std::fs::write(p.app.join(FILE), "not json").unwrap();
        assert_eq!(p.for_new_pane().config_dir, None, "an unreadable list runs it on the default account");
        assert!(p.state().is_err(), "and says so to the list");
    }

    #[test]
    fn the_email_is_the_accounts_own() {
        let p = place("email");
        logged_in(&p, "me@x.io");
        p.add("Work").unwrap();
        write(&p.home.join(".claude-work/.claude.json"), json!({ "oauthAccount": { "emailAddress": "w@x.io" }, "mcpServers": {} }));
        let s = p.state().unwrap();
        assert_eq!(s.accounts[0].email.as_deref(), Some("me@x.io"));
        assert_eq!(s.accounts[1].email.as_deref(), Some("w@x.io"));
        assert_eq!(s.accounts[1].problem, None);
    }

    #[test]
    fn a_link_replaced_by_a_copy_is_reported_and_left_alone() {
        let p = place("drift");
        std::fs::write(p.home.join(".claude/settings.json"), "{\"a\":1}").unwrap();
        p.add("Work").unwrap();
        let dir = p.home.join(".claude-work");
        write(&dir.join(".claude.json"), json!({ "oauthAccount": { "emailAddress": "w@x.io" }, "mcpServers": {} }));
        // Claude Code's atomic write onto the link.
        std::fs::remove_file(dir.join("settings.json")).unwrap();
        std::fs::write(dir.join("settings.json"), "{\"a\":2}").unwrap();
        let s = p.sync().unwrap();
        let problem = s.accounts[1].problem.clone().unwrap();
        assert!(problem.starts_with("settings.json no longer is the default account's"), "{problem}");
        assert_eq!(std::fs::read_to_string(dir.join("settings.json")).unwrap(), "{\"a\":2}");
        assert_eq!(std::fs::read_to_string(p.home.join(".claude/settings.json")).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn startup_links_what_the_default_account_has_since() {
        let p = place("relink");
        p.add("Work").unwrap();
        let dir = p.home.join(".claude-work");
        assert!(std::fs::symlink_metadata(dir.join("CLAUDE.md")).is_err());
        std::fs::write(p.home.join(".claude/CLAUDE.md"), "be kind").unwrap();
        p.sync().unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("CLAUDE.md")).unwrap(), "be kind");
    }

    #[test]
    fn mcp_servers_follow_the_default_account_but_never_over_the_users_own() {
        let p = place("mcp");
        let desktop = json!({ "type": "stdio", "command": "/a/desktop" });
        let mnemo = json!({ "type": "stdio", "command": "mnemo" });
        write(&p.home.join(".claude.json"), json!({ "mcpServers": { "desktop": desktop, "mnemo": mnemo } }));
        p.add("Work").unwrap();
        let path = p.home.join(".claude-work/.claude.json");
        assert_eq!(read_json(&path), json!({ "mcpServers": { "desktop": desktop, "mnemo": mnemo } }));

        // Claude Code logs in and writes its own keys there; the user adds a server of their own.
        let mut config = read_json(&path);
        config["oauthAccount"] = json!({ "emailAddress": "w@x.io" });
        config["numStartups"] = json!(2);
        config["mcpServers"]["mine"] = json!({ "command": "mine" });
        write(&path, config);

        // The default account's desktop server moves, its mnemo one goes.
        let moved = json!({ "type": "stdio", "command": "/b/desktop" });
        write(&p.home.join(".claude.json"), json!({ "mcpServers": { "desktop": moved } }));
        let s = p.sync().unwrap();
        let config = read_json(&path);
        assert_eq!(config["mcpServers"], json!({ "desktop": moved, "mine": { "command": "mine" } }));
        assert_eq!(config["numStartups"], 2, "every other key is kept");
        assert_eq!(config["oauthAccount"]["emailAddress"], "w@x.io");
        assert_eq!(s.accounts[1].problem.as_deref(), Some("Its MCP servers differ from the default account's: mine."));

        // A server the user changed in the account is theirs: reported, never overwritten.
        let mut config = read_json(&path);
        config["mcpServers"]["desktop"] = json!({ "command": "/mine/desktop" });
        write(&path, config);
        write(&p.home.join(".claude.json"), json!({ "mcpServers": { "desktop": json!({ "command": "/c/desktop" }) } }));
        let s = p.sync().unwrap();
        assert_eq!(read_json(&path)["mcpServers"]["desktop"], json!({ "command": "/mine/desktop" }));
        assert_eq!(s.accounts[1].problem.as_deref(), Some("Its MCP servers differ from the default account's: desktop, mine."));

        // Once the user puts it back as the default has it, it follows again.
        let mut config = read_json(&path);
        config["mcpServers"]["desktop"] = json!({ "command": "/c/desktop" });
        write(&path, config);
        p.sync().unwrap();
        write(&p.home.join(".claude.json"), json!({ "mcpServers": { "desktop": json!({ "command": "/d/desktop" }) } }));
        p.sync().unwrap();
        assert_eq!(read_json(&path)["mcpServers"]["desktop"], json!({ "command": "/d/desktop" }));
    }

    #[test]
    fn an_account_added_by_hand_gets_the_servers_it_lacks_and_keeps_its_own() {
        let p = place("byhand");
        write(&p.home.join(".claude.json"), json!({ "mcpServers": { "desktop": { "command": "/a" }, "mnemo": { "command": "m" } } }));
        let dir = p.home.join(".claude-old");
        write(&dir.join(".claude.json"), json!({ "mcpServers": { "mnemo": { "command": "old" } }, "x": 1 }));
        write(
            &p.app.join(FILE),
            json!({ "active": "default", "accounts": [
                { "id": "default", "label": "Me", "configDir": p.home.join(".claude"), "isDefault": true },
                { "id": "old", "label": "Old", "configDir": dir, "isDefault": false },
            ] }),
        );
        p.sync().unwrap();
        assert_eq!(read_json(&dir.join(".claude.json")), json!({ "mcpServers": { "desktop": { "command": "/a" }, "mnemo": { "command": "old" } }, "x": 1 }));
    }

    #[test]
    fn a_hand_edited_list_keeps_its_default_first_and_its_active_real() {
        let p = place("edited");
        write(&p.app.join(FILE), json!({ "active": "gone", "accounts": [{ "id": "w", "label": "W", "configDir": "/x/.claude-w" }] }));
        let s = p.state().unwrap();
        assert_eq!(s.active, "default");
        assert_eq!(s.accounts.iter().map(|a| (a.id.as_str(), a.is_default)).collect::<Vec<_>>(), [("default", true), ("w", false)]);
    }

    #[test]
    fn pane_accounts_are_kept_across_launches_and_forget_ended_panes() {
        let p = place("panes");
        let file = p.app.join(PANES_FILE);
        let panes = PaneAccounts::new(p.clone(), Some(file.clone()));
        panes.spawned(1, "default".into());
        panes.spawned(2, "work".into());
        let again = PaneAccounts::new(p.clone(), Some(file.clone()));
        assert_eq!(again.of(&[1, 2]), HashMap::from([(1, "default".to_string()), (2, "work".to_string())]));
        assert_eq!(again.of(&[2]), HashMap::from([(2, "work".to_string())]));
        assert_eq!(PaneAccounts::new(p, Some(file)).of(&[1, 2]), HashMap::from([(2, "work".to_string())]));
    }

    #[test]
    fn a_moved_pane_is_reported_on_its_new_account() {
        let p = place("moved");
        p.add("Work").unwrap();
        let file = p.app.join(PANES_FILE);
        let panes = PaneAccounts::new(p.clone(), Some(file.clone()));
        panes.spawned(1, "default".into());
        panes.moved(1, "work").unwrap();
        assert_eq!(panes.of(&[1]), HashMap::from([(1, "work".to_string())]));
        assert_eq!(PaneAccounts::new(p.clone(), Some(file)).of(&[1]), HashMap::from([(1, "work".to_string())]), "kept across launches");
        assert_eq!(panes.moved(1, "gone"), Err("no account `gone`".into()));
        assert_eq!(panes.of(&[1]), HashMap::from([(1, "work".to_string())]));
    }

    #[test]
    fn accounts_holding_the_same_login_say_so() {
        let p = place("same");
        logged_in(&p, "me@x.io");
        p.add("Work").unwrap();
        p.add("Spare").unwrap();
        let config = |slug: &str, email: &str| {
            let mut c = read_json(&p.home.join(format!(".claude-{slug}/.claude.json")));
            c["oauthAccount"] = json!({ "emailAddress": email });
            write(&p.home.join(format!(".claude-{slug}/.claude.json")), c);
        };
        config("work", "me@x.io");
        config("spare", "s@x.io");
        let s = p.state().unwrap();
        assert_eq!(s.accounts[0].problem.as_deref(), Some("Logged in as me@x.io, the same Claude account as Work."));
        assert_eq!(s.accounts[1].problem.as_deref(), Some("Logged in as me@x.io, the same Claude account as Default."));
        assert_eq!(s.accounts[2].problem, None);
        config("spare", "me@x.io");
        let s = p.state().unwrap();
        assert_eq!(s.accounts[0].problem.as_deref(), Some("Logged in as me@x.io, the same Claude account as Work, Spare."));
    }

    #[test]
    fn step_follows_only_what_it_wrote() {
        let m = |v: Value| v.as_object().unwrap().clone();
        let (next, written) = step(&m(json!({ "a": 1, "b": 2 })), &m(json!({ "a": 0, "c": 3 })), &m(json!({ "a": 0, "b": 9, "c": 3, "d": 4 })));
        assert_eq!(Value::Object(next), json!({ "a": 1, "b": 9, "d": 4 }));
        assert_eq!(Value::Object(written), json!({ "a": 1 }));
    }
}

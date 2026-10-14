//! How many processes a minute of polling starts, as `main` asked before #368 and as it asks now,
//! idle and on a busy fixture. `cargo test spawns_per_minute -- --nocapture` prints the table.
//!
//! The minute is simulated: mission rounds every 3.25 s (the 3 s timer plus a quarter second of
//! round, the visible window's cadence) and every terminal pane's session poll every 5 s, all in
//! step, as the workspace restore mounts them. "Before" counts the starts `main`'s code makes
//! unconditionally: each round one `claude agents` per account, one `mnemo sessions`, one
//! `git rev-parse` per distinct cwd and one `git worktree list` per repo; each pane tick misses
//! the old 3 s cache that is not single-flight, which is replayed here with the old `Cache` and
//! threads. "Now" runs the code this change put in, against real git repos, and counts the asks
//! it really made; a stand-in sleeps where `claude` would run. Halfway through, a worktree is
//! added and one is switched, and the answers are checked against git asked directly.

use super::asked::{Roots, Shared, Worktrees};
use super::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const ROUND_MS: u64 = 3250;
const PANE_MS: u64 = 5000;
const MINUTE_MS: u64 = 60_000;
/// Where `claude agents` would run (311–555 ms in the audit): long enough for callers to overlap.
const CLAUDE_STAND_IN: Duration = Duration::from_millis(30);

struct Fixture {
    accounts: usize,
    /// Parents' cwds (one per repo's main checkout) and children's (their worktrees).
    parent_cwds: Vec<String>,
    child_cwds: Vec<String>,
    focused: Option<String>,
    panes: usize,
}

#[derive(Default, Debug, Clone, Copy, PartialEq)]
struct Count {
    claude: usize,
    mnemo: usize,
    rev_parse: usize,
    worktree_list: usize,
}

impl Count {
    fn total(&self) -> usize {
        self.claude + self.mnemo + self.rev_parse + self.worktree_list
    }
}

fn git(args: &[&str], cwd: &Path) {
    let out = crate::proc::command("git").args(args).current_dir(cwd).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn s(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

/// 8 repos, two worktrees each: a parent in each main checkout, a child in each worktree, 16
/// panes, two accounts. The audit's workload was 16 shells and 8 repos.
fn busy(tmp: &Path) -> Fixture {
    let mut parent_cwds = vec![];
    let mut child_cwds = vec![];
    for r in 0..8 {
        let main = tmp.join(format!("repo{r}"));
        std::fs::create_dir_all(main.join("src")).unwrap();
        git(&["init", "-q", "-b", "main"], &main);
        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], &main);
        for w in 0..2 {
            let wt = tmp.join(format!("repo{r}-wt-{w}"));
            git(&["worktree", "add", "-q", "-b", &format!("feat/f{r}/p{w}"), &s(&wt)], &main);
            child_cwds.push(s(&wt));
        }
        parent_cwds.push(s(&main));
    }
    let focused = Some(s(&tmp.join("repo0").join("src")));
    Fixture { accounts: 2, parent_cwds, child_cwds, focused, panes: 16 }
}

fn idle() -> Fixture {
    Fixture { accounts: 1, parent_cwds: vec![], child_cwds: vec![], focused: None, panes: 0 }
}

/// What happens at a moment of the minute: a mission round, or every pane's tick.
#[derive(Clone, Copy, PartialEq)]
enum Tick {
    Round,
    Panes,
}

fn minute() -> Vec<(u64, Tick)> {
    let mut at: Vec<(u64, Tick)> = (0..MINUTE_MS).step_by(ROUND_MS as usize).map(|t| (t, Tick::Round)).collect();
    at.extend((0..MINUTE_MS).step_by(PANE_MS as usize).map(|t| (t, Tick::Panes)));
    at.sort_by_key(|(t, k)| (*t, *k == Tick::Panes));
    at
}

/// `cwds` in the order the round walks them, once each.
fn distinct_cwds(f: &Fixture) -> Vec<String> {
    let mut seen = HashSet::new();
    f.parent_cwds.iter().chain(&f.child_cwds).chain(&f.focused).filter(|c| seen.insert((*c).clone())).cloned().collect()
}

fn before(f: &Fixture) -> Count {
    let mut n = Count::default();
    // The repo of each cwd, as git answers it; counted per round and asked once here.
    let roots: HashSet<String> = distinct_cwds(f).iter().filter_map(|c| git_root(c).ok()).collect();
    let old = crate::chrome::Cache::<usize>::new(Duration::from_secs(3));
    let base = Instant::now();
    let claude = AtomicUsize::new(0);
    for (t, tick) in minute() {
        let now = base + Duration::from_millis(t);
        match tick {
            Tick::Round => {
                n.claude += f.accounts;
                n.mnemo += 1;
                n.rev_parse += distinct_cwds(f).len();
                n.worktree_list += roots.len();
            }
            Tick::Panes => std::thread::scope(|sc| {
                for _ in 0..f.panes {
                    sc.spawn(|| {
                        old.get_or("", now, || {
                            std::thread::sleep(CLAUDE_STAND_IN);
                            claude.fetch_add(f.accounts, Ordering::SeqCst)
                        })
                    });
                }
            }),
        }
    }
    n.claude += claude.load(Ordering::SeqCst);
    n
}

/// One minute through the code that answers now. `change` runs halfway, once.
fn now(f: &Fixture, change: impl FnOnce()) -> Count {
    let shared: Shared<usize> = Shared::default();
    let roots = Roots::default();
    let wts = Worktrees::default();
    let claude = AtomicUsize::new(0);
    let rev_parse = AtomicUsize::new(0);
    let worktree_list = AtomicUsize::new(0);
    // Ten seconds in, so `t - AGENTS_FRESH` never goes below the first instant.
    let base = Instant::now() + Duration::from_secs(10);
    let ask_agents = |t: Instant| {
        for a in 0..f.accounts {
            shared.get(&a.to_string(), t - AGENTS_FRESH, || t, || {
                std::thread::sleep(CLAUDE_STAND_IN);
                claude.fetch_add(1, Ordering::SeqCst)
            });
        }
    };
    let mut change = Some(change);
    let mut checked = 0;
    for (ms, tick) in minute() {
        let t = base + Duration::from_millis(ms);
        if ms >= MINUTE_MS / 2 {
            if let Some(c) = change.take() {
                c();
            }
        }
        match tick {
            Tick::Round => {
                ask_agents(t);
                let mut got: HashMap<String, String> = HashMap::new();
                for cwd in distinct_cwds(f) {
                    let root = roots.get(&cwd, || {
                        rev_parse.fetch_add(1, Ordering::SeqCst);
                        git_root(&cwd)
                    });
                    if let Some(r) = root {
                        got.insert(cwd, r);
                    }
                }
                let mut branches = HashMap::new();
                for r in got.values().collect::<HashSet<_>>() {
                    branches.extend(wts.get(r, || {
                        worktree_list.fetch_add(1, Ordering::SeqCst);
                        ask_worktree_branches(r)
                    }));
                }
                // The first round, the first after the change and the last: the answers are git's.
                if ms == 0 || (change.is_none() && checked < 2) || ms + ROUND_MS >= MINUTE_MS {
                    checked += 1;
                    let direct: HashMap<String, String> = distinct_cwds(f).into_iter().filter_map(|c| git_root(&c).ok().map(|r| (c, r))).collect();
                    assert_eq!(got, direct, "roots at {ms} ms");
                    let mut direct_b = HashMap::new();
                    for r in direct.values().collect::<HashSet<_>>() {
                        direct_b.extend(ask_worktree_branches(r).unwrap());
                    }
                    assert_eq!(branches, direct_b, "worktree branches at {ms} ms");
                }
            }
            Tick::Panes => std::thread::scope(|sc| {
                for _ in 0..f.panes {
                    sc.spawn(|| ask_agents(t));
                }
            }),
        }
    }
    // Children come from `jobs/` and the roster now (`children_of`): no process.
    Count { claude: claude.load(Ordering::SeqCst), mnemo: 0, rev_parse: rev_parse.load(Ordering::SeqCst), worktree_list: worktree_list.load(Ordering::SeqCst) }
}

fn row(name: &str, c: Count) -> String {
    format!("{name:<14} {:>7} {:>6} {:>10} {:>14} {:>6}", c.claude, c.mnemo, c.rev_parse, c.worktree_list, c.total())
}

#[test]
fn spawns_per_minute() {
    let tmp = crate::testutil::temp_dir("spawns");
    let f = busy(&tmp);
    let busy_before = before(&f);
    let busy_now = now(&f, || {
        let main = tmp.join("repo3");
        git(&["worktree", "add", "-q", "-b", "feat/f3/late", &s(&tmp.join("repo3-wt-late"))], &main);
        git(&["checkout", "-q", "-b", "feat/f5/switched"], &tmp.join("repo5-wt-0"));
    });
    let i = idle();
    let idle_before = before(&i);
    let idle_now = now(&i, || {});

    let head = format!("{:<14} {:>7} {:>6} {:>10} {:>14} {:>6}", "per minute", "claude", "mnemo", "rev-parse", "worktree list", "total");
    eprintln!("{head}\n{}\n{}\n{}\n{}", row("idle, before", idle_before), row("idle, now", idle_now), row("busy, before", busy_before), row("busy, now", busy_now));

    let rounds = MINUTE_MS.div_ceil(ROUND_MS) as usize;
    let cwds = distinct_cwds(&f).len();
    // Idle: one account, nothing to look at. The `mnemo` start each round is gone.
    assert_eq!(idle_before, Count { claude: rounds, mnemo: rounds, rev_parse: 0, worktree_list: 0 });
    assert_eq!(idle_now, Count { claude: rounds, mnemo: 0, rev_parse: 0, worktree_list: 0 });
    // Busy: each cwd and repo asked once, then again only where something changed (repo3 and
    // repo5's worktrees, and the new worktree is not a cwd anyone stands in).
    assert_eq!(busy_now.rev_parse, cwds, "{busy_now:?}");
    assert_eq!(busy_now.worktree_list, 8 + 2, "{busy_now:?}");
    assert_eq!(busy_now.mnemo, 0);
    // `claude agents`: the rounds' own, plus the pane ticks that find no answer under 3 s old;
    // one per account per tick, however many panes tick together.
    let pane_ticks = MINUTE_MS.div_ceil(PANE_MS) as usize;
    assert!(busy_now.claude <= (rounds + pane_ticks) * f.accounts, "{busy_now:?}");
    assert!(busy_before.claude >= rounds * f.accounts + pane_ticks * f.panes * f.accounts / 2, "the old cache let panes in step each ask: {busy_before:?}");
    assert!(busy_now.total() * 5 < busy_before.total(), "{busy_now:?} vs {busy_before:?}");
    let _ = std::fs::remove_dir_all(&tmp);
}

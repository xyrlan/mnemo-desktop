//! `read_briefings`, `query_rules`, `list_sessions`: what mnemo and the desktop know of a
//! project's work, read from the vault and the desktop's own session poll. Nothing here runs.

use crate::jarvis::JarvisProject;
use crate::mission::RepoGroup;
use crate::vault::{lookup, parse_frontmatter, split_frontmatter, Yaml};
use std::path::Path;

/// How many briefings `read_briefings` shows when the model names no `since`.
const BRIEFINGS_DEFAULT: usize = 5;

/// How many rules `query_rules` shows, and how much of each one's body.
const RULES_MAX: usize = 8;
const RULE_BODY_CHARS: usize = 700;

// ------------------------------------------------------------- dates --

/// Days since 1970-01-01 → `YYYY-MM-DD` (Howard Hinnant's `civil_from_days`).
pub fn civil(days: i64) -> String {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

/// `YYYY-MM-DD` → days since 1970-01-01.
fn days(date: &str) -> Option<i64> {
    let mut it = date.get(..10)?.split('-');
    let (y, m, d): (i64, i64, i64) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// The first day `since` covers, `YYYY-MM-DD`, counted from `today`: a date, or `today`,
/// `yesterday`, `this week`, `last week`, `N days`, in English or Portuguese. None when it is
/// none of these.
pub fn since_day(since: &str, today: &str) -> Option<String> {
    let s = since.trim().to_lowercase();
    if days(&s).is_some() {
        return Some(s[..10].to_string());
    }
    let t = days(today)?;
    let back = match s.as_str() {
        "today" | "hoje" => 0,
        "yesterday" | "ontem" => 1,
        "this week" | "esta semana" | "essa semana" => 6,
        "last week" | "semana passada" | "a semana passada" => 13,
        "this month" | "este mês" | "esse mês" => 30,
        _ => {
            let n: i64 = s.split_whitespace().next()?.parse().ok()?;
            if !s.contains("day") && !s.contains("dia") {
                return None;
            }
            n.clamp(0, 3650)
        }
    };
    Some(civil(t - back))
}

// --------------------------------------------------------- briefings --

fn str_at(fm: &[(String, Yaml)], key: &str) -> Option<String> {
    match lookup(fm, key)? {
        Yaml::Str(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// The briefings of `p` under `<vault>/bots/<name>/briefings/sessions/`, newest first: each one's
/// date, session and TL;DR. From `since` on when it names a day, else the newest few.
pub fn briefings(vault: &Path, p: &JarvisProject, since: Option<&str>, today: &str) -> Result<String, String> {
    let dir = vault.join("bots").join(&p.name).join("briefings").join("sessions");
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Ok(format!("no briefings for {}", p.name));
    };
    let mut found: Vec<(String, std::time::SystemTime, String, String)> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|f| f.is_file() && f.extension().is_some_and(|x| x == "md"))
        .filter_map(|f| {
            let text = std::fs::read_to_string(&f).ok()?;
            let (fm, body) = match split_frontmatter(&text) {
                Some((yaml, body)) => (parse_frontmatter(&yaml), body),
                None => (vec![], text),
            };
            let mtime = std::fs::metadata(&f).and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            let date = str_at(&fm, "date").unwrap_or_default();
            let session = str_at(&fm, "session_id").unwrap_or_else(|| f.file_stem().unwrap_or_default().to_string_lossy().to_string());
            Some((date, mtime, session, crate::memory_feed::tldr(&body)))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let from = since.filter(|s| !s.trim().is_empty()).map(|s| (s, since_day(s, today)));
    let (picked, head): (Vec<_>, String) = match &from {
        Some((_, Some(day))) => (found.iter().filter(|b| b.0.as_str() >= day.as_str()).collect(), format!("briefings of {} since {day}", p.name)),
        Some((s, None)) => (
            found.iter().take(BRIEFINGS_DEFAULT).collect(),
            format!("\"{}\" is not a day I can read (a date like 2026-10-01, today, yesterday, last week, N days); the newest briefings of {}", s.trim(), p.name),
        ),
        None => (found.iter().take(BRIEFINGS_DEFAULT).collect(), format!("the newest briefings of {}", p.name)),
    };
    if picked.is_empty() {
        return Ok(format!("no {head}"));
    }
    let parts: Vec<String> = picked.iter().map(|(date, _, session, tldr)| format!("### {} — session {session}\n{tldr}", if date.is_empty() { "undated" } else { date })).collect();
    Ok(format!("{} ({}):\n\n{}", head, picked.len(), parts.join("\n\n")))
}

// ------------------------------------------------------------- rules --

/// How many of `query`'s words (three letters or more) a page holds, its name and description
/// counting twice.
fn score(info: &crate::vault::PageInfo, words: &[String]) -> usize {
    let head = format!("{} {} {} {}", info.name, info.slug, info.description, info.topics.join(" ")).to_lowercase();
    let body = info.body.to_lowercase();
    words.iter().map(|w| 2 * usize::from(head.contains(w.as_str())) + usize::from(body.contains(w.as_str()))).sum()
}

/// mnemo's rules for `p` (its own and the shared ones), or every project's when None, that
/// best match `query`: name, where it lives, description, and the start of its body.
pub fn rules(vault: &Path, p: Option<&JarvisProject>, query: &str) -> Result<String, String> {
    let words: Vec<String> = query.to_lowercase().split(|c: char| !c.is_alphanumeric() && c != '-' && c != '_').filter(|w| w.chars().count() >= 3).map(str::to_string).collect();
    let words = if words.is_empty() { vec![query.trim().to_lowercase()] } else { words };
    let pages = crate::vault::live_pages(vault);
    let mut hits: Vec<(usize, &crate::vault::LivePage)> = pages
        .iter()
        .filter(|lp| p.map_or(true, |p| lp.agent == "shared" || lp.agent.eq_ignore_ascii_case(&p.name)))
        .map(|lp| (score(&lp.page.info, &words), lp))
        .filter(|(s, _)| *s > 0)
        .collect();
    hits.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.page.info.name.cmp(&b.1.page.info.name)));
    let whose = p.map_or("any project".to_string(), |p| p.name.clone());
    if hits.is_empty() {
        return Ok(format!("no rule of {whose} matches \"{}\"", query.trim()));
    }
    let parts: Vec<String> = hits
        .iter()
        .take(RULES_MAX)
        .map(|(_, lp)| {
            let i = &lp.page.info;
            let body: String = i.body.trim().chars().take(RULE_BODY_CHARS).collect();
            let more = if i.body.trim().chars().count() > RULE_BODY_CHARS { " …" } else { "" };
            format!("### {} ({}, {})\n{}\n{body}{more}", i.name, lp.agent, i.page_type, i.description)
        })
        .collect();
    Ok(format!("rules of {whose} for \"{}\" ({} of {} matching):\n\n{}", query.trim(), parts.len(), hits.len(), parts.join("\n\n")))
}

// ---------------------------------------------------------- sessions --

fn same_dir(a: &str, b: &str) -> bool {
    let n = |s: &str| s.trim_end_matches(['/', '\\']).replace('\\', "/").to_lowercase();
    n(a) == n(b)
}

/// The name Jarvis knows a repository by: a project's, else the desktop's.
fn repo_name(g: &RepoGroup, projects: &[JarvisProject]) -> String {
    projects.iter().find(|p| same_dir(&p.root, &g.root)).map_or_else(|| g.name.clone(), |p| p.name.clone())
}

fn short(id: &str) -> &str {
    id.get(..8).unwrap_or(id)
}

/// The sessions the desktop knows, in `p`'s repository or in every one: each parent (an
/// interactive session) with its state, and each child with what it is doing.
pub fn sessions(groups: &[RepoGroup], p: Option<&JarvisProject>, projects: &[JarvisProject]) -> Result<String, String> {
    let picked: Vec<&RepoGroup> = groups.iter().filter(|g| p.map_or(true, |p| same_dir(&p.root, &g.root))).collect();
    let parts: Vec<String> = picked
        .iter()
        .filter_map(|g| {
            let mut lines = Vec::new();
            for s in &g.parents {
                let waiting = s.waiting_for.as_deref().map_or(String::new(), |w| format!(" ({w})"));
                let name = s.name.as_deref().map_or(String::new(), |n| format!(" \"{n}\""));
                lines.push(format!("- parent {}{name}: {}{waiting}, in {}", short(&s.session_id), s.status, s.cwd));
            }
            let pieces = g.missions.iter().flat_map(|m| m.pieces.iter().filter_map(|p| p.child.as_ref()));
            for c in g.children.iter().chain(pieces) {
                let mut about = vec![c.state.clone()];
                about.extend(c.needs.clone().map(|n| format!("needs {n}")));
                about.extend(c.branch.clone());
                about.extend(c.pr.as_ref().map(|pr| format!("PR #{} {} (CI {})", pr.number, pr.state.to_lowercase(), pr.ci)));
                let what = c.intent.as_deref().or(c.name.as_deref()).or((!c.detail.is_empty()).then_some(c.detail.as_str())).unwrap_or("");
                let what = if what.is_empty() { String::new() } else { format!(" \"{}\"", what.chars().take(120).collect::<String>()) };
                lines.push(format!("- child {}{what}: {}", c.id, about.join("; ")));
            }
            (!lines.is_empty()).then(|| format!("## {}\n{}", repo_name(g, projects), lines.join("\n")))
        })
        .collect();
    if parts.is_empty() {
        return Ok(match p {
            Some(p) => format!("no sessions in {}", p.name),
            None => "no sessions".to_string(),
        });
    }
    Ok(parts.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jarvis_tools::tests::{ctx_with, no_gh, project_at};
    use crate::mission::{ChildSession, ParentSession};
    use serde_json::json;

    #[test]
    fn days_and_civil_agree() {
        for d in ["1970-01-01", "2000-02-29", "2026-10-23", "2024-12-31", "2025-01-01"] {
            assert_eq!(civil(days(d).unwrap()), d);
        }
        assert_eq!(days("2026-10-23").unwrap() - days("2026-10-22").unwrap(), 1);
        assert_eq!(since_day("ontem", "2026-03-01").as_deref(), Some("2026-02-28"));
        assert_eq!(since_day("Yesterday", "2026-10-23").as_deref(), Some("2026-10-22"));
        assert_eq!(since_day("2026-10-01", "2026-10-23").as_deref(), Some("2026-10-01"));
        assert_eq!(since_day("semana passada", "2026-10-23").as_deref(), Some("2026-10-10"));
        assert_eq!(since_day("3 dias", "2026-10-23").as_deref(), Some("2026-10-20"));
        assert_eq!(since_day("whenever", "2026-10-23"), None);
    }

    fn briefing(dir: &Path, id: &str, date: &str, tldr: &str) {
        std::fs::write(dir.join(format!("{id}.md")), format!("---\ntype: briefing\nsession_id: {id}\ndate: {date}\n---\n\n# Briefing\n\n## TL;DR\n\n{tldr}\n\n## What I did\n\n- things\n")).unwrap();
    }

    #[test]
    fn briefings_since_a_day_newest_first() {
        let vault = crate::testutil::temp_dir("jarvis-briefings");
        let dir = vault.join("bots").join("app").join("briefings").join("sessions");
        std::fs::create_dir_all(&dir).unwrap();
        briefing(&dir, "aaaa", "2026-10-20", "Old work.");
        briefing(&dir, "bbbb", "2026-10-22", "Built the thing.");
        briefing(&dir, "cccc", "2026-10-23", "Fixed the other thing.");
        let mut ctx = ctx_with(vec![project_at("app", &vault)], &no_gh);
        ctx.vault = Some(vault.clone());
        let got = crate::jarvis_tools::run("read_briefings", &json!({ "project": "app", "since": "ontem" }), &ctx).unwrap();
        assert_eq!(got, "briefings of app since 2026-10-22 (2):\n\n### 2026-10-23 — session cccc\nFixed the other thing.\n\n### 2026-10-22 — session bbbb\nBuilt the thing.");
        let all = crate::jarvis_tools::run("read_briefings", &json!({ "project": "app" }), &ctx).unwrap();
        assert!(all.starts_with("the newest briefings of app (3):"), "{all}");
        let odd = crate::jarvis_tools::run("read_briefings", &json!({ "project": "app", "since": "whenever" }), &ctx).unwrap();
        assert!(odd.contains("is not a day I can read") && odd.contains("session aaaa"), "{odd}");
        ctx.vault = None;
        assert!(crate::jarvis_tools::run("read_briefings", &json!({ "project": "app" }), &ctx).unwrap_err().contains("no mnemo vault"));
    }

    fn rule(dir: &Path, slug: &str, name: &str, description: &str, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join(format!("{slug}.md")), format!("---\nname: {name}\ndescription: {description}\nmetadata:\n  type: feedback\n---\n\n{body}\n")).unwrap();
    }

    #[test]
    fn rules_of_a_project_and_the_shared_ones_best_first() {
        let vault = crate::testutil::temp_dir("jarvis-rules");
        rule(&vault.join("bots").join("app").join("memory"), "tests-first", "Tests first", "Write the failing test before the fix", "Always start from a failing test.");
        rule(&vault.join("bots").join("other").join("memory"), "other-tests", "Other tests", "Tests of another project", "Not app's.");
        rule(&vault.join("shared").join("feedback"), "commit-style", "Commit style", "How commits read", "Subjects say what changed; tests named.");
        let mut ctx = ctx_with(vec![project_at("app", &vault)], &no_gh);
        ctx.vault = Some(vault.clone());
        let got = crate::jarvis_tools::run("query_rules", &json!({ "project": "app", "query": "regras de tests" }), &ctx).unwrap();
        assert!(got.starts_with("rules of app for \"regras de tests\" (2 of 2 matching):"), "{got}");
        let first = got.find("### Tests first (app, feedback)").expect(&got);
        assert!(first < got.find("### Commit style (shared").expect(&got));
        assert!(!got.contains("Other tests"));
        let any = crate::jarvis_tools::run("query_rules", &json!({ "query": "tests" }), &ctx).unwrap();
        assert!(any.contains("Other tests"), "{any}");
        assert!(crate::jarvis_tools::run("query_rules", &json!({ "project": "app", "query": "kubernetes" }), &ctx).unwrap().starts_with("no rule of app"));
    }

    fn parent(id: &str, status: &str, waiting: Option<&str>, cwd: &str) -> ParentSession {
        serde_json::from_value(json!({ "session_id": id, "pid": 1, "name": null, "status": status, "cwd": cwd, "waiting_for": waiting })).unwrap()
    }

    fn child(id: &str, state: &str, intent: &str, cwd: &str) -> ChildSession {
        serde_json::from_value(json!({
            "id": id, "session_id": null, "name": null, "state": state, "tempo": "", "needs": null, "detail": "", "suggested_reply": null,
            "cwd": cwd, "tokens": 0, "live": true, "updated_at": null, "intent": intent, "branch": "feat/x", "timeline_len": 0, "parent_session": null,
            "waiting_for": null, "model": null, "effort": null, "pr": null
        }))
        .unwrap()
    }

    fn group(root: &str, name: &str, parents: Vec<ParentSession>, children: Vec<ChildSession>) -> RepoGroup {
        RepoGroup { root: root.into(), name: name.into(), parents, missions: vec![], children }
    }

    #[test]
    fn sessions_of_one_project_or_of_all() {
        let groups = vec![
            group("/Users/you/app", "app", vec![parent("1234567890ab", "waiting", Some("permission prompt"), "/Users/you/app")], vec![child("c1", "working", "fix the test", "/Users/you/app-wt-1")]),
            group("/Users/you/other", "other", vec![parent("abcdef0123", "idle", None, "/Users/you/other")], vec![]),
        ];
        let projects = vec![JarvisProject { name: "the-app".into(), aliases: vec![], root: "/Users/you/app/".into() }];
        let one = sessions(&groups, Some(&projects[0]), &projects).unwrap();
        assert_eq!(one, "## the-app\n- parent 12345678: waiting (permission prompt), in /Users/you/app\n- child c1 \"fix the test\": working; feat/x");
        let all = sessions(&groups, None, &projects).unwrap();
        assert!(all.contains("## the-app") && all.contains("## other\n- parent abcdef01: idle, in /Users/you/other"), "{all}");
        assert_eq!(sessions(&[], Some(&projects[0]), &projects).unwrap(), "no sessions in the-app");
    }
}

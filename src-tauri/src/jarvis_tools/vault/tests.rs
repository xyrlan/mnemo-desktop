use super::*;
use crate::jarvis_tools::tests::{ctx_with, no_gh, project_at};
use crate::jarvis_tools::{run, MAX_CHARS};
use serde_json::json;

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn briefing(vault: &Path, bot: &str, id: &str, date: &str, tldr: &str, body: &str) -> PathBuf {
    let path = vault.join("bots").join(bot).join("briefings").join("sessions").join(format!("{id}.md"));
    write(&path, &format!("---\ntype: briefing\nagent: {bot}\nsession_id: {id}\ndate: {date}\n---\n\n# Briefing — {bot} — {id}\n\n## TL;DR\n\n{tldr}\n\n## What I did\n\n{body}\n"));
    path
}

fn note(path: &Path, name: &str, kind: &str, description: &str, body: &str) {
    write(path, &format!("---\nname: {name}\ndescription: {description}\nmetadata:\n  type: {kind}\n---\n\n{body}\n"));
}

/// A small vault: two projects with briefings, a worktree of one, their notes and shared ones,
/// and what a search must not read (the inbox, a noise bot's memory, index files).
fn vault() -> PathBuf {
    let v = crate::testutil::temp_dir("jarvis-vault");
    briefing(&v, "app", "aaaa1111-x", "2026-10-20", "Moved the settings file to TOML. The old JSON is read once and migrated.", "- Wrote the migration in `settings.rs`\n- The configuration now lives in `app.toml`\n- Tests cover a broken file");
    briefing(&v, "app", "bbbb2222-x", "2026-10-22", "Fixed the login crash on Windows. A null token made the refresh panic.", "- Guarded the token refresh\n- Added a regression test");
    briefing(&v, "app-wt-feature-1", "cccc3333-x", "2026-10-23", "Decided against embeddings for search; words were enough.", "- Measured top-5 recall over 25 questions\n- The decision: keep BM25");
    briefing(&v, "other", "dddd4444-x", "2026-10-21", "Built the invoice export to CSV.", "- The export streams rows\n- Decided on semicolons for the separator");
    note(&v.join("bots").join("app").join("memory").join("token-refresh.md"), "token-refresh", "project", "The token refresh runs before every request", "A null token used to panic the refresh. Guarded since October.");
    note(&v.join("shared").join("feedback").join("tests-first.md"), "Tests first", "feedback", "Write the failing test before the fix", "Every bug fix starts from a failing regression test.");
    note(&v.join("bots").join("other").join("memory").join("csv-separator.md"), "csv-separator", "project", "Exports use semicolons", "Spreadsheets in Portuguese read commas as decimals.");
    write(
        &v.join("shared").join("project").join("other__csv-quoting.md"),
        "---
name: csv-quoting
description: Quote every field
type: project
agent: other
---

The separator inside a field is quoted.
",
    );
    note(&v.join("shared").join("_inbox").join("feedback").join("staged.md"), "Staged", "feedback", "Not yet a live note", "migration embeddings token crash");
    note(&v.join("shared").join("_inbox").join("staged-flat.md"), "Staged flat", "feedback", "Not yet a live note either", "migration embeddings token crash");
    note(&v.join("shared").join("_archive").join("expired.md"), "Expired", "feedback", "A rule mnemo retired", "migration embeddings token crash");
    note(&v.join("bots").join("tmp-probe").join("memory").join("noise.md"), "noise", "project", "A probe's page", "migration embeddings token crash");
    write(&v.join("shared").join("README.md"), "migration embeddings token crash");
    v
}

fn ctx(v: &Path) -> crate::jarvis_tools::Ctx<'static> {
    let mut c = ctx_with(vec![project_at("app", v), project_at("other", v)], &no_gh);
    c.vault = Some(v.to_path_buf());
    c
}

fn names(v: &Path, p: Option<&str>, query: &str) -> Vec<String> {
    let project = p.map(|n| project_at(n, v));
    rank(v, project.as_ref(), query).into_iter().map(|(path, _)| path.file_stem().unwrap().to_string_lossy().to_string()).collect()
}

#[test]
fn words_fold_accents_drop_stopwords_and_share_stems_across_languages() {
    let mut got = Vec::new();
    words("O que decidimos sobre a Configuração? the configuration was configured", |w, s| got.push((w.to_string(), s)));
    assert_eq!(
        got,
        [("decidimos", "decid"), ("configuracao", "configur"), ("configuration", "configur"), ("configured", "configur")].map(|(w, s)| (w.to_string(), s.to_string()))
    );
    assert_eq!(stem("decisao"), stem("decision"));
    assert_eq!(stem("decidimos"), stem("decided"));
    assert_eq!(stem("funcionou"), stem("funcionava"));
    assert_eq!(stem("funcionava"), stem("funcionar"));
    assert_eq!(stem("testes"), stem("tests"));
    assert_eq!(stem("testing"), "test");
    assert_eq!(stem("user"), "user", "never below four letters");
    assert_eq!(stem("503"), "503");
}

#[test]
fn briefings_and_notes_best_first_in_either_language() {
    let v = vault();
    // English and Portuguese words, as the brain writes them.
    let got = names(&v, None, "migração migration configuração settings toml");
    assert_eq!(got.first().map(String::as_str), Some("aaaa1111-x"), "{got:?}");
    let got = names(&v, None, "travamento crash login token Windows");
    assert_eq!(got[0], "bbbb2222-x", "{got:?}");
    assert!(got.contains(&"token-refresh".to_string()), "{got:?}");
    let got = names(&v, None, "decisão decision embeddings");
    assert_eq!(got[0], "cccc3333-x", "{got:?}");
}

#[test]
fn a_project_searches_its_own_pages_its_worktrees_and_the_shared_ones() {
    let v = vault();
    let got = names(&v, Some("app"), "decided decision separator test");
    assert!(got.contains(&"cccc3333-x".to_string()), "a worktree's briefing is the project's: {got:?}");
    assert!(got.contains(&"tests-first".to_string()), "shared notes are every project's: {got:?}");
    assert!(!got.iter().any(|g| g == "dddd4444-x" || g == "csv-separator"), "another project's pages are not: {got:?}");
    assert!(!got.iter().any(|g| g == "other__csv-quoting"), "nor its notes promoted to shared/: {got:?}");
    let all = names(&v, None, "decided decision separator test");
    assert!(["dddd4444-x", "csv-separator", "other__csv-quoting"].iter().all(|n| all.contains(&n.to_string())), "{all:?}");
    let other = run("search_vault", &json!({ "query": "quoted separator", "project": "other" }), &ctx(&v)).unwrap();
    assert!(other.contains("note (project, other): csv-quoting
Quote every field"), "{other}");
}

#[test]
fn the_inbox_noise_bots_and_index_files_are_not_searched() {
    let v = vault();
    let got = names(&v, None, "migration embeddings token crash");
    assert!(!got.iter().any(|g| ["staged", "staged-flat", "expired", "noise", "README"].contains(&g.as_str())), "{got:?}");
}

#[test]
fn a_rare_word_counts_for_more_than_a_common_one() {
    let v = crate::testutil::temp_dir("jarvis-vault-idf");
    for i in 0..6 {
        briefing(&v, "app", &format!("comm{i:04}-x"), "2026-10-01", "Routine work on the release.", "- release notes\n- release checks");
    }
    briefing(&v, "app", "aaaa0000-x", "2026-10-02", "Release, release and the release again.", "- release release release");
    briefing(&v, "app", "zzzz0000-x", "2026-09-01", "Found the deadlock.", "- The deadlock was in the pool");
    let got = names(&v, None, "release deadlock");
    assert_eq!(got[0], "zzzz0000-x", "{got:?}");
}

#[test]
fn a_short_page_with_a_word_beats_a_long_one_with_it_as_often() {
    let v = crate::testutil::temp_dir("jarvis-vault-length");
    briefing(&v, "app", "short000-x", "2026-10-01", "A short session.", "- Tuned the cache.");
    let filler = (0..300).map(|i| format!("word{i}")).collect::<Vec<_>>().join(" ");
    // Later, so that it would come first were the two scored alike.
    briefing(&v, "app", "long0000-x", "2026-10-02", "A long session.", &format!("- Tuned the cache.\n- {filler}"));
    assert_eq!(names(&v, None, "cache"), ["short000-x", "long0000-x"]);
}

#[test]
fn a_word_in_the_tldr_counts_for_more_than_one_in_the_body() {
    let v = crate::testutil::temp_dir("jarvis-vault-tldr");
    briefing(&v, "app", "tldr0000-x", "2026-10-01", "Upgraded webpack.", "- small steps");
    briefing(&v, "app", "body0000-x", "2026-10-02", "Small steps.", "- upgraded webpack");
    assert_eq!(names(&v, None, "webpack"), ["tldr0000-x", "body0000-x"]);
}

#[test]
fn a_word_finds_the_longer_ones_it_starts_after_its_own() {
    let v = crate::testutil::temp_dir("jarvis-vault-prefix");
    briefing(&v, "app", "exact000-x", "2026-10-01", "The config moved.", "- config");
    briefing(&v, "app", "longer00-x", "2026-10-02", "The configurator moved.", "- configurator");
    briefing(&v, "app", "errors00-x", "2026-10-03", "Logged the errors.", "- errors");
    assert_eq!(names(&v, None, "config"), ["exact000-x", "longer00-x"]);
    assert_eq!(names(&v, None, "erro"), ["errors00-x"], "a stem shorter than every page's word");
}

#[test]
fn a_note_and_its_copy_in_shared_are_one_hit() {
    let v = crate::testutil::temp_dir("jarvis-vault-copy");
    note(&v.join("bots").join("app").join("memory").join("retry-policy.md"), "retry-policy", "project", "Retries back off", "Every retry doubles its wait.");
    write(
        &v.join("shared").join("project").join("app__retry-policy.md"),
        "---\nname: retry-policy\ndescription: Retries back off\ntype: project\nagent: app\n---\n\nEvery retry doubles its wait.\n",
    );
    assert_eq!(names(&v, None, "retry wait").len(), 1);
}

#[test]
fn a_hit_says_what_it_is_its_title_and_the_lines_that_matched() {
    let v = vault();
    let got = run("search_vault", &json!({ "query": "login crash Windows", "project": "app" }), &ctx(&v)).unwrap();
    assert!(got.starts_with("the vault's pages (app and the shared notes) for \"login crash Windows\", best first ("), "{got}");
    let first = got.split("\n\n### 2.").next().unwrap();
    assert_eq!(first.lines().nth(2), Some("### 1. briefing of app, 2026-10-22 (session bbbb2222)"), "{got}");
    assert_eq!(first.lines().nth(3), Some("Fixed the login crash on Windows."), "the TL;DR's first sentence: {got}");
    assert!(first.contains("## TL;DR
A null token made the refresh panic.
## What I did"), "the matching line, with the ones around it: {got}");
    assert_eq!(first.matches("Fixed the login crash").count(), 1, "the title is said once: {got}");
    let note = run("search_vault", &json!({ "query": "failing regression test" }), &ctx(&v)).unwrap();
    assert!(note.contains("### 1. note (feedback, shared): Tests first\nWrite the failing test before the fix\nEvery bug fix starts from a failing regression test."), "{note}");
}

#[test]
fn nothing_matching_and_no_words_are_said() {
    let v = vault();
    let c = ctx(&v);
    assert_eq!(run("search_vault", &json!({ "query": "kubernetes", "project": "app" }), &c).unwrap(), "nothing in the vault (app and the shared notes) matches \"kubernetes\"");
    assert_eq!(run("search_vault", &json!({ "query": "o que é isso?" }), &c).unwrap(), "\"o que é isso?\" has no word to search the vault for: name the subject");
    assert!(run("search_vault", &json!({}), &c).unwrap_err().contains("needs query"));
    assert!(run("search_vault", &json!({ "query": "x", "project": "nope" }), &c).unwrap_err().starts_with("unknown project"));
    let mut none = ctx(&v);
    none.vault = None;
    assert!(run("search_vault", &json!({ "query": "crash" }), &none).unwrap_err().contains("no mnemo vault"));
}

#[test]
fn the_index_follows_the_vault_between_searches() {
    let v = vault();
    assert!(names(&v, None, "kubernetes").is_empty());
    let added = briefing(&v, "app", "eeee5555-x", "2026-10-24", "Moved the deploy to Kubernetes.", "- Wrote the manifests");
    assert_eq!(names(&v, None, "kubernetes"), ["eeee5555-x"]);
    // A change of size is a change, whatever the mtime's resolution.
    briefing(&v, "app", "eeee5555-x", "2026-10-24", "Moved the deploy back to plain VMs.", "- Dropped the manifests and the cluster");
    assert!(names(&v, None, "kubernetes").is_empty());
    assert_eq!(names(&v, None, "cluster"), ["eeee5555-x"]);
    std::fs::remove_file(&added).unwrap();
    assert!(names(&v, None, "cluster").is_empty());
}

#[test]
fn long_lines_are_clipped_around_the_match_and_the_output_is_capped() {
    let v = vault();
    let long = format!("{} the needle is here {}", "hay ".repeat(400), "straw ".repeat(400));
    for i in 0..40 {
        briefing(&v, "app", &format!("ffff{i:04}-x"), "2026-10-01", &format!("Session {i} about the needle."), &format!("{long}\n- needle again\n- and the needle once more"));
    }
    let got = run("search_vault", &json!({ "query": "needle" }), &ctx(&v)).unwrap();
    assert!(got.chars().count() <= MAX_CHARS, "{}", got.chars().count());
    assert!(got.contains("(8 of 40 matching)"), "{}", &got[..200]);
    assert!(got.contains("… hay hay") && got.contains("the needle is here straw") && got.contains("straw …"), "{got}");
    assert!(!got.contains("[cut here"), "each hit fits its share");
}

#[test]
fn a_line_just_over_the_limit_is_clipped_to_a_space_at_its_end() {
    let v = crate::testutil::temp_dir("jarvis-vault-clip");
    let q = with_index(&v, |ix| ix.query("needle"));
    for pad in 0..12 {
        // The match near the end, a word boundary just after where the window would start.
        let line = format!("{}{} words then the needle", "x".repeat(pad), " ab".repeat((LINE_CHARS + 20 - pad) / 3));
        let got = clip(&line, &q);
        assert!(got.starts_with("… ") && got.ends_with("the needle"), "{pad}: {got}");
        assert!(got.chars().count() <= LINE_CHARS + 2, "{pad}: {}", got.chars().count());
    }
}

/// Words are enough, or not: over a question set kept outside the repository, how often the
/// page that answers is first and in the top five, and how long a search takes.
/// `JARVIS_VAULT_EVAL=~/.mnemo-desktop-dev/vault-eval.jsonl cargo test --release --lib
/// jarvis_tools::vault::tests::eval -- --ignored --nocapture`. Each line is
/// `{"question", "query", "answer", "project"?}`: the maintainer's question, the words the brain
/// would search for, and the answering page's path under the vault. Only numbers are printed,
/// with each row's rank, so a run can be pasted.
#[test]
#[ignore = "reads the machine's vault and a private question set"]
fn eval() {
    let set = std::env::var("JARVIS_VAULT_EVAL").expect("JARVIS_VAULT_EVAL names the question set");
    let set = set.strip_prefix("~/").map_or_else(|| PathBuf::from(&set), |rest| crate::app_dir::home().join(rest));
    let root = crate::vault::vault_root().expect("a mnemo vault");
    let rows: Vec<serde_json::Value> = std::fs::read_to_string(&set).unwrap().lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect();

    let t = std::time::Instant::now();
    rank(&root, None, "warm");
    let cold = t.elapsed();
    let (briefings, notes) = with_index(&root, |ix| (ix.docs.values().filter(|d| d.kind == Kind::Briefing).count(), ix.docs.values().filter(|d| d.kind == Kind::Note).count()));
    let bytes: u64 = sources(&root).iter().map(|s| s.3 .0).sum();
    let (stems, entries) = with_index(&root, |ix| (ix.stems.len(), ix.docs.values().map(|d| d.terms.len()).sum::<usize>()));
    println!("vault: {briefings} briefings, {notes} notes, {:.1} MB; cold index {} ms; {stems} stems, {entries} counts", bytes as f64 / 1e6, cold.as_millis());

    for field in ["question", "query"] {
        let (mut first, mut five, mut times) = (0, 0, Vec::new());
        let mut ranks = Vec::new();
        for row in &rows {
            let words = row[field].as_str().unwrap();
            let answer = row["answer"].as_str().unwrap();
            let project = row["project"].as_str().map(|n| project_at(n, &root));
            let t = std::time::Instant::now();
            search(&root, project.as_ref(), words).unwrap();
            times.push(t.elapsed().as_secs_f64() * 1000.0);
            let got = rank(&root, project.as_ref(), words);
            // The answer, or a page with its body (a note and its copy in `shared/`).
            let is_answer = |p: &PathBuf| p.strip_prefix(&root).is_ok_and(|r| r.to_string_lossy().replace('\\', "/") == answer);
            let body = with_index(&root, |ix| ix.docs.iter().find(|(p, _)| is_answer(p)).map(|(_, d)| d.body)).unwrap_or_else(|| panic!("{answer} is not a page the search reads"));
            let at = with_index(&root, |ix| got.iter().position(|(p, _)| ix.docs.get(p).is_some_and(|d| d.body == body)));
            first += usize::from(at == Some(0));
            five += usize::from(at.is_some_and(|a| a < 5));
            ranks.push(at.map_or("-".to_string(), |a| (a + 1).to_string()));
            // `JARVIS_VAULT_EVAL_SHOW=1` names what outranked a miss: page paths, for the
            // terminal only.
            if std::env::var_os("JARVIS_VAULT_EVAL_SHOW").is_some() && at != Some(0) {
                let above: Vec<String> = got.iter().take(at.unwrap_or(3).min(3)).map(|(p, s)| format!("{} ({s:.1})", p.strip_prefix(&root).unwrap_or(p).display())).collect();
                println!("  {field} row {}: {answer} at {:?}, under {}", ranks.len(), at.map(|a| a + 1), above.join(", "));
            }
        }
        times.sort_by(f64::total_cmp);
        let n = rows.len();
        println!(
            "{field}: first {first}/{n} ({:.0}%), top five {five}/{n} ({:.0}%); warm search median {:.0} ms, max {:.0} ms\n  ranks: {}",
            100.0 * first as f64 / n as f64,
            100.0 * five as f64 / n as f64,
            times[n / 2],
            times[n - 1],
            ranks.join(" ")
        );
    }
}

use super::fixture::*;
use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[test]
fn serialises_as_types_ts_reads_it() {
    let tokens = TokenRow { input: 1, output: 2, cache_read: 3, cache_creation: 4, thinking: 5 };
    let i = Insight {
        title: Some("The reader".into()),
        permission_mode: Some("plan".into()),
        account_uuid: Some("acc".into()),
        started_at: Some(1),
        last_at: Some(2),
        last_prompt: Some("go".into()),
        recap: Some(Words { at: 3, text: "halfway".into() }),
        pending_ask: Some(PendingAsk { id: "q1".into(), at: 4, question: "Which?".into(), options: vec![AskOption { label: "a".into(), description: "d".into() }] }),
        turn_ms: 9,
        tokens: Tokens {
            main: tokens,
            subagents: vec![SubagentTokens { id: "a1".into(), agent_type: Some("Explore".into()), calls: 2, tokens, ..SubagentTokens::default() }],
            by_model: HashMap::from([("claude-opus-5".to_string(), tokens)]),
            ..Tokens::default()
        },
        cost: Some(Cost { usd: 1.5, api_ms: 1, tool_ms: 2, lines_added: 3, lines_removed: 4 }),
        context: Context { tokens: Some(160_000), window: 200_000, percent: Some(80.0), series: vec![(5, 160_000)], compactions: vec![Compaction { at: 6, pre: 7, post: 8, trigger: None }] },
        activity: vec![ToolCall { at: 7, tool: "Bash".into(), kind: "shell".into(), target: "ls".into(), running: false, ok: Some(true), ms: Some(40) }],
        activity_total: 1,
        activity_counts: HashMap::from([("shell".to_string(), 1)]),
        timeline: vec![Bucket { t: 0, kinds: HashMap::from([("shell".to_string(), 1)]) }],
        web: Web { shots: vec![Shot { id: "1f.0.2".into(), at: 8, url: None, title: None, media_type: "image/png".into() }], ..Web::default() },
        files: Files { edited: vec![EditedFile { path: "/a".into(), edits: 2, last_at: 9 }], read: vec![] },
        memory: ClaudeMemory { instructions: vec![Instruction { path: "/CLAUDE.md".into(), kind: "Project".into(), at: 1, bytes: 10 }], ..ClaudeMemory::default() },
        ..Insight::default()
    };
    let v = serde_json::to_value(&i).unwrap();
    assert_eq!(v["permissionMode"], json!("plan"));
    assert_eq!((&v["accountUuid"], &v["startedAt"], &v["lastAt"], &v["lastPrompt"], &v["turnMs"]), (&json!("acc"), &json!(1), &json!(2), &json!("go"), &json!(9)));
    assert_eq!(v["pendingAsk"], json!({ "id": "q1", "at": 4, "question": "Which?", "options": [{ "label": "a", "description": "d" }] }));
    assert_eq!(v["tokens"]["main"], json!({ "input": 1, "output": 2, "cacheRead": 3, "cacheCreation": 4, "thinking": 5 }));
    assert_eq!(v["tokens"]["subagents"][0]["agentType"], json!("Explore"));
    assert_eq!(v["tokens"]["byModel"]["claude-opus-5"]["cacheRead"], json!(3));
    assert_eq!(v["cost"], json!({ "usd": 1.5, "apiMs": 1, "toolMs": 2, "linesAdded": 3, "linesRemoved": 4 }));
    assert_eq!(v["context"]["series"], json!([[5, 160_000]]));
    assert_eq!(v["context"]["compactions"][0], json!({ "at": 6, "pre": 7, "post": 8, "trigger": null }));
    assert_eq!(v["activity"][0], json!({ "at": 7, "tool": "Bash", "kind": "shell", "target": "ls", "running": false, "ok": true, "ms": 40 }));
    assert_eq!((&v["activityTotal"], &v["activityCounts"]["shell"], &v["timeline"][0]["kinds"]["shell"]), (&json!(1), &json!(1), &json!(1)));
    assert_eq!(v["web"]["shots"][0], json!({ "id": "1f.0.2", "at": 8, "url": null, "title": null, "mediaType": "image/png" }));
    assert_eq!(v["files"]["edited"][0]["lastAt"], json!(9));
    assert_eq!(v["memory"]["instructions"][0], json!({ "path": "/CLAUDE.md", "kind": "Project", "at": 1, "bytes": 10 }));

    let ask: InsightAsk = serde_json::from_value(json!({ "key": "a1", "sessionId": "s", "cwd": "/r", "account": "default" })).unwrap();
    assert_eq!((ask.key.as_str(), ask.session_id.as_str()), ("a1", "s"));
}

// ------------------------------------------------------------------ one call --

struct Fixture {
    dir: PathBuf,
    lookups: Arc<AtomicUsize>,
}

impl Fixture {
    fn new(tag: &str) -> Fixture {
        Fixture { dir: crate::testutil::temp_dir(tag), lookups: Arc::default() }
    }

    fn path(&self, session: &str) -> PathBuf {
        self.dir.join(format!("{session}.jsonl"))
    }

    fn write(&self, session: &str, lines: &[serde_json::Value]) {
        std::fs::write(self.path(session), file(lines)).unwrap();
    }

    fn append(&self, session: &str, bytes: &[u8]) {
        append(&self.path(session), bytes);
    }

    fn deps(&self) -> Deps {
        let (dir, lookups) = (self.dir.clone(), self.lookups.clone());
        Deps {
            transcript: Box::new(move |ask| {
                lookups.fetch_add(1, Ordering::SeqCst);
                Some(dir.join(format!("{}.jsonl", ask.session_id))).filter(|p| p.is_file())
            }),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn append(path: &Path, bytes: &[u8]) {
    use std::io::Write;
    std::fs::OpenOptions::new().append(true).open(path).and_then(|mut f| f.write_all(bytes)).unwrap();
}

fn ask(key: &str, session: &str) -> InsightAsk {
    InsightAsk { key: key.into(), session_id: session.into(), cwd: "/r".into(), account: "default".into() }
}

#[test]
fn each_ask_is_answered_under_its_key_and_a_session_without_a_transcript_is_absent() {
    let fx = Fixture::new("insight-answer");
    fx.write("p1", &[prompt(1, "ship the reader"), says(2, "m1", "on it", usage(1, 2, 3, 4))]);
    fx.write("c1", &[tool(3, "m2", "t1", "Bash", json!({ "command": "pnpm test" }))]);
    let mut state = State::default();
    // A child asked about by its id and again as a piece: the same session, read once.
    let answer = state.answer(&[ask("p1", "p1"), ask("a1", "c1"), ask("piece", "c1"), ask("gone", "gone")], T0_MS, &fx.deps());
    assert_eq!(answer.len(), 3);
    assert_eq!((answer["p1"].last_prompt.as_deref(), answer["p1"].said.as_ref().map(|w| w.text.as_str())), (Some("ship the reader"), Some("on it")));
    assert_eq!(answer["a1"].activity[0].target, "pnpm test");
    assert_eq!(answer["a1"], answer["piece"]);
    assert!(!answer.contains_key("gone"), "absent, not an error");
    assert_eq!(state.held.len(), 2);
}

#[test]
fn a_call_with_nothing_new_reads_nothing_and_builds_nothing() {
    let fx = Fixture::new("insight-nothing-new");
    fx.write("s", &[prompt(1, "go"), says(2, "m1", "first", usage(1, 2, 3, 4))]);
    let (mut state, deps) = (State::default(), fx.deps());
    let first = state.answer(&[ask("s", "s")], T0_MS, &deps);
    // Mark what is held: an answer that still carries the mark was not built again.
    state.held.get_mut(&fx.path("s")).unwrap().built.as_mut().unwrap().title = Some("held".into());
    let again = state.answer(&[ask("s", "s")], T0_MS + 3_000, &deps);
    assert_eq!(again["s"].title.as_deref(), Some("held"));
    assert_eq!(Insight { title: None, ..again["s"].clone() }, first["s"]);
    assert_eq!(fx.lookups.load(Ordering::SeqCst), 1, "a transcript found is not looked for again");

    fx.append("s", file(&[says(5, "m2", "second", usage(1, 2, 3, 4))]).as_bytes());
    let grown = state.answer(&[ask("s", "s")], T0_MS + 6_000, &deps);
    assert_eq!((grown["s"].title.as_deref(), grown["s"].said.as_ref().map(|w| w.text.as_str())), (None, Some("second")));
}

#[test]
fn what_was_appended_adds_to_what_was_held() {
    let fx = Fixture::new("insight-appended");
    let lines = browsing();
    let text = file(&lines);
    let whole = text.as_bytes();
    // The file as it grows: cut inside a line, which then waits for its end.
    let (mut state, deps) = (State::default(), fx.deps());
    std::fs::write(fx.path("s"), "").unwrap();
    let mut written = 0;
    for (n, cut) in [whole.len() / 3, whole.len() / 2 + 7, whole.len() - 1, whole.len()].into_iter().enumerate() {
        fx.append("s", &whole[written..cut]);
        written = cut;
        let grown = state.answer(&[ask("s", "s")], T0_MS + n as u64 * 3_000, &deps);
        let lines_whole = whole[..cut].iter().filter(|b| **b == b'\n').count();
        let mut fresh = session::Session::default();
        for (line, raw) in text.lines().take(lines_whole).enumerate() {
            let offset: usize = text.lines().take(line).map(|l| l.len() + 1).sum();
            tail::Sink::line(&mut fresh, offset as u64, raw);
        }
        assert_eq!(grown["s"], fresh.insight(vec![]), "after {cut} bytes");
    }
    assert_eq!(state.answer(&[ask("s", "s")], T0_MS + 60_000, &deps)["s"].web.shots.len(), 4);
}

#[test]
fn a_sub_agent_s_tokens_are_in_own_and_a_message_both_hold_is_counted_once() {
    let fx = Fixture::new("insight-with-subagents");
    fx.write("s", &[says(1, "m1", "start the review", usage(10, 20, 300, 40))]);
    let dir = fx.dir.join("s").join("subagents");
    std::fs::create_dir_all(&dir).unwrap();
    // A fork opens on its parent's last message, then makes its own call.
    std::fs::write(dir.join("agent-f1.jsonl"), file(&[says(1, "m1", "start the review", usage(10, 20, 300, 40)), says(2, "m2", "reviewed", usage(1, 2, 3, 4))])).unwrap();
    std::fs::write(dir.join("agent-f1.meta.json"), json!({ "agentType": "fork", "description": "Review the reader" }).to_string()).unwrap();

    let (mut state, deps) = (State::default(), fx.deps());
    let t = state.answer(&[ask("s", "s")], T0_MS, &deps)["s"].tokens.clone();
    let (main, sub) = (TokenRow { input: 10, output: 20, cache_read: 300, cache_creation: 40, thinking: 10 }, TokenRow { input: 1, output: 2, cache_read: 3, cache_creation: 4, thinking: 1 });
    assert_eq!(t.main, main);
    assert_eq!(t.subagents, [SubagentTokens { id: "f1".into(), description: "Review the reader".into(), agent_type: Some("fork".into()), model: Some("claude-opus-5".into()), calls: 1, tokens: sub }]);
    assert_eq!(t.own, TokenRow { input: 11, output: 22, cache_read: 303, cache_creation: 44, thinking: 11 });

    // The sub-agent writes while the session's own transcript stands still: the answer moves.
    append(&dir.join("agent-f1.jsonl"), file(&[says(3, "m3", "and again", usage(5, 5, 5, 5))]).as_bytes());
    let t = state.answer(&[ask("s", "s")], T0_MS + 3_000, &deps)["s"].tokens.clone();
    assert_eq!((t.subagents[0].calls, t.own.input), (2, 16));
}

#[test]
fn a_screenshot_listed_is_read_by_its_id() {
    let fx = Fixture::new("insight-shots");
    fx.write("s", &browsing());
    let shots = State::default().answer(&[ask("s", "s")], T0_MS, &fx.deps())["s"].web.shots.clone();
    let read: Vec<String> = shots.iter().map(|s| shot::read(&fx.path("s"), &s.id).unwrap()).collect();
    assert_eq!(read, ["QUJD", "REVG", "R0hJ", "TU5P"]);
    assert_eq!(shots.iter().map(|s| s.media_type.as_str()).collect::<Vec<_>>(), ["image/jpeg", "image/png", "image/webp", "image/png"]);
}

#[test]
fn a_transcript_written_anew_is_read_from_its_start() {
    let fx = Fixture::new("insight-anew");
    fx.write("s", &[prompt(1, "the first one"), says(2, "m1", "a long enough answer to be longer than what follows", usage(1, 2, 3, 4)), says(3, "m2", "b", usage(1, 2, 3, 4))]);
    let (mut state, deps) = (State::default(), fx.deps());
    assert_eq!(state.answer(&[ask("s", "s")], T0_MS, &deps)["s"].tokens.main.input, 2);
    fx.write("s", &[says(9, "m9", "anew", usage(7, 0, 0, 0))]);
    let i = state.answer(&[ask("s", "s")], T0_MS + 3_000, &deps)["s"].clone();
    assert_eq!((i.tokens.main.input, i.turns, i.last_prompt, i.started_at), (7, 0, None, Some(ms(9))));
}

#[test]
fn a_missing_transcript_is_looked_for_again_only_after_a_while() {
    let fx = Fixture::new("insight-miss");
    let (mut state, deps) = (State::default(), fx.deps());
    state.answer(&[ask("late", "late")], T0_MS, &deps);
    assert!(state.answer(&[ask("late", "late")], T0_MS + 3_000, &deps).is_empty());
    assert_eq!(fx.lookups.load(Ordering::SeqCst), 1);
    fx.write("late", &[prompt(1, "here now")]);
    assert!(state.answer(&[ask("late", "late")], T0_MS + MISS_EVERY_MS - 1, &deps).is_empty());
    assert!(state.answer(&[ask("late", "late")], T0_MS + MISS_EVERY_MS, &deps).contains_key("late"));
    assert_eq!(fx.lookups.load(Ordering::SeqCst), 2);
    // Gone again: it is looked for at once, and the answer has no session read from nothing.
    std::fs::remove_file(fx.path("late")).unwrap();
    assert!(state.answer(&[ask("late", "late")], T0_MS + MISS_EVERY_MS + 3_000, &deps).is_empty());
    assert_eq!(fx.lookups.load(Ordering::SeqCst), 3);
}

#[test]
fn what_no_ask_names_is_forgotten() {
    let fx = Fixture::new("insight-forget");
    fx.write("a", &[prompt(1, "go")]);
    fx.write("b", &[prompt(1, "go")]);
    let (mut state, deps) = (State::default(), fx.deps());
    state.answer(&[ask("a", "a"), ask("b", "b")], T0_MS, &deps);
    state.answer(&[ask("b", "b")], T0_MS + FORGET_MS - 1, &deps);
    assert_eq!((state.held.len(), state.found.len()), (2, 2));
    state.answer(&[ask("b", "b")], T0_MS + FORGET_MS, &deps);
    assert_eq!((state.held.len(), state.found.len()), (1, 1), "the one still asked about stays");
    assert!(state.held.contains_key(&fx.path("b")));
}

#[test]
fn an_ask_finds_its_transcript_on_any_claude_account_and_a_grok_session_has_none() {
    let user = crate::testutil::temp_dir("insight-accounts");
    let (side, grok) = (user.join(".claude-side"), user.join(".grok-side"));
    let sid = "0f8e3c1a-2815-4532-b1a2-9c82363c4949";
    let project = side.join("projects").join(crate::mission::project_dir_name("/r/app"));
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join(format!("{sid}.jsonl")), "{}\n").unwrap();
    let file = json!({ "accounts": [{ "id": "side", "configDir": side.to_string_lossy() }, { "id": "grok", "configDir": grok.to_string_lossy(), "kind": "grok" }] });
    let accounts = Accounts::parse(&file.to_string(), &user);
    let asked = |account: &str, session: &str| InsightAsk { key: "k".into(), session_id: session.into(), cwd: "/r/app".into(), account: account.into() };

    let found = Some(project.join(format!("{sid}.jsonl")));
    assert_eq!(transcript_of(&asked("side", sid), &accounts), found);
    assert_eq!(transcript_of(&asked("default", sid), &accounts), found, "whichever account the ask names, the transcript is where it is");
    assert_eq!(transcript_of(&asked("an account since removed", sid), &accounts), found);
    assert_eq!(transcript_of(&asked("grok", sid), &accounts), None);
    assert_eq!(transcript_of(&asked("side", "0f8e3c1a-0000-4000-8000-000000000000"), &accounts), None);
    // A session id is a file's name and nothing else.
    std::fs::write(side.join("projects").join("outside.jsonl"), "{}\n").unwrap();
    assert_eq!(transcript_of(&asked("side", "../outside"), &accounts), None);
    assert!(is_session_id(sid) && is_session_id("agent_1") && !is_session_id("") && !is_session_id("a/b") && !is_session_id("a\\b") && !is_session_id("a.b"));
    let _ = std::fs::remove_dir_all(user);
}

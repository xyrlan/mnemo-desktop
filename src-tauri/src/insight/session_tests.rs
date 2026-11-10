use super::*;
use crate::insight::fixture::*;
use serde_json::json;

fn row(input: u64, output: u64, cache_read: u64, cache_creation: u64) -> TokenRow {
    TokenRow { input, output, cache_read, cache_creation, thinking: output / 2 }
}

/// The session the lines make, and the byte each line starts at in the file they would be.
fn read_at(lines: &[Value]) -> (Session, Vec<u64>) {
    let (mut session, mut offsets, mut offset) = (Session::default(), Vec::new(), 0u64);
    for line in lines {
        let raw = line.to_string();
        session.line(offset, &raw);
        offsets.push(offset);
        offset += raw.len() as u64 + 1;
    }
    (session, offsets)
}

fn insight(lines: &[Value]) -> Insight {
    read_at(lines).0.insight(vec![])
}

// -------------------------------------------------------------------- tokens --

#[test]
fn the_test_clock_starts_where_its_stamps_do() {
    assert_eq!(stamp_ms(&at(0)), Some(T0_MS));
    assert_eq!(stamp_ms(&at(3_661)), Some(T0_MS + 3_661_000));
    assert_eq!(T0_MS % BUCKET_MS, 0);
}

#[test]
fn an_api_message_is_counted_once_as_its_last_record_says() {
    let mut haiku = says(3, "m2", "c", usage(4, 8, 200, 0));
    haiku["message"]["model"] = json!("claude-haiku-5");
    let mut synthetic = says(5, "m3", "No response requested.", usage(9, 9, 9, 9));
    synthetic["message"]["model"] = json!("<synthetic>");
    let lines = [
        says(1, "m1", "a", usage(3, 5, 100, 10)),
        // The same message again, further on: this is what it cost.
        says(2, "m1", "b", usage(3, 70, 100, 10)),
        haiku,
        with(tool(4, "s1", "t1", "Bash", json!({ "command": "ls" })), json!({ "isSidechain": true })),
        synthetic,
    ];
    let (session, _) = read_at(&lines);
    let sub = SubagentTokens { id: "a1".into(), tokens: TokenRow { input: 10, output: 10, cache_read: 10, cache_creation: 10, thinking: 10 }, ..SubagentTokens::default() };
    let i = session.insight(vec![sub.clone()]);
    assert_eq!(i.tokens.main, TokenRow { input: 7, output: 78, cache_read: 300, cache_creation: 10, thinking: 39 });
    assert_eq!(i.tokens.sidechain, row(1, 10, 100, 5));
    assert_eq!(i.tokens.by_model, HashMap::from([("claude-opus-5".to_string(), TokenRow { input: 4, output: 80, cache_read: 200, cache_creation: 15, thinking: 40 }), ("claude-haiku-5".to_string(), row(4, 8, 200, 0))]));
    assert_eq!(i.tokens.subagents, [sub]);
    assert_eq!(i.tokens.own, TokenRow { input: 18, output: 98, cache_read: 410, cache_creation: 25, thinking: 54 }, "main + side chain + every sub-agent");
    assert_eq!(session.messages(), (2, 1));
    assert!(session.counted(message_key("m1")) && !session.counted(message_key("m3")));
    assert!(i.activity.is_empty(), "a side chain's calls are not the session's");
    assert_eq!(i.model.as_deref(), Some("claude-haiku-5"), "the last real model of the main chain");
}

#[test]
fn a_message_without_an_id_is_counted_by_its_line() {
    let mut a = says(1, "x", "a", usage(1, 2, 0, 0));
    a["message"].as_object_mut().unwrap().remove("id");
    let mut b = a.clone();
    b["uuid"] = json!("another-line");
    let mut bare = b.clone();
    bare.as_object_mut().unwrap().remove("uuid");
    assert_eq!(insight(&[a.clone(), a.clone(), b, bare.clone(), bare]).tokens.main, row(4, 8, 0, 0));
}

// ------------------------------------------------------------------- context --

#[test]
fn the_context_is_the_last_main_call_whole_against_its_window() {
    let lines = [
        says(1, "m1", "a", usage(900, 100, 50_000, 0)),
        says(2, "m2", "b", usage(1_000, 500, 150_000, 8_500)),
        // A side chain's call is not the session's context.
        with(says(3, "s1", "c", usage(1, 1, 1, 1)), json!({ "isSidechain": true })),
    ];
    let c = insight(&lines).context;
    assert_eq!((c.tokens, c.window, c.percent), (Some(160_000), 200_000, Some(80.0)));
    assert_eq!(c.series, [(ms(1), 51_000), (ms(2), 160_000)]);
    let empty = insight(&[prompt(1, "hello")]).context;
    assert_eq!((empty.tokens, empty.window, empty.percent, empty.series.len()), (None, 200_000, None, 0));
    assert_eq!(insight(&[says(1, "m1", "a", usage(0, 1, 333, 0))]).context.percent, Some(0.2), "one decimal");
}

#[test]
fn the_window_is_a_million_when_the_session_asked_for_it_or_ever_passed_200k() {
    let call = |s: u64, id: &str, read: u64| says(s, id, "a", usage(0, 0, read, 0));
    let window = |lines: &[Value]| insight(lines).context.window;
    assert_eq!(window(&[call(1, "m1", 200_000)]), 200_000, "at the brim is not past it");

    // Asked for by the model's name.
    let asked = with(call(1, "m1", 9_000), json!({ "requestedModel": "claude-opus-5[1m]" }));
    assert_eq!(window(&[asked.clone()]), 1_000_000);
    assert_eq!(insight(&[asked.clone()]).context.percent, Some(0.9));
    let plain = with(call(2, "m2", 9_000), json!({ "requestedModel": "claude-opus-5" }));
    assert_eq!(window(&[asked.clone(), plain.clone()]), 200_000, "the last request says which");
    assert_eq!(window(&[asked, call(2, "m2", 9_000)]), 1_000_000, "a line that does not say changes nothing");

    // Asked for by a beta of the main thread's request.
    let request = |source: &str, betas: Value| json!({ "type": "api-request", "timestamp": at(1), "querySource": source, "params": { "model": "claude-opus-5", "betas": betas } });
    let beta = json!(["oauth-2025-04-20", "context-1m-2025-08-07"]);
    assert_eq!(window(&[request("repl_main_thread", beta.clone()), call(2, "m1", 9_000)]), 1_000_000);
    assert_eq!(window(&[request("sdk", beta.clone()), call(2, "m1", 9_000)]), 1_000_000);
    assert_eq!(window(&[request("compact", beta.clone()), call(2, "m1", 9_000)]), 200_000, "another thread's request is not the session's");
    assert_eq!(window(&[request("repl_main_thread", beta), request("repl_main_thread", json!(["oauth-2025-04-20"])), call(2, "m1", 9_000)]), 200_000);

    // Past 200k once: it was a million all along.
    assert_eq!(window(&[call(1, "m1", 200_001), plain]), 1_000_000);
    let compacted = json!({ "type": "system", "subtype": "compact_boundary", "timestamp": at(2), "compactMetadata": { "trigger": "auto", "preTokens": 249_539, "postTokens": 21_261 } });
    assert_eq!(window(&[compacted]), 1_000_000);
}

#[test]
fn a_compaction_is_listed_and_is_the_context_until_the_next_call() {
    let boundary = json!({ "type": "system", "subtype": "compact_boundary", "content": "Conversation compacted", "timestamp": at(2), "compactMetadata": { "trigger": "auto", "preTokens": 180_400, "postTokens": 21_261, "durationMs": 72_689 } });
    let before = says(1, "m1", "a", usage(0, 400, 180_000, 0));
    let c = insight(&[before.clone(), boundary.clone()]).context;
    assert_eq!(c.compactions, [Compaction { at: ms(2), pre: 180_400, post: 21_261, trigger: Some("auto".into()) }]);
    assert_eq!((c.tokens, c.percent), (Some(21_261), Some(10.6)));
    assert_eq!(c.series, [(ms(1), 180_400), (ms(2), 21_261)]);

    let c = insight(&[before, boundary, says(3, "m2", "b", usage(0, 0, 30_000, 0))]).context;
    assert_eq!(c.tokens, Some(30_000));
    assert_eq!(c.series.len(), 3);

    // A boundary that states no size leaves the context as the last call said.
    let bare = json!({ "type": "system", "subtype": "compact_boundary", "timestamp": at(2), "compactMetadata": { "trigger": "manual" } });
    let c = insight(&[says(1, "m1", "a", usage(0, 0, 5_000, 0)), bare]).context;
    assert_eq!((c.tokens, c.series.len(), c.compactions[0].trigger.as_deref()), (Some(5_000), 1, Some("manual")));
}

#[test]
fn the_curve_has_one_point_per_call_and_is_thinned_as_it_grows() {
    // A call's later record moves its point; it does not add one.
    let lines = [says(1, "m1", "a", usage(0, 5, 1_000, 0)), says(2, "m1", "b", usage(0, 70, 1_000, 0)), says(3, "m2", "c", usage(0, 1, 2_000, 0))];
    assert_eq!(insight(&lines).context.series, [(ms(1), 1_070), (ms(3), 2_001)]);

    let mut curve = Curve::default();
    for n in 0..10_000u64 {
        curve.push(n, n * 10);
        let points = curve.points();
        assert!(points.len() <= 2 * SERIES_CAP, "{} points after {n} calls", points.len());
        assert_eq!(points.last(), Some(&(n, n * 10)), "the newest call is always there");
        assert_eq!(points.first(), Some(&(0, 0)));
    }
    let points = curve.points();
    assert!(points.len() >= SERIES_CAP, "{}", points.len());
    assert!(points.windows(2).all(|w| w[0].0 < w[1].0), "oldest first, none twice");
    // Evenly thinned: no gap between kept calls is wider than the stride it reached.
    let widest = points.windows(2).map(|w| w[1].0 - w[0].0).max().unwrap();
    assert!(widest <= 10_000 / SERIES_CAP as u64, "{widest}");

    curve.amend(7);
    assert_eq!(curve.points().last(), Some(&(9_999, 7)));
    assert_eq!(curve.points().iter().filter(|p| p.0 == 9_999).count(), 1);
}

// ------------------------------------------------------------------ activity --

#[test]
fn a_tool_call_runs_until_its_result_says_how_it_went() {
    let call = tool(10, "m1", "t1", "Bash", json!({ "command": "pnpm   test\n --run", "description": "run the suite" }));
    let running = ToolCall { at: ms(10), tool: "Bash".into(), kind: "shell".into(), target: "pnpm test --run".into(), running: true, ok: None, ms: None };
    assert_eq!(insight(&[call.clone()]).activity, [running.clone()]);
    assert_eq!(insight(&[call.clone(), result(70, "t1", json!("ok"))]).activity, [ToolCall { running: false, ok: Some(true), ms: Some(60_000), ..running.clone() }]);

    let mut failed = result(12, "t1", json!("exit 1"));
    failed["message"]["content"][0]["is_error"] = json!(true);
    assert_eq!(insight(&[call.clone(), failed]).activity, [ToolCall { running: false, ok: Some(false), ms: Some(2_000), ..running.clone() }]);
    assert_eq!(insight(&[call, result(12, "another", json!("ok"))]).activity, [running], "another call's result is not this one's");
}

#[test]
fn the_newest_calls_are_kept_and_every_call_counted() {
    let n = ACTIVITY_CAP as u64 + 50;
    let call = |i: u64| if i % 2 == 0 { ("Read", json!({ "file_path": format!("/r/{i}.rs") })) } else { ("Bash", json!({ "command": format!("run {i}") })) };
    let mut lines: Vec<Value> = (0..n).map(|i| tool(i, &format!("m{i}"), &format!("t{i}"), call(i).0, call(i).1)).collect();
    // One result for a call no longer shown, one for a call that is.
    lines.push(result(n, "t10", json!("ok")));
    lines.push(result(n + 1, "t60", json!("ok")));
    let i = insight(&lines);
    assert_eq!((i.activity.len(), i.activity_total), (ACTIVITY_CAP, n));
    assert_eq!((i.activity[0].target.as_str(), i.activity[0].at), ("/r/50.rs", ms(50)), "oldest first");
    assert_eq!(i.activity.last().unwrap().target, format!("run {}", n - 1));
    let answered: Vec<usize> = i.activity.iter().enumerate().filter(|(_, c)| !c.running).map(|(at, _)| at).collect();
    assert_eq!(answered, [10], "the 60th call is the 10th shown");
    assert_eq!((i.activity[10].ok, i.activity[10].ms), (Some(true), Some((n + 1 - 60) * 1000)));
    assert_eq!(i.activity_counts, HashMap::from([("read".to_string(), n / 2), ("shell".to_string(), n / 2)]));
    // 450 calls a second apart: five minutes' worth, then the rest.
    let half = |n: u64| HashMap::from([("read".to_string(), n), ("shell".to_string(), n)]);
    assert_eq!(i.timeline, [Bucket { t: T0_MS, kinds: half(150) }, Bucket { t: T0_MS + BUCKET_MS, kinds: half(75) }]);
}

#[test]
fn the_timeline_keeps_the_newest_buckets() {
    let lines: Vec<Value> = (0..BUCKETS_CAP as u64 + 3).map(|i| tool(i * 300, &format!("m{i}"), &format!("t{i}"), "Read", json!({ "file_path": "/a" }))).collect();
    let timeline = insight(&lines).timeline;
    assert_eq!(timeline.len(), BUCKETS_CAP);
    assert_eq!((timeline[0].t, timeline.last().unwrap().t), (T0_MS + 3 * BUCKET_MS, T0_MS + (BUCKETS_CAP as u64 + 2) * BUCKET_MS));
}

#[test]
fn a_typed_prompt_is_a_turn_and_ends_what_was_waiting() {
    let question = json!({ "questions": [{ "question": "Which   layout?", "header": "x", "options": [{ "label": "attention", "description": "what waits\nfirst" }, { "label": "station" }] }, { "question": "Second?" }] });
    let lines = [
        prompt(1, "build the reader"),
        tool(2, "m1", "t1", "Bash", json!({ "command": "sleep 99" })),
        tool(3, "m1", "q1", "AskUserQuestion", question),
        json!({ "type": "system", "subtype": "turn_duration", "timestamp": at(4), "durationMs": 1_500 }),
    ];
    let i = insight(&lines);
    assert_eq!((i.turns, i.turn_ms, i.last_prompt.as_deref()), (1, 1_500, Some("build the reader")));
    let options = vec![AskOption { label: "attention".into(), description: "what waits first".into() }, AskOption { label: "station".into(), description: String::new() }];
    // every question of the call, the first included: the dialog asks them in this order
    let questions = vec![
        AskQuestion { header: "x".into(), question: "Which layout?".into(), options: options.clone(), multi: false },
        AskQuestion { header: String::new(), question: "Second?".into(), options: vec![], multi: false },
    ];
    assert_eq!(i.pending_ask, Some(PendingAsk { id: "q1".into(), at: ms(3), question: "Which layout?".into(), options, questions }));
    assert_eq!(i.activity[1].target, "Which layout?");
    assert!(i.activity.iter().all(|c| c.running));

    // What is not typed is no turn: a finished child's notice, a slash command, a tool result.
    let mut more = lines.to_vec();
    more.push(with(prompt(5, "<task-notification>done</task-notification>"), json!({ "origin": { "kind": "task-notification" } })));
    more.push(prompt(6, "<command-name>/clear</command-name>"));
    more.push(result(7, "nothing", json!("x")));
    let i = insight(&more);
    assert_eq!((i.turns, i.pending_ask.is_some(), i.activity[0].running), (1, true, true));

    more.push(prompt(9, "stop   that\nnow"));
    more.push(json!({ "type": "system", "subtype": "turn_duration", "timestamp": at(10), "durationMs": 2_500 }));
    // A result that comes after all still says how the call went.
    more.push(result(12, "t1", json!("killed")));
    let i = insight(&more);
    assert_eq!((i.turns, i.turn_ms, i.last_prompt.as_deref()), (2, 4_000, Some("stop that now")));
    assert_eq!(i.pending_ask, None);
    assert_eq!(i.activity.iter().map(|c| (c.running, c.ok)).collect::<Vec<_>>(), [(false, Some(true)), (false, None)]);
}

#[test]
fn a_question_is_pending_until_it_is_answered() {
    let q = tool(5, "m1", "q1", "AskUserQuestion", json!({ "questions": [{ "question": "Q?", "options": [{ "label": "a" }] }] }));
    let later = tool(6, "m2", "t2", "Read", json!({ "file_path": "/a" }));
    assert_eq!(insight(&[q.clone(), later.clone(), result(7, "t2", json!("x"))]).pending_ask.map(|p| p.question), Some("Q?".into()), "it outlives later calls");
    assert_eq!(insight(&[q, later, result(8, "q1", json!("a"))]).pending_ask, None);
}

#[test]
fn the_last_prompt_stays_as_typed_when_claude_code_s_record_is_its_start() {
    let long = "word ".repeat(200);
    let typed = short(&long, PROMPT_CHARS);
    assert_eq!(typed.chars().count(), PROMPT_CHARS);
    let record = |p: &str| json!({ "type": "last-prompt", "lastPrompt": p, "sessionId": "s" });
    let cut: String = long.chars().take(200).collect();
    assert_eq!(insight(&[prompt(1, &long), record(&cut)]).last_prompt, Some(typed.clone()));
    assert_eq!(insight(&[prompt(1, &long), record(&format!("{}…", cut.trim_end()))]).last_prompt, Some(typed));
    assert_eq!(insight(&[prompt(1, &long), record("another   thing")]).last_prompt.as_deref(), Some("another thing"));
    assert_eq!(insight(&[record("only the record")]).last_prompt.as_deref(), Some("only the record"));
    assert_eq!(insight(&[prompt(1, "typed"), json!({ "type": "last-prompt", "leafUuid": "x" })]).last_prompt.as_deref(), Some("typed"));
}

// ----------------------------------------------------------------------- web --

#[test]
fn what_a_session_searched_fetched_and_published_is_listed() {
    let found = json!({ "query": "serde raw value", "durationSeconds": 6.6, "results": [
        { "tool_use_id": "srv1", "content": [{ "title": "Raw   Value\nin serde", "url": "https://docs.example/raw" }, { "title": "no address" }] },
        "A summary in words.",
        { "tool_use_id": "srv2", "content": [{ "title": "Second", "url": "https://docs.example/second" }] },
    ] });
    let fetched = json!({ "bytes": 70_157, "code": 200, "codeText": "OK", "result": "| Plan | Price |\n|---|---|\n| Solo | 9 |", "durationMs": 9_096, "url": "https://x.example/pricing" });
    let lines = [
        tool(1, "m1", "w1", "WebSearch", json!({ "query": "serde raw value" })),
        with(result(3, "w1", json!("Web search results for query…")), json!({ "toolUseResult": found })),
        tool(4, "m2", "f1", "WebFetch", json!({ "url": "https://x.example/pricing", "prompt": "the prices" })),
        with(result(5, "f1", json!("| Plan |")), json!({ "toolUseResult": fetched })),
        // A fetch that failed answers in words, not in a record.
        tool(6, "m3", "f2", "WebFetch", json!({ "url": "https://x.example/gone" })),
        with(result(7, "f2", json!("Request failed with status code 404")), json!({ "toolUseResult": "Error: Request failed with status code 404" })),
    ];
    let web = insight(&lines).web;
    let hit = |title: &str, url: &str| SearchHit { title: title.into(), url: url.into() };
    assert_eq!(web.searches, [Search { at: ms(1), query: "serde raw value".into(), results: vec![hit("Raw Value in serde", "https://docs.example/raw"), hit("Second", "https://docs.example/second")] }]);
    let many: Vec<Value> = (0..12).map(|n| json!({ "title": format!("hit {n}"), "url": format!("https://docs.example/{n}") })).collect();
    let crowded = [tool(1, "m1", "w1", "WebSearch", json!({ "query": "q" })), with(result(2, "w1", json!("…")), json!({ "toolUseResult": { "results": [{ "content": many }] } }))];
    let search = insight(&crowded).web.searches.remove(0);
    assert_eq!((search.query.as_str(), search.results.len(), search.results[9].title.as_str()), ("q", 10, "hit 9"), "the first ten hits, under the query the call made");
    assert_eq!(web.fetches, [Fetch { at: ms(4), url: "https://x.example/pricing".into(), code: Some(200), bytes: Some(70_157), ms: Some(9_096), summary: "| Plan | Price | |---|---| | Solo | 9 |".into() }]);

    let published = |title: &str| json!({ "url": "https://claude.ai/artifact/abc123", "path": "/tmp/roles.html", "title": title, "updated": false });
    let lines = [
        // A quickstart names the types an artifact can be made from: nothing was published.
        tool(1, "m1", "a0", "Artifact", json!({ "action": "quickstart", "intent": "document" })),
        with(result(2, "a0", json!("Quickstart…")), json!({ "toolUseResult": { "quickstart": { "match": { "title": "Docs", "type_url": "https://claude.ai/artifact/TYPE" } } } })),
        tool(3, "m2", "a1", "Artifact", json!({ "file_path": "/tmp/roles.html", "icon": "people" })),
        with(result(4, "a1", json!("Published https://claude.ai/artifact/abc123")), json!({ "toolUseResult": published("Roles") })),
        // An address that is no artifact's is not one.
        tool(4, "m9", "a9", "Artifact", json!({ "action": "open", "url": "https://claude.ai/chat/xyz" })),
        with(result(4, "a9", json!("Opened")), json!({ "toolUseResult": { "url": "https://claude.ai/chat/xyz", "title": "A chat" } })),
        tool(5, "m3", "a2", "Artifact", json!({ "file_path": "/tmp/roles.html" })),
        with(result(6, "a2", json!("Updated")), json!({ "toolUseResult": published("Roles, second draft") })),
    ];
    assert_eq!(insight(&lines).web.artifacts, [Artifact { at: ms(3), url: "https://claude.ai/artifact/abc123".into(), title: "Roles, second draft".into() }]);
}

#[test]
fn a_browser_s_results_give_its_pages_and_list_its_screenshots_without_the_pictures() {
    let lines = browsing();
    let (session, offsets) = read_at(&lines);
    let i = session.insight(vec![]);
    let page = |s: u64, url: &str, title: &str| Page { at: ms(s), url: url.into(), title: title.into() };
    assert_eq!(i.web.pages, [page(1, "https://shop.example/", "Shop"), page(5, "https://shop.example/cart", "Cart (2)")], "a page is listed once while the session stays on it; a browser's own page is none");
    let shot = |line: usize, part: usize, s: u64, url: &str, title: &str, media: &str| Shot { id: shot::id(offsets[line], 0, part), at: ms(s), url: Some(url.into()), title: Some(title.into()), media_type: media.into() };
    assert_eq!(
        i.web.shots,
        [
            shot(3, 2, 3, "https://shop.example/", "Shop", "image/jpeg"),
            shot(5, 0, 5, "https://shop.example/cart", "Cart (2)", "image/png"),
            shot(5, 2, 5, "https://shop.example/cart", "Cart (2)", "image/webp"),
            shot(9, 1, 9, "chrome://newtab/", "New Tab", "image/png"),
        ]
    );
    let sent = serde_json::to_string(&i).unwrap();
    for data in ["QUJD", "REVG", "R0hJ", "SkpL", "TU5P"] {
        assert!(!sent.contains(data), "{data} is a picture: it stays in the transcript");
    }
    assert_eq!(i.activity_counts, HashMap::from([("browser".to_string(), 4), ("read".to_string(), 1)]));
}

#[test]
fn a_list_keeps_its_newest() {
    let lines: Vec<Value> = (0..LIST_CAP as u64 + 5)
        .flat_map(|i| {
            [
                tool(2 * i, &format!("m{i}"), &format!("b{i}"), "mcp__claude-in-chrome__computer", json!({ "action": "screenshot" })),
                result(2 * i + 1, &format!("b{i}"), json!([tab(&format!("Page {i}"), &format!("https://x.example/{i}")), picture("image/png", "QUJD")])),
            ]
        })
        .collect();
    let web = insight(&lines).web;
    assert_eq!((web.shots.len(), web.pages.len()), (LIST_CAP, LIST_CAP + 5));
    assert_eq!((web.shots[0].title.as_deref(), web.shots.last().unwrap().title.as_deref()), (Some("Page 5"), Some(format!("Page {}", LIST_CAP + 4).as_str())));
}

// --------------------------------------------------------------------- files --

#[test]
fn files_are_counted_under_the_path_the_transcript_wrote() {
    let edit = |s: u64, name: &str, input: Value| tool(s, &format!("m{s}"), &format!("t{s}"), name, input);
    let lines = [
        edit(1, "Edit", json!({ "file_path": "/Users/you/app/src/a.rs", "old_string": "a", "new_string": "b" })),
        edit(2, "Edit", json!({ "file_path": "/Users/you/app/src/a.rs" })),
        edit(3, "NotebookEdit", json!({ "notebook_path": "/n.ipynb", "new_source": "x" })),
        edit(4, "Write", json!({ "file_path": "C:\\Users\\you\\app\\b.ts", "content": "x" })),
        edit(5, "Edit", json!({ "file_path": "/Users/you/app/src/a.rs" })),
        edit(6, "Read", json!({ "file_path": "/Users/you/app/src/a.rs" })),
        edit(7, "Read", json!({ "file_path": "/Users/you/app/c.md" })),
        edit(8, "Read", json!({ "file_path": "/Users/you/app/src/a.rs", "offset": 100 })),
        edit(9, "Grep", json!({ "pattern": "fn", "path": "/Users/you/app" })),
    ];
    let i = insight(&lines);
    let edited = |path: &str, edits: u64, s: u64| EditedFile { path: path.into(), edits, last_at: ms(s) };
    assert_eq!(i.files.edited, [edited("/Users/you/app/src/a.rs", 3, 5), edited("C:\\Users\\you\\app\\b.ts", 1, 4), edited("/n.ipynb", 1, 3)], "most edited first, then the latest");
    assert_eq!(i.files.read, [ReadFile { path: "/Users/you/app/src/a.rs".into(), count: 2 }, ReadFile { path: "/Users/you/app/c.md".into(), count: 1 }]);
    assert_eq!(i.activity[3].target, "C:\\Users\\you\\app\\b.ts", "a home is not shortened: that is the front's business");

    let many: Vec<Value> = (0..FILES_CAP as u64 + 10).map(|n| edit(n, "Read", json!({ "file_path": format!("/r/{n:03}.rs") }))).collect();
    let read = insight(&many).files.read;
    assert_eq!((read.len(), read[0].path.as_str()), (FILES_CAP, "/r/000.rs"));
}

// -------------------------------------------------------------------- memory --

#[test]
fn claude_code_s_own_memory_is_what_it_loaded_and_what_it_touched_later() {
    let memory = "/Users/you/.claude/projects/-Users-you-app/memory";
    let loaded = |s: u64, claude_md: &str| {
        attached(s, json!({ "type": "instructions", "files": [{ "path": "/Users/you/app/CLAUDE.md", "type": "Project", "content": claude_md }, { "path": format!("{memory}/MEMORY.md"), "type": "AutoMem", "content": "- [a](a.md)" }] }))
    };
    let call = |s: u64, name: &str, input: Value| tool(s, &format!("m{s}"), &format!("t{s}"), name, input);
    let lines = [
        loaded(0, "# Olá"),
        call(10, "Read", json!({ "file_path": format!("{memory}/a.md") })),
        call(11, "Write", json!({ "file_path": format!("{memory}/b.md"), "content": "x" })),
        call(12, "Edit", json!({ "file_path": "/Users/you/app/CLAUDE.md" })),
        // Neither a search of the folder nor a file of the project is a touch of memory.
        call(13, "Grep", json!({ "pattern": "x", "path": format!("{memory}/a.md") })),
        call(14, "Read", json!({ "file_path": "/Users/you/app/src/a.rs" })),
        attached(20, json!({ "type": "edited_text_file", "filename": format!("{memory}/a.md"), "snippet": "" })),
        attached(21, json!({ "type": "file", "filename": "/Users/you/app/notes.txt", "content": { "type": "text", "file": { "content": "lorem" } } })),
        attached(22, json!({ "type": "compact_file_reference", "filename": "C:\\Users\\you\\app\\CLAUDE.local.md" })),
        call(30, "Skill", json!({ "skill": "dataviz" })),
        // After a compaction, the skills invoked before it are named again.
        attached(40, json!({ "type": "invoked_skills", "skills": [{ "name": "dataviz", "path": "x", "content": "…" }, { "name": "mnemo-loop", "content": "…" }] })),
        loaded(50, "# Olá, de novo"),
    ];
    let m = insight(&lines).memory;
    assert_eq!(
        m.instructions,
        [
            Instruction { path: "/Users/you/app/CLAUDE.md".into(), kind: "Project".into(), at: ms(50), bytes: 15 },
            Instruction { path: format!("{memory}/MEMORY.md"), kind: "AutoMem".into(), at: ms(50), bytes: 11 },
        ],
        "a file loaded again is the same file, as it was last loaded; its size is in bytes"
    );
    let touch = |s: u64, path: String, file: &str, op: &str, via: &str| MemoryTouch { at: ms(s), path, file: file.into(), op: op.into(), via: via.into() };
    assert_eq!(
        m.touches,
        [
            touch(10, format!("{memory}/a.md"), "claude-memory", "read", "tool"),
            touch(11, format!("{memory}/b.md"), "claude-memory", "write", "tool"),
            touch(12, "/Users/you/app/CLAUDE.md".into(), "claude-md", "edit", "tool"),
            touch(20, format!("{memory}/a.md"), "claude-memory", "read", "edited_text_file"),
            touch(22, "C:\\Users\\you\\app\\CLAUDE.local.md".into(), "claude-md", "read", "compact_file_reference"),
        ]
    );
    assert_eq!(m.skills, [SkillUse { at: ms(30), name: "dataviz".into() }, SkillUse { at: ms(40), name: "mnemo-loop".into() }]);
}

// ------------------------------------------------------------------ identity --

#[test]
fn a_session_says_who_and_what_it_is() {
    let title = |kind: &str, key: &str, t: &str| json!({ "type": kind, key: t, "sessionId": "s" });
    let pr = |n: u64| json!({ "type": "pr-link", "prNumber": n, "prUrl": format!("https://github.com/o/r/pull/{n}"), "prRepository": "o/r", "timestamp": at(6) });
    let cost = |usd: f64| json!({ "type": "cost-state", "totalCostUSD": usd, "totalAPIDuration": 448_769, "totalToolDuration": 474_379.4, "totalLinesAdded": 12, "totalLinesRemoved": 3, "modelUsage": {} });
    let lines = [
        title("ai-title", "aiTitle", "First"),
        json!({ "type": "permission-mode", "permissionMode": "plan", "sessionId": "s" }),
        json!({ "type": "session-owner", "accountUuid": "acc-1", "organizationUuid": "org-1" }),
        with(prompt(2, "go"), json!({ "gitBranch": "main" })),
        says(3, "m1", "  line one\n\nline two  ", usage(1, 1, 1, 1)),
        with(says(4, "m2", "   ", usage(1, 1, 1, 1)), json!({ "gitBranch": "feat/reader", "effort": "max" })),
        json!({ "type": "system", "subtype": "away_summary", "content": "We   are\nhalfway.", "timestamp": at(5), "gitBranch": "" }),
        pr(545),
        pr(546),
        pr(545),
        cost(1.5),
        cost(3.25),
        title("ai-title", "aiTitle", "Second   title\nof it"),
        title("ai-title", "aiTitle", "  "),
        // A line written out of order does not move the start, nor the end back.
        with(prompt(1, "<system-reminder>x</system-reminder>"), json!({ "permissionMode": "acceptEdits" })),
    ];
    let i = insight(&lines);
    assert_eq!(i.title.as_deref(), Some("Second title of it"));
    assert_eq!((i.permission_mode.as_deref(), i.account_uuid.as_deref(), i.branch.as_deref()), (Some("acceptEdits"), Some("acc-1"), Some("feat/reader")));
    assert_eq!((i.model.as_deref(), i.effort.as_deref()), (Some("claude-opus-5"), Some("max")));
    assert_eq!((i.started_at, i.last_at), (Some(ms(2)), Some(ms(6))));
    assert_eq!(i.said, Some(Words { at: ms(3), text: "line one\n\nline two".into() }), "what it said keeps its lines; blank words say nothing");
    assert_eq!(i.recap, Some(Words { at: ms(5), text: "We are halfway.".into() }));
    assert_eq!(i.prs, [PrLink { number: 545, url: "https://github.com/o/r/pull/545".into(), repo: "o/r".into() }, PrLink { number: 546, url: "https://github.com/o/r/pull/546".into(), repo: "o/r".into() }]);
    assert_eq!(i.cost, Some(Cost { usd: 3.25, api_ms: 448_769, tool_ms: 474_379, lines_added: 12, lines_removed: 3 }));

    let mut named = lines.to_vec();
    // A cost is the double its digits are nearest to, to the last one.
    let exact = |digits: &str| {
        let mut session = Session::default();
        session.line(0, &format!(r#"{{"type":"cost-state","totalCostUSD":{digits}}}"#));
        session.insight(vec![]).cost.map(|c| c.usd)
    };
    assert_eq!(exact("0.0037551000000000004"), Some(0.0037551000000000004));
    assert_eq!(exact("0.21359999999999998"), Some(0.21359999999999998));
    assert_eq!(exact("\"1.5\""), None);
    named.insert(0, title("custom-title", "customTitle", "the reader"));
    assert_eq!(insight(&named).title.as_deref(), Some("the reader"), "the name a person gave it wins");
    // Words written as one string, not as blocks, are said all the same, and cut where they run long.
    assert_eq!(insight(&[assistant(1, "m1", json!("x".repeat(SAID_CHARS + 50)), usage(1, 1, 1, 1))]).said.unwrap().text.chars().count(), SAID_CHARS);
    assert_eq!(insight(&[]), Insight { context: Context { window: 200_000, ..Context::default() }, ..Insight::default() });
}

#[test]
fn what_is_not_the_session_s_own_line_changes_nothing() {
    let side = |line: Value| with(line, json!({ "isSidechain": true }));
    let lines = [
        Value::String("not an object".into()),
        json!({ "type": "file-history-snapshot", "snapshot": {} }),
        json!({ "type": "user" }),
        json!({ "type": "assistant", "timestamp": at(1) }),
        json!({ "timestamp": at(1), "message": { "content": "typeless" } }),
        side(prompt(1, "a sub-agent's prompt")),
        side(attached(1, json!({ "type": "instructions", "files": [{ "path": "/CLAUDE.md", "type": "Project", "content": "x" }] }))),
        side(json!({ "type": "system", "subtype": "turn_duration", "timestamp": at(1), "durationMs": 9 })),
    ];
    let mut session = Session::default();
    session.line(0, "{not json");
    for l in &lines {
        session.line(0, &l.to_string());
    }
    let i = session.insight(vec![]);
    assert_eq!(Insight { started_at: None, last_at: None, ..i }, Insight { context: Context { window: 200_000, ..Context::default() }, ..Insight::default() });

    // A record the insight reads nothing from is stepped over, whatever it holds.
    let mut session = Session::default();
    session.line(0, r#"{"type":"api-request-blob","hash":"x","timestamp":"2026-10-15T12:00:00.000Z","message":{"role":"user","content":[]}}"#);
    assert_eq!(session.insight(vec![]).started_at, None);
}

#[test]
fn starting_over_forgets_what_was_read() {
    let (mut session, _) = read_at(&browsing());
    session.restart();
    assert_eq!(session.insight(vec![]), insight(&[]));
}

#[test]
fn a_question_that_takes_several_answers_says_so() {
    let question = json!({ "questions": [
        { "question": "Which checks?", "header": "Checks", "multiSelect": true, "options": [{ "label": "lint" }, { "label": "types" }] },
        { "header": "no question text" },
        { "question": "Ship it?", "header": "Ship", "options": ["yes", "no"] },
    ] });
    let i = insight(&[prompt(1, "go"), tool(2, "m1", "q9", "AskUserQuestion", question)]);
    let ask = i.pending_ask.expect("the call is unanswered");
    assert_eq!(ask.questions.iter().map(|q| (q.header.as_str(), q.question.as_str(), q.multi, q.options.len())).collect::<Vec<_>>(), vec![("Checks", "Which checks?", true, 2), ("Ship", "Ship it?", false, 2)]);
    assert_eq!((ask.question.as_str(), ask.options.len()), ("Which checks?", 2));
}

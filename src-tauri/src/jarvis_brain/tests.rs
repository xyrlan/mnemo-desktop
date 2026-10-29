use super::*;
use crate::agent_kind::AgentKind;
use serde_json::json;

#[test]
fn the_config_serializes_as_the_client_types_it() {
    assert_eq!(serde_json::to_value(BrainConfig::Local).unwrap(), json!({ "kind": "local" }));
    let claude = BrainConfig::Claude { model: "haiku".into(), effort: "medium".into() };
    assert_eq!(serde_json::to_value(claude).unwrap(), json!({ "kind": "claude", "model": "haiku", "effort": "medium" }));
    // The type `src/jarvis/client.ts` declares, so a change on either side fails here.
    let client = include_str!("../../../src/jarvis/client.ts");
    assert!(client.contains("export type BrainConfig = { kind: 'local' } | { kind: 'claude'; model: string; effort: string }"));
}

#[test]
fn no_section_is_local_and_claude_defaults_to_sonnet_at_low_effort() {
    assert_eq!(parse(&json!(null)), Ok(BrainConfig::Local));
    assert_eq!(parse(&json!({ "kind": "local" })), Ok(BrainConfig::Local));
    assert_eq!(parse(&json!({ "kind": "local", "model": "opus" })), Ok(BrainConfig::Local), "a model kept for later is no mistake");
    assert_eq!(parse(&json!({ "kind": "claude" })), Ok(BrainConfig::Claude { model: "sonnet".into(), effort: "low".into() }));
    let given = json!({ "kind": "claude", "model": "claude-haiku-5-5", "effort": "high" });
    assert_eq!(parse(&given), Ok(BrainConfig::Claude { model: "claude-haiku-5-5".into(), effort: "high".into() }), "taken as given");
}

#[test]
fn anything_else_is_an_error_naming_the_config() {
    for (section, says) in [
        (json!("claude"), "brain must be an object"),
        (json!({}), "brain names no kind"),
        (json!({ "kind": "gpt" }), "brain.kind is \"local\" or \"claude\", not \"gpt\""),
        (json!({ "kind": 1 }), "brain.kind"),
        (json!({ "kind": "claude", "model": "" }), "brain.model must be a name"),
        (json!({ "kind": "claude", "effort": 3 }), "brain.effort must be a name"),
        (json!({ "kind": "claude", "modle": "opus" }), "brain.modle is not a setting"),
    ] {
        let err = parse(&section).unwrap_err();
        assert!(err.starts_with("jarvis.json: ") && err.contains(says), "{section}: {err}");
    }
}

#[test]
fn claude_runs_with_nothing_but_words_in_stream_json_both_ways() {
    let args: Vec<String> = args("sonnet", "low", Path::new("/b/system.md")).iter().map(|a| a.to_string_lossy().to_string()).collect();
    assert_eq!(
        args,
        [
            "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", "sonnet", "--effort", "low", "--tools", "",
            "--strict-mcp-config", "--safe-mode", "--no-session-persistence", "--system-prompt-file", "/b/system.md"
        ]
    );
}

fn envs(cmd: &Command) -> Vec<(String, Option<String>)> {
    let mut v: Vec<_> = cmd.get_envs().map(|(k, v)| (k.to_string_lossy().to_string(), v.map(|v| v.to_string_lossy().to_string()))).collect();
    v.sort();
    v
}

#[test]
fn claude_runs_on_the_account_with_no_api_key() {
    let s = |v: &str| Some(v.to_string());
    let mut work = crate::proc::command("claude");
    environ(&mut work, &AccountEnv { config_dir: s("/Users/you/.claude-work"), kind: AgentKind::Claude });
    assert_eq!(
        envs(&work),
        [
            ("ANTHROPIC_API_KEY".to_string(), None),
            ("CLAUDE_CONFIG_DIR".to_string(), s("/Users/you/.claude-work")),
            ("GROK_HOME".to_string(), None),
            ("MNEMO_AGENT".to_string(), s("claude")),
        ]
    );
    let mut default = crate::proc::command("claude");
    environ(&mut default, &AccountEnv { config_dir: None, kind: AgentKind::Claude });
    assert!(envs(&default).contains(&("CLAUDE_CONFIG_DIR".to_string(), None)), "the default account runs with the variable removed");
}

#[test]
fn claude_is_started_in_the_brain_dir_with_the_system_prompt_beside_it() {
    let dir = crate::testutil::temp_dir("jarvis-brain-dir").join("jarvis-brain");
    let cmd = claude_in(&dir, &key("Você é o James.")).unwrap();
    assert_eq!(cmd.get_current_dir(), Some(dir.as_path()));
    assert_eq!(std::fs::read_to_string(dir.join("system.md")).unwrap(), "Você é o James.");
    let args: Vec<_> = cmd.get_args().collect();
    assert_eq!(args.last().map(|a| PathBuf::from(a)), Some(dir.join("system.md")));
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

#[test]
fn the_brain_dir_of_either_build_is_told_from_a_project() {
    let home = Path::new("/Users/you");
    assert!(is_brain_dir("/Users/you/.mnemo-desktop/jarvis-brain", home));
    assert!(is_brain_dir("/Users/you/.mnemo-desktop-dev/jarvis-brain/", home));
    assert!(!is_brain_dir("/Users/you/.mnemo-desktop", home));
    assert!(!is_brain_dir("/Users/you/code/jarvis-brain", home));
    assert!(!is_brain_dir("", home));
    if cfg!(windows) {
        let home = Path::new(r"C:\Users\you");
        assert!(is_brain_dir(r"C:\Users\you\.mnemo-desktop\jarvis-brain", home));
        assert!(is_brain_dir(r"c:\users\YOU\.mnemo-desktop-dev\jarvis-brain", home), "Windows paths are the same in any case");
        assert!(is_brain_dir(r"\\?\C:\Users\you\.mnemo-desktop\jarvis-brain", home));
    }
}

#[test]
fn a_turn_ends_at_its_result_and_an_error_result_is_the_error() {
    assert_eq!(result_of(r#"{"type":"system","subtype":"init","cwd":"/b"}"#), None);
    assert_eq!(result_of(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Oi"}]}}"#), None);
    assert_eq!(result_of("running 1 test"), None);
    assert_eq!(result_of(r#"{"type":"result","subtype":"success","is_error":false,"result":"Oi, tudo bem?"}"#), Some(Ok("Oi, tudo bem?".into())));
    let api = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":404,"result":"There's an issue with the selected model."}"#;
    assert_eq!(result_of(api), Some(Err("Claude: There's an issue with the selected model.".into())));
    let run = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["one","two"]}"#;
    assert_eq!(result_of(run), Some(Err("Claude: one; two".into())));
    assert_eq!(result_of(r#"{"type":"result","subtype":"error_max_turns"}"#), Some(Err("Claude: error_max_turns".into())));
}

/// A `stream_event` line as Claude Code 2.1.312 writes it with `--include-partial-messages`
/// (ids made up), around `event`.
fn event_line(event: serde_json::Value) -> String {
    json!({ "type": "stream_event", "event": event, "session_id": "s", "parent_tool_use_id": null, "uuid": "u", "api_message_id": "msg_1" }).to_string()
}

fn delta_line(kind: &str, field: &str, text: &str) -> String {
    event_line(json!({ "type": "content_block_delta", "index": 0, "delta": { "type": kind, field: text } }))
}

#[test]
fn a_piece_is_the_text_delta_of_a_stream_event_and_nothing_else() {
    assert_eq!(piece_of(&delta_line("text_delta", "text", "Rebase é um")), Some("Rebase é um".into()));
    assert_eq!(piece_of(&delta_line("text_delta", "text", " comando")), Some(" comando".into()), "taken as written, its spaces kept");
    assert_eq!(piece_of(&delta_line("thinking_delta", "thinking", "hmm")), None, "thinking is not said");
    assert_eq!(piece_of(&delta_line("input_json_delta", "partial_json", "{\"to")), None);
    assert_eq!(piece_of(&delta_line("citations_delta", "text", "fonte")), None, "only a text_delta, whatever else carries a text");
    let delta = json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": "Oi" } });
    assert_eq!(piece_of(&json!({ "type": "system", "event": delta }).to_string()), None, "only a stream_event's");
    assert_eq!(piece_of(&event_line(json!({ "type": "message_start", "message": {} }))), None);
    assert_eq!(piece_of(&event_line(json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }))), None);
    assert_eq!(piece_of(&event_line(json!({ "type": "message_stop" }))), None);
    assert_eq!(piece_of(&event_line(json!({ "type": "message_delta", "delta": { "type": "text_delta", "text": "Oi" } }))), None, "only a content_block_delta's");
    assert_eq!(piece_of(r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Oi"}]}}"#), None, "the whole message is not a piece again");
    assert_eq!(piece_of(r#"{"type":"result","subtype":"success","is_error":false,"result":"Oi"}"#), None);
    assert_eq!(piece_of("running 1 test"), None);
}

#[test]
fn what_is_left_of_the_result_is_what_the_pieces_did_not_cover() {
    assert_eq!(rest_of("Oi, tudo bem?", "Oi, tudo bem?"), Some(""));
    assert_eq!(rest_of("Oi, tudo bem?", "Oi, tu"), Some("do bem?"));
    assert_eq!(rest_of("Oi, tudo bem?", ""), Some("Oi, tudo bem?"));
    assert_eq!(rest_of("Oi, tudo bem?", "Olá"), None, "pieces that are not how it begins");
}

// ---------------------------------------------------------------------------------------
// Over a fake `claude`: this test binary, run as `fake_claude` below.

/// The fake `claude`, when a test starts this binary with `JARVIS_BRAIN_FAKE` set; nothing
/// otherwise. Each turn answers `<pid> <turn>: <text>` after an init and an assistant line, as
/// `claude -p` does, and libtest's own lines are what a real one never writes: lines that are not
/// JSON. With `--include-partial-messages`, a real one writes the answer's deltas before the
/// `result`; the fake writes it five characters a delta, after a thinking delta and an empty one.
/// Its modes:
/// - `echo`: answers every turn; a text holding "fail" gets a `result` that is an error, one
///   holding "metade" deltas for only the first half of the answer, one holding "lento" waits
///   `SLOW` between the last delta and the `result`;
/// - `silent`: answers nothing;
/// - `crash`: writes two lines to stderr at the first turn, and exits 3.
#[test]
#[ignore = "the fake claude the other tests start; does nothing on its own"]
fn fake_claude() {
    let Ok(mode) = std::env::var("JARVIS_BRAIN_FAKE") else { return };
    let pid = std::process::id();
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for (n, line) in stdin.lock().lines().enumerate() {
        let Ok(line) = line else { return };
        let v: serde_json::Value = serde_json::from_str(&line).unwrap();
        let text = v["message"]["content"].as_str().unwrap().to_string();
        match mode.as_str() {
            "silent" => continue,
            "crash" => {
                eprintln!("starting");
                eprintln!("fatal: the fake fell over");
                std::process::exit(3);
            }
            _ => {}
        }
        std::thread::sleep(Duration::from_millis(20));
        let answer = format!("{pid} {}: {text}", n + 1);
        let chars: Vec<char> = answer.chars().collect();
        let streamed = if text.contains("metade") { chars.len() / 2 } else { chars.len() };
        writeln!(out, "{}", json!({ "type": "system", "subtype": "init", "session_id": "s" })).unwrap();
        writeln!(out, "{}", delta_line("thinking_delta", "thinking", "pensando")).unwrap();
        writeln!(out, "{}", delta_line("text_delta", "text", "")).unwrap();
        for piece in chars[..streamed].chunks(5) {
            writeln!(out, "{}", delta_line("text_delta", "text", &piece.iter().collect::<String>())).unwrap();
            out.flush().unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
        if text.contains("lento") {
            std::thread::sleep(SLOW);
        }
        let result = if text.contains("fail") {
            json!({ "type": "result", "subtype": "success", "is_error": true, "result": "boom" })
        } else {
            json!({ "type": "result", "subtype": "success", "is_error": false, "result": answer })
        };
        for l in [
            json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": answer }] } }),
            result,
        ] {
            writeln!(out, "{l}").unwrap();
        }
        out.flush().unwrap();
    }
}

fn fake(mode: &str) -> Command {
    let mut cmd = crate::proc::command(std::env::current_exe().unwrap());
    cmd.args(["--exact", "jarvis_brain::tests::fake_claude", "--ignored", "--nocapture", "--test-threads=1"]).env("JARVIS_BRAIN_FAKE", mode);
    cmd
}

/// A start that runs the fake in each of `modes` in turn, then in `echo`, and counts its starts.
fn starts(modes: &[&'static str]) -> (impl Fn(&Key) -> Result<Command, String>, Arc<Mutex<usize>>) {
    let modes = Arc::new(Mutex::new(modes.iter().copied().collect::<VecDeque<_>>()));
    let count = Arc::new(Mutex::new(0));
    let n = count.clone();
    let start = move |_: &Key| {
        *lock(&n) += 1;
        Ok(fake(lock(&modes).pop_front().unwrap_or("echo")))
    };
    (start, count)
}

fn key(system: &str) -> Key {
    Key { system: system.into(), model: "sonnet".into(), effort: "low".into(), account: AccountEnv { config_dir: None, kind: AgentKind::Claude } }
}

const WAIT: Duration = Duration::from_secs(60);

/// How long the fake waits between its last delta and its `result` for a text holding "lento".
const SLOW: Duration = Duration::from_millis(1500);

/// `brain.stream`'s reply, and the pieces it sent with when each came.
fn streamed(brain: &Brain, key: &Key, text: &str, start: &dyn Fn(&Key) -> Result<Command, String>) -> (Result<String, String>, Vec<(String, Instant)>) {
    let mut pieces = Vec::new();
    let got = brain.stream(key, text, start, WAIT, &mut |p| pieces.push((p.to_string(), Instant::now())));
    (got, pieces)
}

fn joined(pieces: &[(String, Instant)]) -> String {
    pieces.iter().map(|p| p.0.as_str()).collect()
}

/// `(pid, turn, text)` of a fake's answer.
fn said(answer: &str) -> (u32, usize, String) {
    let (head, text) = answer.split_once(": ").unwrap();
    let (pid, turn) = head.split_once(' ').unwrap();
    (pid.parse().unwrap(), turn.parse().unwrap(), text.to_string())
}

#[test]
fn two_asks_go_to_one_process_and_a_new_system_starts_another() {
    let brain = Brain::new();
    let (start, count) = starts(&[]);
    let first = said(&brain.ask(&key("A"), "bom dia", &start, WAIT).unwrap());
    let second = said(&brain.ask(&key("A"), "e agora?", &start, WAIT).unwrap());
    assert_eq!((first.1, first.2.as_str()), (1, "bom dia"));
    assert_eq!((second.0, second.1, second.2.as_str()), (first.0, 2, "e agora?"), "the same process, its second turn");
    assert_eq!(brain.pid(), Some(first.0));

    let other = said(&brain.ask(&key("B"), "oi", &start, WAIT).unwrap());
    assert_ne!(other.0, first.0);
    assert_eq!(other.1, 1, "a new conversation");
    assert!(!crate::mission::pid_alive(first.0), "the old process was ended");
    let model = Key { model: "haiku".into(), ..key("B") };
    assert_ne!(said(&brain.ask(&model, "oi", &start, WAIT).unwrap()).0, other.0, "a new model starts another too");
    assert_eq!(*lock(&count), 3);
    brain.reset();
}

#[test]
fn an_ask_with_no_result_in_time_ends_the_conversation_and_fails() {
    let brain = Brain::new();
    let (start, count) = starts(&["silent"]);
    let asked = Instant::now();
    let err = brain.ask(&key("A"), "oi", &start, Duration::from_millis(1500)).unwrap_err();
    assert!(err.contains("no answer within 1 s") && err.contains("ended"), "{err}");
    assert!(asked.elapsed() < Duration::from_secs(20));
    assert_eq!(brain.pid(), None);
    assert_eq!(said(&brain.ask(&key("A"), "de novo", &start, WAIT).unwrap()).1, 1, "the next ask starts afresh");
    assert_eq!(*lock(&count), 2);
    brain.reset();
}

#[test]
fn a_process_that_dies_leaves_its_stderr_as_the_error_and_the_next_ask_starts_afresh() {
    let brain = Brain::new();
    let (start, count) = starts(&["crash"]);
    let err = brain.ask(&key("A"), "oi", &start, WAIT).unwrap_err();
    assert!(err.starts_with("claude stopped (") && err.ends_with("starting\nfatal: the fake fell over"), "{err}");
    assert_eq!(brain.pid(), None);
    let next = said(&brain.ask(&key("A"), "oi de novo", &start, WAIT).unwrap());
    assert_eq!((next.1, next.2.as_str()), (1, "oi de novo"));
    assert_eq!(*lock(&count), 2);
    brain.reset();
}

#[test]
fn a_result_that_is_an_error_is_the_error_and_the_conversation_goes_on() {
    let brain = Brain::new();
    let (start, count) = starts(&[]);
    assert_eq!(brain.ask(&key("A"), "please fail", &start, WAIT), Err("Claude: boom".to_string()));
    assert_eq!(said(&brain.ask(&key("A"), "oi", &start, WAIT).unwrap()).1, 2);
    assert_eq!(*lock(&count), 1);
    brain.reset();
}

#[test]
fn a_reset_ends_the_process_and_the_next_ask_starts_a_new_one() {
    let brain = Brain::new();
    let (start, _) = starts(&[]);
    let first = said(&brain.ask(&key("A"), "oi", &start, WAIT).unwrap());
    brain.reset();
    assert_eq!(brain.pid(), None);
    assert!(!crate::mission::pid_alive(first.0));
    brain.reset();
    let next = said(&brain.ask(&key("A"), "oi", &start, WAIT).unwrap());
    assert_ne!(next.0, first.0);
    assert_eq!(next.1, 1);
    brain.reset();
}

#[test]
fn asks_run_one_at_a_time() {
    let brain = Brain::new();
    let (start, count) = starts(&[]);
    let got: Vec<(u32, usize, String)> = std::thread::scope(|s| {
        let asks: Vec<_> = (0..4).map(|i| (i, s.spawn({
            let (brain, start) = (&brain, &start);
            move || brain.ask(&key("A"), &format!("pedido {i}"), start, WAIT).unwrap()
        }))).collect();
        asks.into_iter()
            .map(|(i, h)| {
                let got = said(&h.join().unwrap());
                assert_eq!(got.2, format!("pedido {i}"), "each ask gets its own answer");
                got
            })
            .collect()
    });
    let mut turns: Vec<usize> = got.iter().map(|g| g.1).collect();
    turns.sort();
    assert_eq!(turns, [1, 2, 3, 4]);
    assert!(got.iter().all(|g| g.0 == got[0].0));
    assert_eq!(*lock(&count), 1);
    brain.reset();
}

/// The live check on the maintainer's machine (Windows): `jarvis.json`'s brain must be Claude.
/// Two asks, where the second remembers the first, timed; the mission poll while it runs; a
/// reset. With `JARVIS_BRAIN_LIVE_HOLD` set it starts a conversation again and waits to be killed,
/// so the process can be seen to die with it.
#[test]
#[ignore = "live: asks Claude on the maintainer's subscription"]
fn live_ask_remember_reset() {
    let system = "Você é o James, um assistente de voz. Responda em uma frase curta, em português.";
    let timed = |text: &str| {
        let t = Instant::now();
        let got = ask(system, text).unwrap();
        eprintln!("{:>5.2}s  {text:?} -> {got:?}", t.elapsed().as_secs_f32());
        got
    };
    eprintln!("brain: {:?}", config().unwrap());
    timed("Meu número da sorte é 47. Só diga que anotou.");
    let second = timed("Qual é o meu número da sorte?");
    assert!(second.contains("47"), "{second}");
    let pid = BRAIN.pid().unwrap();
    eprintln!("claude pid {pid}, cwd {}", brain_dir().display());
    let snapshot = crate::mission::collect_snapshot(None, false);
    let parents: Vec<_> = snapshot.repos.iter().flat_map(|r| r.parents.iter()).collect();
    let brain_rows = parents.iter().filter(|p| is_brain_dir(&p.cwd, &crate::app_dir::home())).count();
    eprintln!("mission: {} parents, {} helpers, {brain_rows} in the brain dir", parents.len(), snapshot.helpers.len());
    assert_eq!(brain_rows, 0);
    assert!(!snapshot.helpers.iter().any(|h| is_brain_dir(&h.cwd, &crate::app_dir::home())));
    reset();
    assert!(!crate::mission::pid_alive(pid), "reset ended it");
    eprintln!("reset: pid {pid} gone");
    let after = timed("Qual é o meu número da sorte?");
    eprintln!("after the reset: {after:?}");
    if std::env::var_os("JARVIS_BRAIN_LIVE_HOLD").is_some() {
        eprintln!("held, test pid {}, claude pid {}", std::process::id(), BRAIN.pid().unwrap());
        loop {
            std::thread::sleep(Duration::from_secs(60));
        }
    }
    reset();
}

#[test]
fn a_stream_sends_the_reply_in_pieces_that_join_to_it() {
    let brain = Brain::new();
    let (start, _) = starts(&[]);
    let (got, pieces) = streamed(&brain, &key("A"), "conte até cinco, devagar", &start);
    let got = got.unwrap();
    assert_eq!(said(&got).2, "conte até cinco, devagar");
    assert!(pieces.len() > 3, "in pieces, not whole: {pieces:?}");
    assert!(pieces.iter().all(|p| !p.0.is_empty()));
    assert_eq!(joined(&pieces), got, "joined, they are the reply, in order");
    assert!(!joined(&pieces).contains("pensando"), "thinking is not sent");
    brain.reset();
}

#[test]
fn a_piece_is_sent_as_claude_writes_it_not_when_the_turn_ends() {
    let brain = Brain::new();
    let (start, _) = starts(&[]);
    let (got, pieces) = streamed(&brain, &key("A"), "um pedido lento", &start);
    let ended = Instant::now();
    assert_eq!(joined(&pieces), got.unwrap());
    let first = pieces.first().unwrap().1;
    assert!(ended.duration_since(first) >= SLOW / 2, "the first piece came {:?} before the result", ended.duration_since(first));
    brain.reset();
}

#[test]
fn what_the_deltas_left_out_of_the_result_is_sent_last() {
    let brain = Brain::new();
    let (start, _) = starts(&[]);
    let (got, pieces) = streamed(&brain, &key("A"), "só a metade em deltas", &start);
    let got = got.unwrap();
    assert_eq!(joined(&pieces), got);
    let last = &pieces.last().unwrap().0;
    assert!(last.chars().count() > 5, "the rest, in one piece: {last:?}");
    assert!(got.ends_with(last.as_str()));
    brain.reset();
}

#[test]
fn asks_and_streams_share_one_conversation() {
    let brain = Brain::new();
    let (start, count) = starts(&[]);
    let first = said(&brain.ask(&key("A"), "oi", &start, WAIT).unwrap());
    let (got, pieces) = streamed(&brain, &key("A"), "e agora?", &start);
    let second = said(&got.unwrap());
    assert_eq!((second.0, second.1), (first.0, 2), "the same process, its second turn");
    assert!(!pieces.is_empty());
    let third = said(&brain.ask(&key("A"), "e depois?", &start, WAIT).unwrap());
    assert_eq!((third.0, third.1, third.2.as_str()), (first.0, 3, "e depois?"), "an ask after a stream reads its own turn's result");
    assert_eq!(*lock(&count), 1);
    brain.reset();
}

#[test]
fn a_stream_keeps_the_errors_and_the_restart_of_an_ask() {
    let brain = Brain::new();
    let (start, count) = starts(&["crash", "silent"]);
    let (err, pieces) = streamed(&brain, &key("A"), "oi", &start);
    assert!(err.unwrap_err().ends_with("fatal: the fake fell over"));
    assert!(pieces.is_empty());
    let mut none = Vec::new();
    let err = brain.stream(&key("A"), "oi", &start, Duration::from_millis(1500), &mut |p| none.push(p.to_string())).unwrap_err();
    assert!(err.contains("no answer within 1 s"), "{err}");
    assert!(none.is_empty());
    let (err, _) = streamed(&brain, &key("A"), "please fail", &start);
    assert_eq!(err, Err("Claude: boom".to_string()), "a result that is an error is the error, whatever was sent");
    let (got, pieces) = streamed(&brain, &key("A"), "oi", &start);
    assert_eq!(joined(&pieces), got.unwrap());
    assert_eq!(*lock(&count), 3);
    brain.reset();
}

/// The live measure on the maintainer's machine, `jarvis.json`'s brain Claude: the time to the
/// first piece and to the whole reply, over asks of the length James answers.
#[test]
#[ignore = "live: asks Claude on the maintainer's subscription"]
fn live_stream_timing() {
    let system = "Você é o James, um assistente de voz. Responda em português, em até cinco frases.";
    for text in ["Oi, James, tudo bem?", "O que é um rebase no git?", "Me dá uma ideia para nomear um projeto de notas.", "Qual a capital da Austrália?", "Explique em poucas frases o que é latência."] {
        let t = Instant::now();
        let mut first = None;
        let mut pieces = Vec::new();
        let got = stream(system, text, &mut |p| {
            first.get_or_insert(t.elapsed());
            pieces.push(p.to_string());
        })
        .unwrap();
        assert_eq!(pieces.concat(), got);
        eprintln!("first {:>5.2}s  whole {:>5.2}s  {} pieces  {text:?}", first.unwrap().as_secs_f32(), t.elapsed().as_secs_f32(), pieces.len());
    }
    reset();
}

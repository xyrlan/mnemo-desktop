//! Transcript lines for the insight's tests, shaped as Claude Code writes them.

use serde_json::{json, Value};

pub const T0_MS: u64 = 1_792_065_600_000; // 2026-10-15T12:00:00Z

/// `s` seconds after `T0_MS`, as a transcript stamps a line.
pub fn at(s: u64) -> String {
    let hours = 12 + s / 3600;
    format!("2026-10-{:02}T{:02}:{:02}:{:02}.000Z", 15 + hours / 24, hours % 24, s / 60 % 60, s % 60)
}

pub fn ms(s: u64) -> u64 {
    T0_MS + s * 1000
}

/// A call's usage; half its output was thinking.
pub fn usage(input: u64, output: u64, read: u64, creation: u64) -> Value {
    json!({ "input_tokens": input, "output_tokens": output, "cache_read_input_tokens": read, "cache_creation_input_tokens": creation, "output_tokens_details": { "thinking_tokens": output / 2 }, "service_tier": "standard" })
}

pub fn assistant(s: u64, id: &str, content: Value, usage: Value) -> Value {
    json!({ "parentUuid": "p", "isSidechain": false, "type": "assistant", "uuid": format!("u-{id}-{s}"), "timestamp": at(s), "gitBranch": "main", "effort": "high",
        "message": { "id": id, "model": "claude-opus-5", "role": "assistant", "content": content, "usage": usage } })
}

pub fn says(s: u64, id: &str, words: &str, usage: Value) -> Value {
    assistant(s, id, json!([{ "type": "text", "text": words }]), usage)
}

pub fn tool(s: u64, msg: &str, id: &str, name: &str, input: Value) -> Value {
    assistant(s, msg, json!([{ "type": "tool_use", "id": id, "name": name, "input": input }]), usage(1, 10, 100, 5))
}

pub fn result(s: u64, id: &str, content: Value) -> Value {
    json!({ "type": "user", "timestamp": at(s), "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": id, "content": content }] } })
}

pub fn prompt(s: u64, words: &str) -> Value {
    json!({ "type": "user", "timestamp": at(s), "origin": { "kind": "human" }, "message": { "role": "user", "content": words } })
}

pub fn attached(s: u64, attachment: Value) -> Value {
    json!({ "type": "attachment", "timestamp": at(s), "isSidechain": false, "attachment": attachment })
}

/// `line` with `extra`'s keys put over its own.
pub fn with(mut line: Value, extra: Value) -> Value {
    for (k, v) in extra.as_object().unwrap() {
        line[k] = v.clone();
    }
    line
}

/// The lines as the file they would be.
pub fn file(lines: &[Value]) -> String {
    lines.iter().map(|l| l.to_string() + "\n").collect()
}

/// What a browser tool says of the tab it ran on.
pub fn tab(title: &str, url: &str) -> Value {
    json!({ "type": "text", "text": format!("\n\nTab Context:\n- Executed on tabId: 7\n- Available tabs:\n  • tabId 7: \"{title}\" (\"{url}\")") })
}

pub fn picture(media: &str, data: &str) -> Value {
    json!({ "type": "image", "source": { "type": "base64", "media_type": media, "data": data } })
}

/// A session that browsed a shop, with four screenshots among its results, a picture it read
/// from disk and one the transcript only names.
pub fn browsing() -> Vec<Value> {
    vec![
        tool(1, "m1", "b1", "mcp__claude-in-chrome__navigate", json!({ "url": "https://shop.example/", "tabId": 7 })),
        result(2, "b1", json!([{ "type": "text", "text": "Navigated to https://shop.example/" }, tab("Shop", "https://shop.example/")])),
        tool(3, "m2", "b2", "mcp__claude-in-chrome__computer", json!({ "action": "screenshot" })),
        with(result(4, "b2", json!([{ "type": "text", "text": "Successfully captured" }, tab("Shop", "https://shop.example/"), picture("image/jpeg", "QUJD")])), json!({ "toolUseResult": [picture("image/jpeg", "QUJD")] })),
        tool(5, "m3", "b3", "mcp__claude-in-chrome__browser_batch", json!({ "actions": [] })),
        result(6, "b3", json!([picture("image/png", "REVG"), tab("Cart (2)", "https://shop.example/cart"), picture("image/webp", "R0hJ")])),
        // A picture the session read from disk is not one its browser took.
        tool(7, "m4", "r1", "Read", json!({ "file_path": "/Users/you/pic.png" })),
        result(8, "r1", json!([picture("image/png", "SkpL")])),
        tool(9, "m5", "b4", "mcp__claude-in-chrome__computer", json!({ "action": "screenshot" })),
        result(10, "b4", json!([tab("New Tab", "chrome://newtab/"), picture("image/png", "TU5P"), { "type": "image", "source": { "type": "url", "url": "https://shop.example/logo.png" } }])),
    ]
}

// A terminal pane on its conversation face (⌘⇧C): Orca's native chat over a Claude session.
// Three states of one session, each its own scenario:
//
//   chat-view           at work: a folded run with a failed call, an edit run, prose with code,
//                       the live run and the working line; the context ring in the head
//   chat-view-approval  parked on a Bash permission: the approval card at the foot
//   chat-view-question  parked on an AskUserQuestion: the question card at the foot
//
// The transcript is written here as Claude Code writes its JSONL (2.1.28x), and read by the
// app's own parser: nothing about the chat is faked but the file.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const WT = `${REPO}-wt-tailer-eof`
const SESSION = '7a1e0c55-0000-4000-8000-00000000c4a7'
// The last prompt (70 s in) came 42 s before the shot, so the working line reads 0:42.
const T0 = Date.now() - 112_000
const PANE = 1

let clock = 0
let n = 0
const ts = (s) => new Date(T0 + s * 1000).toISOString()
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const base = (type, s) => ({ type, uuid: uuid(), parentUuid: null, timestamp: ts((clock = s)), sessionId: SESSION, cwd: WT })

const usage = (tokens) => ({ input_tokens: 3, cache_creation_input_tokens: 1200, cache_read_input_tokens: tokens - 1203 - 180, output_tokens: 180 })
const prompt = (s, text) => ({ ...base('user', s), message: { role: 'user', content: text } })
const said = (s, text, tokens) => ({ ...base('assistant', s), message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }], usage: usage(tokens) } })
const thought = (s, tokens) => ({ ...base('assistant', s), message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'thinking', thinking: '', signature: 'c2ln' }], usage: usage(tokens) } })
const call = (s, id, name, input, tokens) => ({ ...base('assistant', s), message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'tool_use', id, name, input }], usage: usage(tokens) } })
const result = (s, id, content, toolUseResult, isError = false) => ({
  ...base('user', s),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] },
  toolUseResult,
})
const reflex = (s, promptRecord, slugs) => ({
  ...base('attachment', s),
  parentUuid: promptRecord.uuid,
  attachment: {
    type: 'hook_additional_context',
    hookEvent: 'UserPromptSubmit',
    hookName: 'UserPromptSubmit',
    content: [`mnemo reflex context:\n${slugs.map((x) => `• [[${x}]]: (rule text)`).join('\n')}`],
  },
})

const PATCH = [
  {
    oldStart: 212,
    oldLines: 7,
    newStart: 212,
    newLines: 11,
    lines: [
      '         let read = file.read(&mut buf)?;',
      '         if read == 0 {',
      '-            return Ok(lines);',
      '+            // A transcript that ends without a newline still ends a line.',
      '+            if !self.partial.is_empty() && self.at_eof_for(QUIET) {',
      '+                lines.push(std::mem::take(&mut self.partial));',
      '+            }',
      '+            return Ok(lines);',
      '         }',
      '         self.partial.extend_from_slice(&buf[..read]);',
      '         split_lines(&mut self.partial, &mut lines);',
    ],
  },
]
const TEST_PATCH = [
  {
    oldStart: 540,
    oldLines: 2,
    newStart: 540,
    newLines: 12,
    lines: [
      '     }',
      '+',
      '+    #[test]',
      '+    fn a_last_line_without_newline_is_sent_once_quiet() {',
      '+        let dir = tempdir();',
      '+        write(&dir, "a.jsonl", "{\\"type\\":\\"user\\"}");',
      '+        let mut t = Tail::open(dir.join("a.jsonl"), 200).unwrap();',
      '+        assert_eq!(t.poll_after(QUIET).unwrap(), vec![r#"{"type":"user"}"#]);',
      '+        assert!(t.poll_after(QUIET).unwrap().is_empty());',
      '+    }',
      ' }',
    ],
  },
]

/** The session up to the second prompt: the fix made and tested. */
function history() {
  clock = 0
  n = 0
  const p1 = prompt(0, 'The tailer drops the last line when a transcript ends without a newline. Fix it and add a test.')
  return [
    { type: 'ai-title', aiTitle: 'Tailer drops a last line with no newline', sessionId: SESSION },
    p1,
    reflex(1, p1, ['tailer-reads-whole-lines', 'rust-tests-beside-code']),
    thought(4, 38_200),
    said(6, 'Let me look at how the tailer splits lines and what it does at the end of the file.', 38_400),
    call(7, 'tu-read', 'Read', { file_path: `${WT}/src-tauri/src/conversation.rs` }, 41_000),
    result(8, 'tu-read', '   200→impl Tail {\n   201→    pub fn poll(&mut self) -> io::Result<Vec<String>> {', { type: 'text', file: { filePath: `${WT}/src-tauri/src/conversation.rs` } }),
    call(9, 'tu-grep', 'Grep', { pattern: 'fn split_lines', path: 'src-tauri/src' }, 52_500),
    result(10, 'tu-grep', 'src-tauri/src/conversation.rs:188:fn split_lines(buf: &mut Vec<u8>, out: &mut Vec<String>) {', { mode: 'content' }),
    call(11, 'tu-log', 'Bash', { command: 'git log --oneline -3 -- src-tauri/src/conversation.rs', description: 'Recent changes to the tailer' }, 53_100),
    // A command that exits non-zero, as Claude Code writes it: an error result, a string.
    result(12, 'tu-log', "Exit code 128\nfatal: ambiguous argument 'src-tauri/src/conversation.rs'", "Error: Exit code 128\nfatal: ambiguous argument 'src-tauri/src/conversation.rs'", true),
    said(
      20,
      "Found it. `split_lines` keeps what follows the last `\\n` in `partial`, and `poll` returns at EOF without ever sending it:\n\n```rust\nif read == 0 {\n    return Ok(lines);\n}\n```\n\nSo a line is only sent once the **next** line arrives. I'll flush `partial` once the file has been quiet for a moment — a writer mid-line is still writing, so it must not be cut early.",
      61_900,
    ),
    call(24, 'tu-edit', 'Edit', { file_path: `${WT}/src-tauri/src/conversation.rs`, old_string: 'return Ok(lines);', new_string: '…' }, 66_000),
    result(25, 'tu-edit', 'The file has been updated.', { filePath: `${WT}/src-tauri/src/conversation.rs`, structuredPatch: PATCH, userModified: false }),
    call(26, 'tu-edit2', 'Edit', { file_path: `${WT}/src-tauri/src/conversation.rs`, old_string: '}', new_string: '…' }, 68_400),
    result(27, 'tu-edit2', 'The file has been updated.', { filePath: `${WT}/src-tauri/src/conversation.rs`, structuredPatch: TEST_PATCH, userModified: false }),
    call(30, 'tu-test', 'Bash', { command: 'cargo test --manifest-path src-tauri/Cargo.toml conversation::', description: 'Run the tailer tests' }, 70_100),
    result(58, 'tu-test', 'test result: ok. 15 passed', { stdout: 'running 15 tests\n...............\ntest result: ok. 15 passed; 0 failed; 0 ignored', stderr: '', interrupted: false }),
    said(
      62,
      'Fixed and tested:\n\n- `poll` now sends a trailing line once the file has been quiet for `QUIET` (250 ms)\n- a new test writes a transcript with no final newline and checks the line arrives **once**\n\nAll 15 tailer tests pass.',
      72_300,
    ),
  ]
}

const parent = (status, waiting_for = null) => ({
  repos: [{ root: REPO, name: 'mnemo-desktop', parents: [{ session_id: SESSION, pid: 4242, name: 'tailer eof', status, cwd: WT, waiting_for }], missions: [], children: [] }],
  errors: [],
  at: '2026-09-24T14:04:00Z',
})

function chat(name, { records, status, waitingFor }) {
  scenario(name, {
    ipc: appIpc({
      home_snapshot: {
        repos: [
          {
            root: REPO,
            name: 'mnemo-desktop',
            last_at: T0,
            pinned: true,
            hidden: false,
            unresolved: false,
            sessions: [{ id: SESSION, title: 'Tailer drops a last line', cwd: WT, last_at: T0, transcript: true, live: 'here', kind: 'interactive', agent: null }],
            children: [],
          },
        ],
        clone_base: '/Users/preview/code',
        errors: [],
        protected: 0,
      },
      worktree_list: ({ repo }) =>
        repo === REPO
          ? [
              { path: REPO, branch: 'main', head: 'a'.repeat(40), isMain: true, dispatched: false, dirty: false, setupJob: null },
              { path: WT, branch: 'fix/tailer-eof', head: 'b'.repeat(40), isMain: false, dispatched: false, dirty: true, setupJob: null },
            ]
          : [],
      mission_snapshot: parent(status, waitingFor),
      mission_looked: {},
      workspace_read: {
        version: 2,
        activeWorktree: WT,
        worktrees: [
          {
            path: WT,
            tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: PANE }, focused: PANE }],
            panes: { [PANE]: { view: 'terminal', cwd: WT, sessionId: SESSION, face: 'conversation' } },
            activeTab: 'tab-1',
          },
        ],
      },
      workspace_live_sessions: [SESSION],
      pty_spawn: ({ onOutput }) => {
        setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
        return PANE
      },
      pty_write: null,
      pty_resize: null,
      pty_kill: null,
      pty_pid: 4242,
      pty_list: [],
      chrome_repo: 'mnemo-desktop',
      chrome_branch: 'fix/tailer-eof',
      chrome_session: SESSION,
      chrome_claude_running: true,
      memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
      conversation_follow: ({ onEvent }) => {
        const lines = records.map((r) => JSON.stringify(r))
        setTimeout(() => void onEvent.send({ kind: 'lines', start: 0, end: lines.join('\n').length + 1, lines }), 30)
        return 1
      },
      conversation_unfollow: null,
      conversation_earlier: { start: 0, end: 0, lines: [] },
      usage_log: null,
    }),
  })
}

{
  const h = history()
  chat('chat-view', {
    status: 'busy',
    records: [
      ...h,
      prompt(70, 'Good. Run the frontend tests for the conversation too, then open a PR.'),
      thought(72, 118_000),
      call(74, 'tu-status', 'Bash', { command: 'git status --short', description: 'What changed' }, 121_300),
      result(75, 'tu-status', ' M src-tauri/src/conversation.rs', { stdout: ' M src-tauri/src/conversation.rs\n', stderr: '', interrupted: false }),
      call(76, 'tu-vitest', 'Bash', { command: 'pnpm vitest run src/conversation', description: 'Frontend conversation tests' }, 124_600),
    ],
  })
}

{
  const h = history()
  chat('chat-view-approval', {
    status: 'waiting',
    waitingFor: 'permission prompt',
    records: [
      ...h,
      prompt(70, 'Push it and open the PR.'),
      said(73, 'Pushing the branch first.', 119_800),
      call(74, 'tu-push', 'Bash', { command: 'git push --force-with-lease -u origin fix/tailer-eof', description: 'Push the branch to origin' }, 121_000),
    ],
  })
}

{
  const h = history()
  const questions = [
    {
      question: 'How long should the tailer wait before it sends a line with no newline?',
      header: 'Quiet time',
      multiSelect: false,
      options: [
        { label: '250 ms', description: 'What the fix uses now' },
        { label: '1 s', description: 'Safer for slow writers' },
        { label: 'Never: only at session end', description: 'The old behaviour, fixed at exit' },
      ],
    },
  ]
  chat('chat-view-question', {
    status: 'waiting',
    waitingFor: 'input needed',
    records: [...h, prompt(70, 'Is 250 ms right? Ask me if unsure.'), call(74, 'tu-ask', 'AskUserQuestion', { questions }, 120_400)],
  })
}

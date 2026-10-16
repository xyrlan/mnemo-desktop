import { deriveConversation, parseRecord } from './parse'
import { isGrokRecord, userQuery } from './parse-grok'
import type { Card, TranscriptRecord } from './types'

type R = TranscriptRecord

/** A grok 1.0.60 `-p` session as `chat_history.jsonl` held it (2026-10-16: write a file, edit
 *  it, `cat` it, read it back), with the paths made up and the long texts cut. Field for field
 *  what Grok wrote; mnemo's `tests/unit/_grok_history.py` keeps the same recording. */
const NOTES = '/Users/you/proj/notes.txt'
const RECORDED: R[] = [
  { type: 'system', content: 'You are Grok 4.7 released by xAI. You are an autonomous agent…' },
  { type: 'user', content: [{ type: 'text', text: '<user_info>\nOS Version: macos\nShell: /bin/zsh\nWorkspace Path: /Users/you/proj\n</user_info>\n\n<rules>\nThe rules section h…</rules>' }] },
  { type: 'user', content: [{ type: 'text', text: '<system-reminder>\nThe following skills are available for use…\n</system-reminder>' }], synthetic_reason: 'system_reminder' },
  { type: 'user', content: [{ type: 'text', text: '<user_query>\nCreate notes.txt with alpha, edit it to beta, cat it, read it. Reply DONE.\n</user_query>' }], prompt_index: 0 },
  { type: 'reasoning', id: 'rs_0bae74b9', summary: [{ type: 'summary_text', text: 'The user wants me to create a file' }], encrypted_content: 'Ypws…', status: 'completed' },
  {
    type: 'assistant', content: "I'll create `notes.txt` with `alpha`, then edit it to `beta`.",
    tool_calls: [{ id: 'call-3b51-0', name: 'write', arguments: JSON.stringify({ file_path: NOTES, content: 'alpha\n' }) }],
    model_id: 'grok-4.7', model_fingerprint: 'fp_f95ce4c3856c43c4', reasoning_effort: 'high',
  },
  { type: 'tool_result', tool_call_id: 'call-3b51-0', content: `The file ${NOTES} has been created.` },
  {
    type: 'assistant', content: '',
    tool_calls: [{ id: 'call-9df6-1', name: 'search_replace', arguments: JSON.stringify({ file_path: NOTES, old_string: 'alpha', new_string: 'beta' }) }],
    model_id: 'grok-4.7',
  },
  { type: 'tool_result', tool_call_id: 'call-9df6-1', content: `The file ${NOTES} has been updated successfully.` },
  {
    type: 'assistant', content: '',
    tool_calls: [
      { id: 'call-ed4d-2', name: 'run_terminal_command', arguments: JSON.stringify({ command: 'cat notes.txt', description: 'Print notes.txt' }) },
      { id: 'call-ed4d-3', name: 'read_file', arguments: JSON.stringify({ target_file: NOTES }) },
    ],
    model_id: 'grok-4.7',
  },
  { type: 'tool_result', tool_call_id: 'call-ed4d-3', content: '1→beta\n' },
  { type: 'tool_result', tool_call_id: 'call-ed4d-2', content: 'exit: 0\nbeta\n' },
  { type: 'assistant', content: 'DONE', model_id: 'grok-4.7' },
]

const cards = (records: R[]) => deriveConversation(records).cards
const of = <K extends Card['kind']>(cs: Card[], kind: K) => cs.filter((c): c is Extract<Card, { kind: K }> => c.kind === kind)
const prompt = (text: string, extra: Record<string, unknown> = {}): R => ({ type: 'user', content: [{ type: 'text', text: `<user_query>\n${text}\n</user_query>` }], ...extra })
const call = (id: string, name: string, input: Record<string, unknown>): R => ({ type: 'assistant', content: '', tool_calls: [{ id, name, arguments: JSON.stringify(input) }], model_id: 'grok-4.7' })
const result = (id: string, content: string, extra: Record<string, unknown> = {}): R => ({ type: 'tool_result', tool_call_id: id, content, ...extra })

describe('a Grok history', () => {
  test('is told from a Claude transcript by its records alone', () => {
    expect(RECORDED.every(isGrokRecord)).toBe(true)
    const claude: R[] = [
      { type: 'user', uuid: 'u1', timestamp: '2026-10-16T10:00:00.000Z', message: { role: 'user', content: 'hi' } },
      { type: 'assistant', uuid: 'a1', timestamp: '2026-10-16T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'yo' }] } },
      { type: 'system', uuid: 's1', subtype: 'turn_duration', content: 'x' },
      { type: 'ai-title', aiTitle: 'Greeting' },
    ]
    expect(claude.some(isGrokRecord)).toBe(false)
    expect(deriveConversation(claude).title).toBe('Greeting')
  })

  test('the recorded session reads as its prompt, thought, words and four tool calls with results', () => {
    const got = cards(RECORDED)
    expect(got.map((c) => c.kind)).toEqual(['user', 'thinking', 'assistant', 'tool', 'tool', 'tool', 'tool', 'assistant'])
    const [user] = of(got, 'user')
    expect(user).toMatchObject({ id: 'grok:prompt:0', text: 'Create notes.txt with alpha, edit it to beta, cat it, read it. Reply DONE.', queued: false, images: [] })
    expect(of(got, 'thinking')[0].text).toBe('The user wants me to create a file')
    expect(of(got, 'assistant').map((c) => c.text)).toEqual(["I'll create `notes.txt` with `alpha`, then edit it to `beta`.", 'DONE'])
    const tools = of(got, 'tool')
    // Grok's tools under the Claude names it aliases them to, so a run counts them as Claude's.
    expect(tools.map((t) => [t.toolUseId, t.name, t.summary])).toEqual([
      ['call-3b51-0', 'Write', NOTES],
      ['call-9df6-1', 'Edit', NOTES],
      ['call-ed4d-2', 'Bash', 'cat notes.txt'],
      ['call-ed4d-3', 'Read', NOTES],
    ])
    expect(tools[0].outcome).toEqual({ kind: 'diff', filePath: NOTES, created: true, hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+alpha'] }] })
    expect(tools[1].outcome).toEqual({ kind: 'text', text: `The file ${NOTES} has been updated successfully.` })
    expect(tools[2].outcome).toEqual({ kind: 'bash', stdout: 'beta\n', stderr: '', interrupted: false })
    expect(tools[3].outcome).toEqual({ kind: 'text', text: '1→beta\n' })
    expect(tools[3].input).toMatchObject({ target_file: NOTES, file_path: NOTES })
  })

  test('says nothing a Claude transcript would: no session id, title, usage or time', () => {
    const conv = deriveConversation(RECORDED)
    expect(conv).toMatchObject({ sessionId: null, title: null, prs: [], usage: null, thinkingAt: null })
    expect(conv.cards.every((c) => c.at === '')).toBe(true)
  })

  test('ids are unique and survive more lines and earlier lines put in front', () => {
    const all = cards(RECORDED)
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    const tail = cards(RECORDED.slice(6))
    const whole = new Map(all.map((c) => [c.id, c.kind]))
    for (const c of tail) expect(whole.get(c.id), c.id).toBe(c.kind)
    const more = cards([...RECORDED, prompt('again', { prompt_index: 1 }), { type: 'assistant', content: 'DONE', model_id: 'grok-4.7' }])
    expect(more.slice(0, all.length).map((c) => c.id)).toEqual(all.map((c) => c.id))
    expect(more.at(-1)!.id).not.toBe(all.at(-1)!.id)
  })

  test('a call with no result yet is running', () => {
    const [tool] = of(cards([prompt('go', { prompt_index: 0 }), call('c1', 'run_terminal_command', { command: 'sleep 60' })]), 'tool')
    expect(tool).toMatchObject({ name: 'Bash', outcome: null })
  })
})

describe('injected records', () => {
  test('context Grok gave the model is hidden; what woke the session is a line, never a prompt', () => {
    const got = cards([
      prompt('first', { prompt_index: 0 }),
      { type: 'user', content: [{ type: 'text', text: '<project_instructions>be brief</project_instructions>' }], synthetic_reason: 'project_instructions' },
      { type: 'user', content: [{ type: 'text', text: 'Compacted: earlier we read a.ts' }], synthetic_reason: 'compaction_meta' },
      { type: 'user', content: [{ type: 'text', text: '<task-notification>\nBackground command `sleep 5` finished, exit 0\n</task-notification>' }], synthetic_reason: 'task_completed', prompt_index: 1 },
      { type: 'user', content: [{ type: 'text', text: 'Stop hook said: tests fail' }], synthetic_reason: 'stop_hook_feedback' },
      { type: 'user', content: [{ type: 'text', text: 'something new' }], synthetic_reason: 'brand_new_reason' },
    ])
    expect(got.map((c) => c.kind)).toEqual(['user', 'notification', 'notification', 'notification'])
    expect(of(got, 'user').map((c) => c.text)).toEqual(['first'])
    expect(of(got, 'notification').map((c) => c.text)).toEqual([
      'A background command finished: Background command `sleep 5` finished, exit 0',
      'A stop hook kept the session going: Stop hook said: tests fail',
      'Injected by Grok (brand_new_reason): something new',
    ])
  })

  test("a mid-turn interjection is the person's; another agent's message is a peer's", () => {
    const got = cards([
      prompt('start', { prompt_index: 0 }),
      prompt('also check b.ts', { synthetic_reason: 'interjection' }),
      { type: 'user', content: [{ type: 'text', text: 'child 3f2a done: PR #12' }], synthetic_reason: 'agent_message', prompt_index: 1 },
    ])
    expect(got.map((c) => c.kind)).toEqual(['user', 'user', 'peer'])
    expect(of(got, 'user').map((c) => c.text)).toEqual(['start', 'also check b.ts'])
    expect(of(got, 'peer')[0]).toMatchObject({ from: 'another agent', text: 'child 3f2a done: PR #12' })
  })

  test('the session prefix has no <user_query> and makes no card', () => {
    expect(cards(RECORDED.slice(0, 3))).toEqual([])
  })
})

describe('results', () => {
  test("the terminal tool's exit code says whether it failed or was killed", () => {
    const tools = of(cards([
      call('a', 'run_terminal_command', { command: 'ls nope' }),
      result('a', 'exit: 1\nls: nope: No such file or directory\n'),
      call('b', 'run_terminal_command', { command: 'sleep 999' }),
      result('b', 'exit: killed (timeout)\npartial\n'),
      call('c', 'run_terminal_command', { command: 'yes | head -c 9999999' }),
      result('c', 'exit: 0 [truncated: showing first/last 30 KB of 9.5 MB - full output at: /tmp/o]\ny\ny\n'),
    ]), 'tool')
    expect(tools.map((t) => t.outcome)).toEqual([
      { kind: 'error', text: 'exit: 1\nls: nope: No such file or directory\n' },
      { kind: 'bash', stdout: 'partial\n', stderr: '', interrupted: true },
      { kind: 'bash', stdout: 'y\ny\n', stderr: '', interrupted: false },
    ])
  })

  test('a Write over an existing file, or a tool Grok has no Claude name for, is its text', () => {
    const tools = of(cards([
      call('w', 'write', { file_path: '/p/a', content: 'x\n' }),
      result('w', 'The file /p/a has been updated successfully.'),
      call('g', 'web_fetch', { url: 'https://example.com' }),
      result('g', 'lorem'),
    ]), 'tool')
    expect(tools.map((t) => [t.name, t.summary, t.outcome])).toEqual([
      ['Write', '/p/a', { kind: 'text', text: 'The file /p/a has been updated successfully.' }],
      ['web_fetch', 'https://example.com', { kind: 'text', text: 'lorem' }],
    ])
  })

  test('images in a prompt or a result are kept as base64; arguments that are not JSON are kept whole', () => {
    const got = cards([
      { type: 'user', content: [{ type: 'text', text: '<user_query>\nlook\n</user_query>' }, { type: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' }, { type: 'image', url: 'https://x/y.png' }], prompt_index: 0 },
      { type: 'assistant', content: '', tool_calls: [{ id: 'r', name: 'read_file', arguments: '{"target_file": "/p/shot.png"' }] },
      result('r', 'Image read.', { images: [{ type: 'image', url: 'data:image/jpeg;base64,/9j/4AAQ' }] }),
    ])
    expect(of(got, 'user')[0].images).toEqual([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }])
    const [tool] = of(got, 'tool')
    expect(tool.input).toEqual({ arguments: '{"target_file": "/p/shot.png"' })
    expect(tool.images).toEqual([{ mediaType: 'image/jpeg', data: '/9j/4AAQ' }])
  })
})

describe('thinking', () => {
  test('reasoning text beats its summary; encrypted alone makes no card', () => {
    const got = cards([
      { type: 'reasoning', id: 'rs_1', content: [{ type: 'reasoning_text', text: 'Full thought.' }], summary: [{ type: 'summary_text', text: 'Short.' }] },
      { type: 'reasoning', id: 'rs_2', summary: [], encrypted_content: 'abc' },
      { type: 'assistant', content: 'ok', model_id: 'grok-4.7' },
    ])
    expect(got.map((c) => [c.kind, c.id])).toEqual([['thinking', 'grok:reasoning:rs_1'], ['assistant', got[1].id]])
    expect(of(got, 'thinking')[0].text).toBe('Full thought.')
  })
})

describe('the rest', () => {
  test("a search the server ran is a finished call; a record type this parser does not know is a grey chip", () => {
    const got = cards([
      { type: 'backend_tool_call', kind: { tool_type: 'web_search', id: 'ws_1', status: 'completed', action: { type: 'search', query: 'grok build cli' } } },
      { type: 'compaction_marker', content: 'x' },
      { type: 'compaction_marker', content: 'y' },
    ])
    expect(got.map((c) => c.kind)).toEqual(['tool', 'unknown'])
    expect(of(got, 'tool')[0]).toMatchObject({ name: 'WebSearch', toolUseId: 'ws_1', summary: 'grok build cli', outcome: { kind: 'text', text: '' } })
  })

  test('userQuery unwraps every block and nothing outside them', () => {
    expect(userQuery('<user_query>\n a \n</user_query> noise <user_query>b</user_query>')).toBe('a\n\nb')
    expect(userQuery('<user_info>x</user_info>')).toBeNull()
    expect(userQuery('<user_query>  </user_query>')).toBeNull()
  })

  test('lines from the tailer parse as records', () => {
    const lines = RECORDED.map((r) => JSON.stringify(r))
    expect(lines.map(parseRecord)).toEqual(RECORDED)
  })
})

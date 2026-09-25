import { deriveConversation, parseRecord, toolSummary, unpaste } from './parse'
import type { Card, TranscriptRecord } from './types'

const SID = 'sess-1'
let clock = 0
const ts = () => new Date(Date.UTC(2026, 8, 23, 10, 0, clock++)).toISOString()

type R = TranscriptRecord
const user = (uuid: string, content: unknown, extra: Record<string, unknown> = {}): R => ({
  type: 'user', uuid, parentUuid: null, timestamp: ts(), sessionId: SID, message: { role: 'user', content }, ...extra,
})
const assistant = (uuid: string, content: unknown[], extra: Record<string, unknown> = {}): R => ({
  type: 'assistant', uuid, parentUuid: null, timestamp: ts(), sessionId: SID, message: { role: 'assistant', content }, ...extra,
})
const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input })
const result = (uuid: string, toolUseId: string, content: unknown, extra: Record<string, unknown> = {}, isError = false): R =>
  user(uuid, [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(isError ? { is_error: true } : {}) }], extra)
const attachment = (uuid: string, a: Record<string, unknown>, extra: Record<string, unknown> = {}): R => ({
  type: 'attachment', uuid, parentUuid: null, timestamp: ts(), sessionId: SID, attachment: a, ...extra,
})
const hook = (uuid: string, hookEvent: string, content: string[], extra: Record<string, unknown> = {}): R =>
  attachment(uuid, { type: 'hook_additional_context', hookEvent, hookName: hookEvent, content, toolUseID: extra.toolUseID ?? 'x' }, extra)
const IMG = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }

const cards = (records: R[]) => deriveConversation(records).cards
const only = <K extends Card['kind']>(records: R[], kind: K) =>
  cards(records).filter((c): c is Extract<Card, { kind: K }> => c.kind === kind)
const one = <K extends Card['kind']>(records: R[], kind: K) => {
  const found = only(records, kind)
  expect(found).toHaveLength(1)
  return found[0]
}

describe('parseRecord', () => {
  test('takes a JSON object with a string type and nothing else', () => {
    expect(parseRecord('{"type":"user","uuid":"a"}')).toEqual({ type: 'user', uuid: 'a' })
    expect(parseRecord('{"uuid":"a"}')).toBeNull()
    expect(parseRecord('[1]')).toBeNull()
    expect(parseRecord('{"type":"us')).toBeNull()
  })
})

describe('cards', () => {
  test('a typed prompt is a user card with its images; redacted thinking makes no card', () => {
    const got = cards([
      user('u1', [{ type: 'text', text: 'look at this' }, IMG], { origin: { kind: 'human' } }),
      assistant('a1', [{ type: 'thinking', thinking: '', signature: 'sig' }]),
      assistant('a2', [{ type: 'text', text: 'I see a cat' }]),
    ])
    expect(got.map((c) => c.kind)).toEqual(['user', 'assistant'])
    expect(got[0]).toMatchObject({ id: 'u1', text: 'look at this', queued: false, images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] })
    expect(got[1]).toMatchObject({ id: 'a2', text: 'I see a cat' })
  })

  test('thinking the transcript kept is a card of its own, before what the record says next', () => {
    const got = cards([
      user('u1', 'why?'),
      assistant('a1', [{ type: 'thinking', thinking: 'The user asks why.', signature: 's' }, { type: 'text', text: 'Because.' }]),
    ])
    expect(got.map((c) => c.kind)).toEqual(['user', 'thinking', 'assistant'])
    expect(got[1]).toMatchObject({ kind: 'thinking', text: 'The user asks why.' })
  })

  test('thinkingAt is the last thought while nothing came after it, redacted or not', () => {
    const think = assistant('a1', [{ type: 'thinking', thinking: '', signature: 's' }])
    const at = think.timestamp
    expect(deriveConversation([user('u1', 'go'), think]).thinkingAt).toBe(at)
    expect(deriveConversation([user('u1', 'go'), think, assistant('a2', [{ type: 'text', text: 'done' }])]).thinkingAt).toBeNull()
    expect(deriveConversation([user('u1', 'go'), think, assistant('a3', [use('t1', 'Bash', { command: 'ls' })])]).thinkingAt).toBeNull()
    expect(deriveConversation([user('u1', 'go')]).thinkingAt).toBeNull()
  })

  test('usage is the last response of the main chain: prompt, cache and output together', () => {
    const withUsage = (uuid: string, usage: Record<string, unknown>, model = 'claude-opus-5', extra: Record<string, unknown> = {}) =>
      assistant(uuid, [{ type: 'text', text: 'x' }], { ...extra, message: { role: 'assistant', model, content: [{ type: 'text', text: 'x' }], usage } })
    const first = withUsage('a1', { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10 })
    const last = withUsage('a2', { input_tokens: 3, cache_creation_input_tokens: 50, cache_read_input_tokens: 2000, output_tokens: 7 })
    expect(deriveConversation([first, last]).usage).toEqual({ tokens: 2060, model: 'claude-opus-5', at: last.timestamp })
    // A subagent's own records, and an error Claude Code wrote itself, leave it where it was.
    const side = withUsage('a3', { input_tokens: 90_000 }, 'claude-opus-5', { isSidechain: true })
    const synthetic = withUsage('a4', { input_tokens: 0, output_tokens: 0 }, '<synthetic>')
    expect(deriveConversation([first, last, side, synthetic]).usage?.tokens).toBe(2060)
    expect(deriveConversation([user('u1', 'hi')]).usage).toBeNull()
  })

  test('the pane fixture ends with the usage of its last response', async () => {
    const usage = derive((await fixtures()).get('pane.jsonl')!).conversation.usage
    expect(usage?.model).toBe('claude-opus-5')
    expect(usage?.tokens).toBeGreaterThan(10_000)
  })

  test('a tool call has no outcome until its result arrives, then joins it by tool_use_id', () => {
    const call = assistant('a1', [use('t1', 'Bash', { command: 'ls -la\necho done', description: 'list' })])
    expect(one([call], 'tool')).toMatchObject({ id: 't1', toolUseId: 't1', name: 'Bash', summary: 'ls -la …', outcome: null })
    const done = one(
      [call, result('r1', 't1', 'out', { toolUseResult: { stdout: 'a\nb', stderr: 'warn', interrupted: false } })],
      'tool',
    )
    expect(done.outcome).toEqual({ kind: 'bash', stdout: 'a\nb', stderr: 'warn', interrupted: false })
  })

  test('Edit gives a diff from structuredPatch; a Write that created its file says so', () => {
    const hunk = { oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ['-a', '+b'] }
    const edit = one(
      [
        assistant('a1', [use('t1', 'Edit', { file_path: '/p/x.ts', old_string: 'a', new_string: 'b' })]),
        result('r1', 't1', 'ok', { toolUseResult: { filePath: '/p/x.ts', structuredPatch: [hunk], userModified: false } }),
      ],
      'tool',
    )
    expect(edit.summary).toBe('/p/x.ts')
    expect(edit.outcome).toEqual({ kind: 'diff', filePath: '/p/x.ts', created: false, hunks: [hunk] })

    const write = one(
      [
        assistant('a2', [use('t2', 'Write', { file_path: '/p/new.ts', content: 'one\ntwo\n' })]),
        result('r2', 't2', 'ok', { toolUseResult: { type: 'create', filePath: '/p/new.ts', content: 'one\ntwo\n', structuredPatch: [] } }),
      ],
      'tool',
    )
    expect(write.outcome).toEqual({
      kind: 'diff', filePath: '/p/new.ts', created: true,
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }],
    })
  })

  test('a denial carries its kind and what the user typed with it', () => {
    const said =
      "The user doesn't want to proceed with this tool use. The tool use was rejected. To tell you how to proceed, the user said:\nuse pnpm instead"
    const denied = one(
      [
        assistant('a1', [use('t1', 'Bash', { command: 'npm i' })]),
        result('r1', 't1', said, { toolDenialKind: 'user-rejected', toolUseResult: 'User rejected tool use' }, true),
      ],
      'tool',
    )
    expect(denied.outcome).toEqual({ kind: 'denied', reason: 'user-rejected', feedback: 'use pnpm instead' })
    const blocked = one(
      [
        assistant('a2', [use('t2', 'Bash', { command: 'rm -rf /' })]),
        result('r2', 't2', 'Permission denied by the classifier', { toolDenialKind: 'automode-blocked' }, true),
      ],
      'tool',
    )
    expect(blocked.outcome).toEqual({ kind: 'denied', reason: 'automode-blocked', feedback: null })
  })

  test('AskUserQuestion gives its answers; an error is an error; anything else is flattened text', () => {
    const ask = one(
      [
        assistant('a1', [use('t1', 'AskUserQuestion', { questions: [{ question: 'Which one?\nReally', options: [] }] })]),
        result('r1', 't1', 'answered', { toolUseResult: { questions: [], answers: { 'Which one?': 'B', 'Both?': ['x', 'y'] } } }),
      ],
      'tool',
    )
    expect(ask.summary).toBe('Which one? …')
    expect(ask.outcome).toEqual({ kind: 'answers', answers: { 'Which one?': 'B', 'Both?': 'x, y' } })

    const err = one(
      [assistant('a2', [use('t2', 'Read', { file_path: '/nope' })]), result('r2', 't2', 'File does not exist.', { toolUseResult: 'Error: File does not exist.' }, true)],
      'tool',
    )
    expect(err.outcome).toEqual({ kind: 'error', text: 'File does not exist.' })

    const read = one(
      [
        assistant('a3', [use('t3', 'Read', { file_path: '/shot.png' })]),
        result('r3', 't3', [{ type: 'text', text: 'line one' }, IMG, { type: 'text', text: 'line two' }]),
      ],
      'tool',
    )
    expect(read.outcome).toEqual({ kind: 'text', text: 'line one\n\nline two' })
    expect(read.images).toHaveLength(1)
  })

  test('text around a tool call in one record gives two assistant cards with distinct ids', () => {
    const got = cards([assistant('a1', [{ type: 'text', text: 'before' }, use('t1', 'Read', { file_path: '/x' }), { type: 'text', text: 'after' }])])
    expect(got.map((c) => [c.kind, c.id])).toEqual([['assistant', 'a1'], ['tool', 't1'], ['assistant', 'a1#2']])
  })

  test('the summary is the command, the path or the pattern, on one line', () => {
    expect(toolSummary('Grep', { pattern: 'foo.*bar', path: 'src' })).toBe('foo.*bar')
    expect(toolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
    expect(toolSummary('Read', { file_path: '/a/b.ts', limit: 10 })).toBe('/a/b.ts')
    expect(toolSummary('WebFetch', { url: 'https://x.dev', prompt: 'read it' })).toBe('https://x.dev')
    expect(toolSummary('mcp__x__y', { z: 3, thing: 'first string' })).toBe('first string')
    expect(toolSummary('Bash', { command: 'x'.repeat(300) })).toHaveLength(200)
    expect(toolSummary('Nothing', {})).toBe('')
  })

  test('an Agent call is an agent card; an async one gets its report from the task notification', () => {
    const launch = [
      assistant('a1', [use('t1', 'Agent', { description: 'find the bug', subagent_type: 'Explore', prompt: 'go' })]),
      result('r1', 't1', 'Async agent launched successfully.', { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'ag1' } }),
    ]
    expect(one(launch, 'agent')).toMatchObject({ id: 't1', toolUseId: 't1', description: 'find the bug', agentType: 'Explore', report: null })
    const note =
      '<task-notification>\n<task-id>ag1</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n' +
      '<summary>Agent "find the bug" completed</summary>\n<result>It is in parse.ts.</result>\n</task-notification>'
    const back = [...launch, user('n1', note, { origin: { kind: 'task-notification' } })]
    expect(one(back, 'agent').report).toBe('It is in parse.ts.')
    expect(one(back, 'notification')).toMatchObject({ id: 'n1', text: 'Agent "find the bug" completed' })

    const sync = [
      assistant('a2', [use('t2', 'Task', { description: 'look' })]),
      result('r2', 't2', [{ type: 'text', text: 'Found it.' }], { toolUseResult: { status: 'completed', content: [{ type: 'text', text: 'Found it.' }] } }),
    ]
    expect(one(sync, 'agent')).toMatchObject({ agentType: null, report: 'Found it.' })
    expect(only(sync, 'tool')).toHaveLength(0)
  })

  test('a peer message, a queued prompt, a queued peer and a queued notification', () => {
    const got = cards([
      user('p1', 'Message from build:\n<cross-session-message from="build">done</cross-session-message>', {
        isMeta: true, origin: { kind: 'peer', from: 'build', body: 'done' },
      }),
      attachment('q1', { type: 'queued_command', prompt: 'and then this', commandMode: 'prompt' }),
      attachment('q2', { type: 'queued_command', prompt: [{ type: 'text', text: 'with a picture' }, IMG], commandMode: 'prompt' }),
      attachment('q3', { type: 'queued_command', prompt: '<x>hi</x>', commandMode: 'prompt', origin: { kind: 'peer', from: 'ci', body: 'hi' } }),
      attachment('q4', { type: 'queued_command', prompt: '<task-notification><summary>Bash done</summary></task-notification>', commandMode: 'task-notification' }),
    ])
    expect(got).toEqual([
      { kind: 'peer', id: 'p1', at: expect.any(String), from: 'build', text: 'done' },
      { kind: 'user', id: 'q1', at: expect.any(String), text: 'and then this', images: [], rules: [], queued: true },
      expect.objectContaining({ kind: 'user', id: 'q2', text: 'with a picture', queued: true, images: [expect.objectContaining({ mediaType: 'image/png' })] }),
      { kind: 'peer', id: 'q3', at: expect.any(String), from: 'ci', text: 'hi' },
      { kind: 'notification', id: 'q4', at: expect.any(String), text: 'Bash done' },
    ])
  })

  test("slash commands and ! commands are command cards; a slash command's output and caveat are hidden, a ! command's is on its card", () => {
    const got = cards([
      user('c0', '<local-command-caveat>Caveat: the messages below…</local-command-caveat>', { isMeta: true }),
      user('c1', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
      user('c2', '<local-command-stdout>Set model to opus</local-command-stdout>'),
      user('c3', '<command-message>review</command-message>\n<command-name>/review</command-name>'),
      user('c4', '<bash-input>git status</bash-input>'),
      user('c5', '<bash-stdout>clean</bash-stdout><bash-stderr></bash-stderr>'),
    ])
    expect(got).toEqual([
      { kind: 'command', id: 'c1', at: expect.any(String), name: '/model', args: 'opus' },
      { kind: 'command', id: 'c3', at: expect.any(String), name: '/review', args: '' },
      { kind: 'command', id: 'c4', at: expect.any(String), name: '!', args: 'git status', output: { stdout: 'clean', stderr: '' } },
    ])
  })

  test("a ! command's output goes on its own card only, and a command with none yet has none", () => {
    const got = cards([
      user('b1', '<bash-input>make</bash-input>'),
      user('b2', '<bash-stdout></bash-stdout><bash-stderr>make: *** No targets.  Stop.\n</bash-stderr>'),
      user('b3', 'why?'),
      // Output with no command before it (the command is in an earlier chunk) goes nowhere.
      user('b4', '<bash-stdout>stray</bash-stdout><bash-stderr></bash-stderr>'),
      user('b5', '<bash-input> ls </bash-input>'),
    ])
    expect(got).toEqual([
      { kind: 'command', id: 'b1', at: expect.any(String), name: '!', args: 'make', output: { stdout: '', stderr: 'make: *** No targets.  Stop.\n' } },
      expect.objectContaining({ kind: 'user', id: 'b3', text: 'why?' }),
      { kind: 'command', id: 'b5', at: expect.any(String), name: '!', args: 'ls' },
    ])
  })

  test('a long paste is shown as pasted, without the wrapper Claude Code sends it in', () => {
    const wrapped = (id: string, body: string) => `\n\n<pasted_content id="${id}">\n${body}\n</pasted_content id="${id}">\n`
    expect(unpaste(wrapped('02a2', 'line one\nline two'))).toBe('line one\nline two')
    expect(unpaste(`look at this${wrapped('ab', 'x')}and this${wrapped('cd', 'y')}`)).toBe('look at this\n\nx\n\nand this\n\ny')
    expect(unpaste('<pasted_content id="1">unclosed')).toBe('<pasted_content id="1">unclosed')
    const got = cards([user('p1', wrapped('9f', 'a long paste')), user('p2', `<bash-input>${wrapped('e1', 'echo hi')}</bash-input>`)])
    expect(got).toEqual([expect.objectContaining({ kind: 'user', text: 'a long paste' }), expect.objectContaining({ kind: 'command', args: 'echo hi' })])
  })

  test('an interrupt is a notification line', () => {
    expect(cards([user('i1', [{ type: 'text', text: '[Request interrupted by user for tool use]' }])])).toEqual([
      { kind: 'notification', id: 'i1', at: expect.any(String), text: 'Request interrupted by user for tool use' },
    ])
  })
})

describe('the session block', () => {
  const START = [
    'mnemo://v1 project=demo',
    'local: [ui, testing]',
    '',
    '[last-briefing session=abc date=2026-09-23 duration_minutes=17]',
    '# Briefing',
    'Built the thing; see [[briefed-rule]].',
    '• not-learned — a bullet in the briefing',
    '[/last-briefing]',
    '',
    '[mnemo learned since your last session]',
    '• first-rule — does one thing · veto: mnemo disable-rule first-rule',
    '• second-rule — does another',
    '(1 more — mnemo status)',
    '[/mnemo learned]',
  ].join('\n')

  test('carries the briefing body and the learned slugs, and the start source of its hook', () => {
    const session = one(
      [
        attachment('h0', { type: 'hook_success', hookName: 'SessionStart:clear', hookEvent: 'SessionStart', content: '' }),
        hook('h1', 'SessionStart', ['<EXTREMELY_IMPORTANT>another plugin</EXTREMELY_IMPORTANT>', START]),
      ],
      'session',
    )
    expect(session).toMatchObject({
      id: 'h1', source: 'clear',
      briefing: '# Briefing\nBuilt the thing; see [[briefed-rule]].\n• not-learned — a bullet in the briefing',
    })
    expect(session.rules).toEqual([
      { slug: 'briefed-rule', channel: 'briefing' },
      { slug: 'first-rule', channel: 'learned' },
      { slug: 'second-rule', channel: 'learned' },
    ])
  })

  test('a SessionStart context that is not mnemo makes no card', () => {
    expect(cards([hook('h1', 'SessionStart', ['[caveman] terse mode on'])])).toEqual([])
  })
})

describe('rule chips', () => {
  test('reflex chips land on the prompt the hook answered, found up the parentUuid chain', () => {
    const got = cards([
      user('u1', 'first'),
      user('u2', 'second', { parentUuid: 'u1' }),
      attachment('x1', { type: 'total_tokens_reminder' }, { parentUuid: 'u2' }),
      // A later prompt the hook did not answer: only the chain says which one it did.
      user('p1', 'x', { isMeta: true, origin: { kind: 'peer', from: 'a', body: 'x' } }),
      hook('h1', 'UserPromptSubmit', ['mnemo reflex context:\n• [[use-pnpm]]: never npm\n• [[small-prs]]: keep them small'], { parentUuid: 'x1' }),
      assistant('a1', [{ type: 'text', text: 'ok' }], { parentUuid: 'h1' }),
    ])
    expect(got[0]).toMatchObject({ kind: 'user', id: 'u1', rules: [] })
    expect(got[1]).toMatchObject({
      kind: 'user', id: 'u2',
      rules: [{ slug: 'use-pnpm', channel: 'reflex' }, { slug: 'small-prs', channel: 'reflex' }],
    })
  })

  test('a reflex whose chain reaches no prompt lands on the latest one', () => {
    const got = only(
      [user('u1', 'first'), user('u2', 'second'), hook('h1', 'UserPromptSubmit', ['mnemo reflex context:\n• [[late]]: x'], { parentUuid: 'gone' })],
      'user',
    )
    expect(got.map((u) => u.rules)).toEqual([[], [{ slug: 'late', channel: 'reflex' }]])
  })

  test('another hook’s context is not a chip, even when it quotes [[links]]', () => {
    const [prompt] = only(
      [user('u1', 'hi'), hook('h1', 'UserPromptSubmit', ['[[not-mnemo]] says the other hook'], { parentUuid: 'u1' })],
      'user',
    )
    expect(prompt.rules).toEqual([])
  })

  test('a reflex that answered a peer message or a notification lands on no user card', () => {
    const got = cards([
      user('u1', 'mine'),
      user('p1', 'x', { isMeta: true, parentUuid: 'u1', origin: { kind: 'peer', from: 'a', body: 'x' } }),
      hook('h1', 'UserPromptSubmit', ['mnemo reflex context:\n• [[r1]]: …'], { parentUuid: 'p1' }),
    ])
    expect(got[0]).toMatchObject({ kind: 'user', rules: [] })
  })

  test('enrichment lands on the tool card with that toolUseID, whichever comes first; mcp reads are chips', () => {
    const enrich = (uuid: string, toolUseID: string) =>
      hook(uuid, 'PreToolUse', ['• mnemo rule [[edit-carefully]]:\nbody\n\n• mnemo rule [[test-first]]:\nbody'], { toolUseID })
    const got = only(
      [
        assistant('a1', [use('t1', 'Edit', { file_path: '/x' })]),
        enrich('h1', 't1'),
        enrich('h2', 't2'),
        assistant('a2', [use('t2', 'Edit', { file_path: '/y' })]),
        assistant('a3', [use('t3', 'mcp__mnemo__read_mnemo_rule', { slug: 'use-pnpm' })]),
        hook('h3', 'PreToolUse', ['some other hook: [[nope]]'], { toolUseID: 't3' }),
      ],
      'tool',
    )
    const chips = [{ slug: 'edit-carefully', channel: 'enrichment' }, { slug: 'test-first', channel: 'enrichment' }]
    expect(got[0].rules).toEqual(chips)
    expect(got[1].rules).toEqual(chips)
    expect(got[2]).toMatchObject({ summary: 'use-pnpm', rules: [{ slug: 'use-pnpm', channel: 'mcp' }] })
  })
})

describe('metadata, hidden records and unknown ones', () => {
  test('the last ai-title is the title; pr-links become one PR per number', () => {
    const c = deriveConversation([
      { type: 'ai-title', aiTitle: 'First', sessionId: SID },
      { type: 'pr-link', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', sessionId: SID },
      { type: 'ai-title', aiTitle: 'Second', sessionId: SID },
      { type: 'pr-link', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', sessionId: SID },
      { type: 'pr-link', prNumber: 9, prUrl: 'https://github.com/o/r/pull/9', sessionId: SID },
    ])
    expect(c).toEqual({
      sessionId: SID, title: 'Second', cards: [], usage: null, thinkingAt: null,
      prs: [{ number: 7, url: 'https://github.com/o/r/pull/7' }, { number: 9, url: 'https://github.com/o/r/pull/9' }],
    })
  })

  test('a title the user set beats the generated one, whichever came last', () => {
    const c = deriveConversation([
      { type: 'ai-title', aiTitle: 'Generated', sessionId: SID },
      { type: 'custom-title', customTitle: 'Mine', sessionId: SID },
      { type: 'custom-title', customTitle: 'Mine, renamed', sessionId: SID },
      { type: 'ai-title', aiTitle: 'Generated later', sessionId: SID },
    ])
    expect(c.title).toBe('Mine, renamed')
    expect(c.cards).toEqual([])
  })

  test('bookkeeping records, other attachments and meta prompts show nothing, and are not unknown', () => {
    const hidden: R[] = [
      'mode', 'last-prompt', 'atis-latch', 'permission-mode', 'file-history-snapshot', 'file-history-delta',
      'file-history-something-new', 'cost-state', 'queue-operation', 'agent-name', 'custom-title', 'bridge-session',
      'worktree-state', 'relocated', 'frame-link', 'history-suppression', 'artifact-autoreact-ledger',
      'artifact-comment-monitor',
    ].map((type) => ({ type, sessionId: SID }))
    hidden.push({ type: 'system', subtype: 'turn_duration', uuid: 's1' })
    for (const type of ['total_tokens_reminder', 'task_reminder', 'silent_turn_reminder', 'hook_success', 'edited_text_file', 'deferred_tools_delta']) {
      hidden.push(attachment(`at-${type}`, { type }))
    }
    hidden.push(user('m1', [{ type: 'text', text: '[Image: source: /tmp/x.png]' }], { isMeta: true }))
    hidden.push(user('m2', 'continue', { isMeta: true, origin: { kind: 'auto-continuation' } }))
    hidden.push(user('side', 'a subagent prompt', { isSidechain: true }))
    expect(cards(hidden)).toEqual([])
  })

  test('a record type never seen is an unknown card; a run of them collapses into one', () => {
    const got = cards([
      { type: 'brand-new', uuid: 'n1', timestamp: '2026-09-23T10:00:00.000Z' },
      { type: 'brand-new', uuid: 'n2' },
      { type: 'mode', mode: 'normal' },
      { type: 'brand-new', uuid: 'n3' },
      user('u1', 'hi'),
      { type: 'brand-new', uuid: 'n4' },
      { type: 'other-new' },
    ])
    expect(got.map((c) => (c.kind === 'unknown' ? `${c.type}:${c.id}` : c.kind))).toEqual([
      'brand-new:n1',
      'user',
      'brand-new:n4',
      expect.stringMatching(/^other-new:other-new@/),
    ])
    expect(got[0].at).toBe('2026-09-23T10:00:00.000Z')
  })
})

describe('determinism and speed', () => {
  /** A plausible transcript of `turns` prompts, each with a reflex, text, a tool call and noise. */
  function generate(turns: number): R[] {
    const out: R[] = []
    for (let i = 0; i < turns; i++) {
      const u = `u${i}`
      out.push(user(u, `prompt ${i}`, { parentUuid: i ? `r${i - 1}` : null }))
      out.push(hook(`h${i}`, 'UserPromptSubmit', [`mnemo reflex context:\n• [[rule-${i % 7}]]: x`], { parentUuid: u }))
      out.push(attachment(`t${i}`, { type: 'total_tokens_reminder' }, { parentUuid: `h${i}` }))
      out.push(assistant(`a${i}`, [{ type: 'text', text: `answer ${i} `.repeat(20) }], { parentUuid: `t${i}` }))
      out.push(assistant(`b${i}`, [use(`tool${i}`, i % 2 ? 'Bash' : 'Edit', { command: 'ls', file_path: '/x' })], { parentUuid: `a${i}` }))
      out.push(hook(`e${i}`, 'PreToolUse', [`• mnemo rule [[rule-${i % 5}]]:\nbody`], { toolUseID: `tool${i}`, parentUuid: `b${i}` }))
      out.push(
        result(`r${i}`, `tool${i}`, 'ok', {
          parentUuid: `e${i}`,
          toolUseResult: i % 2
            ? { stdout: 'x\n'.repeat(50), stderr: '', interrupted: false }
            : { filePath: '/x', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] },
        }),
      )
      out.push({ type: 'ai-title', aiTitle: `t${i}`, sessionId: SID }, { type: 'mode', mode: 'normal', sessionId: SID })
      out.push({ type: 'file-history-snapshot', messageId: u, snapshot: {} })
    }
    return out
  }

  test('the same records give the same cards and ids; loading earlier lines keeps the later ids', () => {
    const records = generate(30)
    const a = deriveConversation(records)
    const b = deriveConversation(JSON.parse(JSON.stringify(records)))
    expect(b).toEqual(a)
    expect(new Set(a.cards.map((c) => c.id)).size).toBe(a.cards.length)
    const tail = deriveConversation(records.slice(90))
    const ids = new Set(a.cards.map((c) => c.id))
    for (const c of tail.cards) expect(ids.has(c.id)).toBe(true)
  })

  test('2000 records derive in under ~50 ms', () => {
    const records = generate(200)
    expect(records.length).toBe(2000)
    deriveConversation(records)
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      const c = deriveConversation(records)
      best = Math.min(best, performance.now() - t0)
      expect(c.cards.length).toBe(600)
    }
    expect(best).toBeLessThan(50)
  })
})

// --- fixtures: real transcripts through scripts/scrub-transcript.mjs ---------------------------

type Fs = {
  readFileSync(path: string, encoding: string): string
  readdirSync(path: string, opts?: { withFileTypes: true }): { name: string; isDirectory(): boolean }[]
  statSync(path: string): { size: number }
}
type Url = { fileURLToPath(url: URL): string }

async function node() {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const url = (await import(/* @vite-ignore */ 'node:' + 'url')) as unknown as Url
  return { fs, url }
}

/** The path is a variable so Vite leaves `new URL` alone (a literal becomes an http URL). */
async function fixtureDir(rel = './fixtures/') {
  const { fs, url } = await node()
  return { fs, dir: url.fileURLToPath(new URL(rel, import.meta.url)) }
}

async function fixtures(): Promise<Map<string, string>> {
  const { fs, dir } = await fixtureDir()
  const names = (fs.readdirSync(dir, { withFileTypes: true }) as { name: string }[]).map((e) => e.name).filter((n) => n.endsWith('.jsonl'))
  return new Map(names.sort().map((n) => [n, fs.readFileSync(dir + n, 'utf8')]))
}

function derive(text: string) {
  const lines = text.split('\n').filter(Boolean)
  const records = lines.map(parseRecord)
  expect(records.every((r) => r !== null)).toBe(true)
  return { records: records as R[], conversation: deriveConversation(records as R[]) }
}

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
/** What a secret or a screenshot that slipped through the scrub would look like. */
const LEAKS: [string, RegExp][] = [
  ['base64 run', /[A-Za-z0-9+/]{200,}/],
  ['sk- key', /\bsk-[A-Za-z0-9_-]{8,}/],
  ['GitHub token', /\bghp_[A-Za-z0-9]{8,}/],
  ['PEM block', /-----BEGIN/],
  ['password', /password/i],
]

/** Keys whose values are structure: kept by the scrub, so not checked for words. Written out
 *  here rather than imported, so a key the scrubber keeps by mistake fails this test. */
const KEPT = new Set([
  'type', 'subtype', 'uuid', 'parentUuid', 'logicalParentUuid', 'sessionId', 'session_id', 'timestamp',
  'id', 'tool_use_id', 'toolUseID', 'sourceToolAssistantUUID', 'promptId', 'requestId', 'source_uuid',
  'agentId', 'messageId', 'leafUuid', 'hookName', 'hookEvent', 'toolDenialKind', 'kind', 'role',
  'stop_reason', 'media_type', 'userType', 'entrypoint', 'version', 'level', 'operation', 'permissionMode',
  'promptSource', 'turnOrigin', 'commandMode', 'model', 'subagent_type', 'status', 'source', 'mode',
  'sessionKind', 'name', 'prUrl', 'prRepository',
])
/** The envelopes the parser reads: Claude Code's tags and markers, its own slash commands,
 *  mnemo's markers and the scrub's fake slugs. Nothing else may keep a real word. */
const ENVELOPES = new RegExp(
  [
    '<(tool-use-id|task-id|status)>[\\w.:-]{0,80}</\\1>',
    '<command-name>/(?:clear|compact|model|resume|review|context|config|help|init|memory|mcp|agents|effort|fast|loop|rewind|status|usage|exit)</command-name>',
    '</?(?:command-name|command-message|command-args|bash-input|bash-stdout|bash-stderr|local-command-stdout|local-command-stderr|local-command-caveat|task-notification|task-id|tool-use-id|output-file|status|summary|result|note|usage|event|task-type|system-reminder)>',
    'mnemo://v1', 'mnemo reflex context:', '• mnemo rule ', '\\[/?last-briefing\\]?', '\\[/?mnemo learned( since your last session)?\\]',
    'the user said:', '\\[Request interrupted by user', 'fake-rule-\\d+',
  ].join('|'),
  'g',
)
const LOREM = 'loremipsumdolorsitametconsecteturadipiscingelitseddoeiusmodtemporincididunt'
/** Scrubbed text: a letter run of lorem, which restarts every 32 characters, so it begins at
 *  a multiple of 4 in the 76-letter cycle and is never longer than 31. */
const isLorem = (word: string) =>
  word.length <= 31 && Array.from({ length: LOREM.length / 4 }, (_, k) => 4 * k).some((at) => [...word].every((c, j) => c === LOREM[(at + j) % LOREM.length]))

/** Every real word left in a record: `path: word`, for string values outside `KEPT`. */
function realWords(value: unknown, path = '', key = ''): string[] {
  if (typeof value === 'string') {
    if (KEPT.has(key) || value === TINY_PNG) return []
    const words = value.replace(ENVELOPES, ' ').match(/\p{L}+/gu) ?? []
    return words.filter((w) => !isLorem(w)).map((w) => `${path}: ${w}`)
  }
  if (Array.isArray(value)) return value.flatMap((v) => realWords(v, `${path}[]`, key))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => realWords(v, `${path}.${k}`, k))
  return []
}

describe('fixtures', () => {
  test('the real-word check catches a word in any case, and passes lorem and envelopes', () => {
    expect(realWords({ message: { content: 'lorem lore loremipsumd l' } })).toEqual([])
    expect(realWords({ content: '<command-name>/clear</command-name> <task-notification>lore</task-notification> • fake-rule-3' })).toEqual([])
    expect(realWords({ type: 'LiveProductIndex', name: 'Edit' })).toEqual([])
    expect(realWords({ input: { content: '<LiveProductIndex items={lore} />' } })).toEqual(['.input.content: LiveProductIndex', '.input.content: items'])
    expect(realWords({ files: [{ content: 'lorem HARD GATE lo' }] })).toEqual(['.files[].content: HARD', '.files[].content: GATE'])
    expect(realWords({ c: '<command-name>/deploy</command-name>' })).toEqual(['.c: deploy'])
    expect(realWords({ c: 'ipsum' })).toEqual(['.c: ipsum'])
    expect(realWords({ c: 'loremipsumdolorsitametconsecteturadipiscing' })).toEqual(['.c: loremipsumdolorsitametconsecteturadipiscing'])
  })

  test('keep no real word outside the kept keys and the envelopes', async () => {
    for (const [name, text] of await fixtures()) {
      const words = text.split('\n').filter(Boolean).flatMap((l, i) => realWords(JSON.parse(l), `${name}:${i + 1}`))
      expect(words).toEqual([])
    }
  })

  test('the leak shapes catch what they are for', () => {
    const caught = (s: string) => LEAKS.filter(([, re]) => re.test(s)).map(([name]) => name)
    expect(caught('key sk-ant-api03-AbCdEf123')).toEqual(['sk- key'])
    expect(caught('GH ghp_0123456789abcdef')).toEqual(['GitHub token'])
    expect(caught('-----BEGIN OPENSSH PRIVATE KEY-----')).toEqual(['PEM block'])
    expect(caught('db Password: hunter2')).toEqual(['password'])
    expect(caught('x' + 'QUJD'.repeat(60))).toEqual(['base64 run'])
    expect(caught('<task-notification> ' + TINY_PNG)).toEqual([])
  })

  test('hold no long base64 run and no secret shape, and every image is the tiny PNG', async () => {
    const all = await fixtures()
    expect([...all.keys()]).toEqual(['bg-child.jsonl', 'clear.jsonl', 'denial.jsonl', 'pane-enrichment.jsonl', 'pane.jsonl', 'peer-queued.jsonl'])
    for (const [name, text] of all) {
      for (const [shape, re] of LEAKS) expect(re.test(text), `${name}: ${shape}`).toBe(false)
      for (const m of text.matchAll(/"data":"([^"]*)"/g)) expect(m[1], name).toBe(TINY_PNG)
    }
  })

  test('parse whole, with no unknown card and unique ids', async () => {
    for (const [name, text] of await fixtures()) {
      const { records, conversation } = derive(text)
      expect(conversation.sessionId, name).toBe(records.find((r) => typeof r.sessionId === 'string')?.sessionId)
      expect(conversation.cards.filter((c) => c.kind === 'unknown'), name).toEqual([])
      expect(new Set(conversation.cards.map((c) => c.id)).size, name).toBe(conversation.cards.length)
      expect(conversation.title, name).not.toBeNull()
    }
  })

  const kinds = (cs: Card[]) => cs.map((c) => c.kind)
  const byKind = <K extends Card['kind']>(cs: Card[], kind: K) => cs.filter((c): c is Extract<Card, { kind: K }> => c.kind === kind)

  test('a pane session: briefing and learned chips, an image, an automode denial, an async agent and its report', async () => {
    const { cards } = derive((await fixtures()).get('pane.jsonl')!).conversation
    const [session] = byKind(cards, 'session')
    expect(session.source).toBe('startup')
    expect(session.briefing).toBeTruthy()
    expect(session.rules.filter((r) => r.channel === 'learned')).toHaveLength(5)
    expect(byKind(cards, 'user').some((u) => u.images.length === 1)).toBe(true)
    expect(byKind(cards, 'tool').filter((t) => t.outcome?.kind === 'denied').map((t) => t.outcome)).toEqual([
      { kind: 'denied', reason: 'automode-blocked', feedback: null },
    ])
    const [agent] = byKind(cards, 'agent')
    expect(agent.report).toBeTruthy()
    expect(kinds(cards)).toContain('peer')
    expect(kinds(cards)).toContain('notification')
    expect(byKind(cards, 'tool').filter((t) => t.outcome?.kind === 'bash').length).toBeGreaterThan(10)
  })

  test('the same session later: enrichment chips, diffs, a question left waiting and one answered', async () => {
    const { cards } = derive((await fixtures()).get('pane-enrichment.jsonl')!).conversation
    const tools = byKind(cards, 'tool')
    const enriched = tools.filter((t) => t.rules.length)
    expect(enriched).toHaveLength(1)
    expect(enriched[0].name).toBe('Edit')
    expect(enriched[0].rules.map((r) => r.channel)).toEqual(['enrichment', 'enrichment', 'enrichment'])
    expect(tools.some((t) => t.outcome?.kind === 'diff' && t.outcome.created)).toBe(true)
    expect(tools.some((t) => t.outcome?.kind === 'diff' && !t.outcome.created && t.outcome.hunks[0].lines.length > 0)).toBe(true)
    const asks = tools.filter((t) => t.name === 'AskUserQuestion')
    expect(asks.map((t) => t.outcome?.kind ?? null)).toEqual([null, 'answers'])
  })

  test('a /clear start: the command, the session block, reflex chips, two agents with reports, peers', async () => {
    const { cards } = derive((await fixtures()).get('clear.jsonl')!).conversation
    expect(cards[0]).toMatchObject({ kind: 'command', name: '/clear', args: '' })
    expect(byKind(cards, 'session')[0].source).toBe('clear')
    expect(byKind(cards, 'user')[0].rules.map((r) => r.channel)).toEqual(['reflex', 'reflex'])
    expect(byKind(cards, 'agent').map((a) => !!a.report)).toEqual([true, true])
    expect(byKind(cards, 'peer').length).toBeGreaterThanOrEqual(2)
  })

  test('a rejected question carries the feedback the user typed; an interrupt is a line', async () => {
    const { cards } = derive((await fixtures()).get('denial.jsonl')!).conversation
    const denied = byKind(cards, 'tool').filter((t) => t.outcome?.kind === 'denied')
    expect(denied).toHaveLength(1)
    expect(denied[0].name).toBe('AskUserQuestion')
    expect(denied[0].outcome).toEqual({ kind: 'denied', reason: 'user-rejected', feedback: expect.stringMatching(/\S/) })
    expect(byKind(cards, 'session')[0].rules.map((r) => r.channel)).toContain('briefing')
    expect(byKind(cards, 'notification').map((n) => n.text)).toContain('Request interrupted by user')
  })

  test('a --bg child: reflex chips, and the rule it then read over MCP', async () => {
    const { records, conversation } = derive((await fixtures()).get('bg-child.jsonl')!)
    expect(records.some((r) => r.sessionKind === 'bg')).toBe(true)
    const [prompt] = byKind(conversation.cards, 'user')
    expect(prompt.rules.length).toBeGreaterThan(0)
    const read = byKind(conversation.cards, 'tool').find((t) => t.name === 'mcp__mnemo__read_mnemo_rule')!
    expect(read.rules).toEqual([{ slug: read.summary, channel: 'mcp' }])
    expect(prompt.rules.map((r) => r.slug)).toContain(read.summary)
  })

  test('a peer message, a queued prompt with its reflex chips, and ! commands', async () => {
    const { cards } = derive((await fixtures()).get('peer-queued.jsonl')!).conversation
    expect(byKind(cards, 'peer')).toHaveLength(1)
    const queued = byKind(cards, 'user').filter((u) => u.queued)
    expect(queued).toHaveLength(1)
    expect(queued[0].rules.map((r) => r.channel)).toEqual(['reflex', 'reflex'])
    expect(byKind(cards, 'command').length).toBeGreaterThan(3)
    expect(byKind(cards, 'command').every((c) => c.name === '!')).toBe(true)
  })
})

// --- the real machine ---------------------------------------------------------------------------

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

/** `CONVERSATION_REAL=1 pnpm vitest run src/conversation/parse.test.ts`: every transcript under
 *  ~/.claude/projects, with the count of unknown cards by type. Every type must be rendered or
 *  deliberately hidden, so any unknown fails it. */
test.skipIf(!env.CONVERSATION_REAL)('every transcript on this machine derives with no unknown card', async () => {
  const { fs } = await node()
  const os = (await import(/* @vite-ignore */ 'node:' + 'os')) as unknown as { homedir(): string }
  const root = os.homedir() + '/.claude/projects'
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) {
        if (e.name !== 'subagents') walk(p)
      } else if (e.name.endsWith('.jsonl')) files.push(p)
    }
  }
  walk(root)
  const unknown: Record<string, number> = {}
  const kinds: Record<string, number> = {}
  let records = 0
  let bad = 0
  let slowest = 0
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const parsed = lines.map(parseRecord).filter((r): r is R => r !== null)
    records += parsed.length
    bad += lines.length - parsed.length
    const t0 = performance.now()
    const { cards } = deriveConversation(parsed)
    slowest = Math.max(slowest, performance.now() - t0)
    for (const c of cards) {
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1
      if (c.kind === 'unknown') unknown[c.type] = (unknown[c.type] ?? 0) + 1
    }
  }
  console.log(
    `${files.length} transcripts, ${records} records (${bad} lines not a record), slowest derive ${slowest.toFixed(0)} ms\n` +
      `cards: ${JSON.stringify(kinds)}\nunknown by type: ${JSON.stringify(unknown)}`,
  )
  expect(unknown).toEqual({})
}, 600_000)

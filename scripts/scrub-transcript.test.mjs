import { TINY_PNG, lorem, scrubLines } from './scrub-transcript.mjs'
import { deriveConversation } from '../src/conversation/parse.ts'

const scrub = (records, opts) => scrubLines(records.map((r) => JSON.stringify(r)), opts).map((l) => JSON.parse(l))
const big = 'iVBORw0KGgo' + 'AAAA'.repeat(400)

/** A small transcript with every shape the parser reads, and secrets in its text. */
const transcript = [
  {
    type: 'attachment', uuid: 'u-ss', timestamp: '2026-09-23T10:00:00.000Z', sessionId: 's1', cwd: '/Users/me/secret-project',
    attachment: {
      type: 'hook_additional_context', hookName: 'SessionStart', hookEvent: 'SessionStart', toolUseID: 'SessionStart',
      content: [
        'mnemo://v1 project=secret-project\n[last-briefing session=abc]\n# Briefing\nthe db password is hunter2, see [[vault-creds]]\n[/last-briefing]\n\n' +
          '[mnemo learned since your last session]\n• deploy-with-key — use sk-ant-api03-AbCdEfGh12345678\n• second-rule — other\n[/mnemo learned]',
      ],
    },
  },
  { type: 'attachment', uuid: 'u-sh', attachment: { type: 'hook_success', hookName: 'SessionStart:clear', hookEvent: 'SessionStart', stdout: 'ghp_abcdefghijklmnop1234' } },
  {
    type: 'user', uuid: 'u1', parentUuid: 'u-ss', timestamp: '2026-09-23T10:00:01.000Z', origin: { kind: 'human' },
    message: { role: 'user', content: [{ type: 'text', text: 'my token is ghp_abcdefghijklmnop1234' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: big } }] },
  },
  {
    type: 'attachment', uuid: 'u-rx', parentUuid: 'u1',
    attachment: { type: 'hook_additional_context', hookName: 'UserPromptSubmit', hookEvent: 'UserPromptSubmit', toolUseID: 'hook-1', content: ['mnemo reflex context:\n• [[vault-creds]]: -----BEGIN RSA PRIVATE KEY-----'] },
  },
  {
    type: 'assistant', uuid: 'a1', parentUuid: 'u-rx',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01', name: 'Edit', input: { file_path: '/Users/me/secret-project/.env', old_string: 'A=1', new_string: 'A=2' } }] },
  },
  {
    type: 'attachment', uuid: 'u-en',
    attachment: { type: 'hook_additional_context', hookName: 'PreToolUse:Edit', hookEvent: 'PreToolUse', toolUseID: 'toolu_01', content: ['• mnemo rule [[careful-edits]]:\nnever print the password'] },
  },
  {
    type: 'user', uuid: 'r1', parentUuid: 'a1', sourceToolAssistantUUID: 'a1',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'edited' }] },
    toolUseResult: { filePath: '/Users/me/secret-project/.env', structuredPatch: [{ oldStart: 4, oldLines: 1, newStart: 4, newLines: 1, lines: ['-PASSWORD=hunter2', '+PASSWORD=hunter3'] }] },
  },
  {
    type: 'assistant', uuid: 'a2',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_02', name: 'mcp__mnemo__read_mnemo_rule', input: { slug: 'careful-edits' } }, { type: 'tool_use', id: 'toolu_03', name: 'AskUserQuestion', input: { questions: [{ question: 'Deploy to prod?' }] } }] },
  },
  {
    type: 'user', uuid: 'r3', toolDenialKind: 'user-rejected',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_03', is_error: true, content: 'The user doesn’t want to proceed. To tell you how to proceed, the user said:\nnot with my password' }] },
  },
  { type: 'user', uuid: 'c1', message: { role: 'user', content: '<command-name>/model</command-name>\n<command-args>secret args</command-args>' } },
  { type: 'user', uuid: 'n1', origin: { kind: 'task-notification' }, message: { role: 'user', content: '<task-notification>\n<tool-use-id>toolu_09</tool-use-id>\n<status>completed</status>\n<summary>Agent "leak the password" done</summary>\n</task-notification>' } },
  { type: 'user', uuid: 'q1', isMeta: true, origin: { kind: 'peer', from: 'billing-service', body: 'pay me' }, message: { role: 'user', content: 'pay me' } },
  { type: 'pr-link', prNumber: 42, prUrl: 'https://github.com/me/private-repo/pull/42', prRepository: 'me/private-repo', sessionId: 's1' },
  // `status` is kept as structure, but not when it holds prose.
  { type: 'user', uuid: 'ans', status: 'the password is hunter2', toolUseResult: { answers: { 'Deploy to prod?': 'Yes' } }, message: { role: 'user', content: [] } },
  // What a first audit found surviving: a client's class name as a tag, another plugin's
  // tags, a project command, and client data under keys that are structure elsewhere.
  {
    type: 'assistant', uuid: 'a9',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'toolu_09', name: 'Write', input: { file_path: '/x/LiveProductIndex.tsx', content: 'export const Page = () => <LiveProductIndex items={items} />' } },
        { type: 'tool_use', id: 'toolu_10', name: 'mcp__ads__update', input: { status: 'ENABLED', id: 'ClientCampaign', subagent_type: 'Explore' } },
      ],
    },
  },
  {
    type: 'user', uuid: 'r9', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_09', content: 'File created' }] },
    toolUseResult: { type: 'create', filePath: '/x/LiveProductIndex.tsx', content: '<LiveProductIndex />', structuredPatch: [], file: { type: 'AcmeType', source: 'AcmeSource', status: 'AcmeStatus' } },
  },
  {
    type: 'attachment', uuid: 'x9', source: '/Users/me/secret-project',
    attachment: { type: 'hook_additional_context', hookName: 'SessionStart', hookEvent: 'SessionStart', content: ['<EXTREMELY_IMPORTANT>\nHARD GATE on emoji severity\n</EXTREMELY_IMPORTANT>'] },
  },
  { type: 'user', uuid: 'c9', message: { role: 'user', content: '<command-name>/caveman:caveman</command-name>\n<command-message>caveman</command-message>' } },
  { type: 'file-history-snapshot', messageId: 'u1', snapshot: { trackedFileBackups: { 'ClientThing.tsx': { backupFileName: 'x@v1', version: 1 } } } },
  'not json at all',
]

test('lorem keeps length, punctuation and whitespace, and never reads as base64 or a key', () => {
  const s = 'Hello, wörld!\n  sk-ant ghp_x ' + 'a'.repeat(80)
  const out = lorem(s)
  expect(out).toHaveLength(s.length)
  expect(out.replace(/[\p{L}\p{N}]/gu, 'x').replace(/ /g, 'x')).toBe(s.replace(/[\p{L}\p{N}]/gu, 'x').replace(/ /g, 'x'))
  expect(out).not.toMatch(/[A-Za-z0-9+/]{40,}/)
  expect(out).not.toMatch(/\bsk-|\bghp_/)
})

test('no secret, path or name survives; a line that is not JSON is dropped', () => {
  const lines = scrubLines(transcript.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))))
  expect(lines).toHaveLength(transcript.length - 1)
  const text = lines.join('\n')
  for (const leak of ['hunter2', 'hunter3', 'password', 'PASSWORD', 'sk-ant', 'ghp_', '-----BEGIN', 'secret-project', 'secret args', 'private-repo', 'billing-service', 'Deploy to prod', 'vault-creds', 'careful-edits', big.slice(0, 60),
    'LiveProductIndex', 'ClientCampaign', 'ENABLED', 'Acme', 'EXTREMELY', 'IMPORTANT', 'HARD', 'GATE', 'emoji', 'severity', 'caveman', 'ClientThing']) {
    expect(text).not.toContain(leak)
  }
})

test('structure survives: keys, types, ids, timestamps, tool and hook names, denial and origin kinds, patch shape', () => {
  const out = scrub(transcript.filter((r) => typeof r !== 'string'))
  expect(out.map((r) => r.type)).toEqual(transcript.filter((r) => typeof r !== 'string').map((r) => r.type))
  expect(out.map((r) => r.uuid)).toEqual(transcript.filter((r) => typeof r !== 'string').map((r) => r.uuid))
  expect(out[0]).toMatchObject({ timestamp: '2026-09-23T10:00:00.000Z', sessionId: 's1', attachment: { hookName: 'SessionStart', hookEvent: 'SessionStart' } })
  expect(out[1].attachment.hookName).toBe('SessionStart:clear')
  expect(out[4].message.content[0]).toMatchObject({ type: 'tool_use', id: 'toolu_01', name: 'Edit' })
  expect(Object.keys(out[4].message.content[0].input)).toEqual(['file_path', 'old_string', 'new_string'])
  const patch = out[6].toolUseResult.structuredPatch[0]
  expect(patch).toMatchObject({ oldStart: 4, oldLines: 1, newStart: 4, newLines: 1 })
  expect(patch.lines.map((l) => [l[0], l.length])).toEqual([['-', 17], ['+', 17]])
  expect(out[8].toolDenialKind).toBe('user-rejected')
  expect(out[8].message.content[0].content).toMatch(/the user said:\n\S/)
  expect(out[9].message.content).toMatch(/^<command-name>\/model<\/command-name>\n<command-args>[^<]+<\/command-args>$/)
  expect(out[10].message.content).toContain('<tool-use-id>toolu_09</tool-use-id>')
  expect(out[10].message.content).toContain('<status>completed</status>')
  expect(out[11].origin.kind).toBe('peer')
  expect(out[12]).toMatchObject({ prNumber: 42, prUrl: 'https://github.com/example/repo/pull/42', prRepository: 'example/repo' })
  expect(Object.keys(out[13].toolUseResult.answers)[0]).toHaveLength('Deploy to prod?'.length)
})

test('every image becomes the tiny PNG', () => {
  const [, , prompt] = scrub(transcript.filter((r) => typeof r !== 'string'))
  expect(prompt.message.content[1].source).toEqual({ type: 'base64', media_type: 'image/png', data: TINY_PNG })
  const [loose] = scrub([{ type: 'user', toolUseResult: { file: { base64: big } } }])
  expect(loose.toolUseResult.file.base64).toBe(TINY_PNG)
})

test('mnemo envelopes survive with fake slugs, the same slug faked the same everywhere', () => {
  const out = scrub(transcript.filter((r) => typeof r !== 'string'))
  const start = out[0].attachment.content[0]
  expect(start).toMatch(/^mnemo:\/\/v1 /)
  expect(start).toContain('[last-briefing')
  expect(start).toContain('[/last-briefing]')
  expect(start).toMatch(/\[mnemo learned since your last session\]\n• fake-rule-\d+ — [^\n]*\n• fake-rule-\d+ — [^\n]*\n\[\/mnemo learned\]/)
  const briefed = /\[\[(fake-rule-\d+)\]\]/.exec(start)[1]
  expect(out[3].attachment.content[0]).toBe(`mnemo reflex context:\n• [[${briefed}]]: ${lorem('-----BEGIN RSA PRIVATE KEY-----')}`)
  const enriched = /^• mnemo rule \[\[(fake-rule-\d+)\]\]:/.exec(out[5].attachment.content[0])[1]
  expect(out[7].message.content[0].input.slug).toBe(enriched)
})

test('the parser reads the same cards and chips off the scrubbed transcript as off the real one', () => {
  const records = transcript.filter((r) => typeof r !== 'string')
  const shape = (c) =>
    c.cards.map((k) => [
      k.kind, k.id, (k.rules ?? []).map((r) => r.channel).join(','), k.outcome?.kind ?? null, k.outcome?.created ?? null,
      k.kind === 'session' ? k.source : null, k.kind === 'agent' ? k.agentType : null,
    ])
  const real = deriveConversation(records)
  expect(shape(deriveConversation(scrub(records)))).toEqual(shape(real))
  expect(shape(deriveConversation(scrub(records, { clip: 8 })))).toEqual(shape(real))
  expect(real.cards.flatMap((k) => k.rules ?? []).map((r) => r.channel).sort()).toEqual(['briefing', 'enrichment', 'learned', 'learned', 'mcp', 'reflex'])
})

test('--clip cuts every run of lorem to a few short lines and keeps the tags', () => {
  const [r] = scrub([{ type: 'user', message: { content: '<task-notification>\n<summary>' + 'word '.repeat(50) + '</summary>\n<result>' + 'line\n'.repeat(30) + '</result>' }, note: 'many words '.repeat(50) }], { clip: 20 })
  expect(r.message.content).toMatch(/^<task-notification>\n<summary>[^<]{21}<\/summary>\n<result>(lore\n){7}lore…\n<\/result>$/)
  expect(r.note).toHaveLength(21)
  const [start] = scrub(transcript.slice(0, 1), { clip: 8 })
  expect(start.attachment.content[0]).toContain(`[last-briefing${lorem(' session=abc')}]\n`)
})

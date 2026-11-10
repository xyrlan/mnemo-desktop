// node --test tools/insight/
//
// `count.mjs` is the second opinion the core's insight is held against, so it is checked on its
// own: a count that is wrong the same way as the core's would agree with it and prove nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compare, contextError, countSubagent, countTranscript, isTyped, kindOf, subagentRows } from './count.mjs'

const usage = (input, output, read, creation) => ({
  input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: creation, output_tokens_details: { thinking_tokens: 1 },
})
const call = (at, id, usage, extra = {}, content = [{ type: 'text', text: 'x' }]) =>
  JSON.stringify({ type: 'assistant', timestamp: at, uuid: `u-${id}`, isSidechain: false, message: { id, model: 'claude-opus-5', content, usage }, ...extra })
const line = record => JSON.stringify(record)
const row = (input, output, cacheRead, cacheCreation, thinking) => ({ input, output, cacheRead, cacheCreation, thinking })

const transcript = [
  line({ type: 'custom-title', customTitle: '  the   reader ' }),
  line({ type: 'ai-title', aiTitle: 'A title Claude Code gave' }),
  line({ type: 'user', timestamp: '2026-10-15T12:00:00.000Z', origin: { kind: 'human' }, message: { content: 'build it' } }),
  call('2026-10-15T12:00:01.000Z', 'm1', usage(3, 5, 100, 10)),
  // The same message again: this record is what it cost.
  call('2026-10-15T12:00:02.000Z', 'm1', usage(3, 70, 100, 10), {}, [{ type: 'tool_use', id: 't1', name: 'mcp__claude-in-chrome__computer', input: {} }]),
  line({ type: 'user', timestamp: '2026-10-15T12:00:03.000Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [
    { type: 'text', text: 'Captured' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }, { type: 'image', source: { type: 'url', url: 'https://x.example/a.png' } },
  ] }] } }),
  call('2026-10-15T12:00:04.000Z', 's1', usage(1, 2, 3, 4), { isSidechain: true }, [{ type: 'tool_use', id: 't2', name: 'Bash', input: {} }]),
  JSON.stringify({ type: 'assistant', timestamp: '2026-10-15T12:00:05.000Z', message: { id: 'm2', model: '<synthetic>', content: [], usage: usage(9, 9, 9, 9) } }),
  call('2026-10-15T12:00:06.000Z', 'm3', usage(0, 400, 249_000, 0), { requestedModel: 'claude-opus-5' }, [{ type: 'tool_use', id: 't3', name: 'Read', input: {} }, { type: 'tool_use', id: 't4', name: 'Bash', input: {} }]),
  line({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-15T12:00:07.000Z', compactMetadata: { trigger: 'auto', preTokens: 249_539, postTokens: 21_261 } }),
  line({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-15T12:00:08.000Z', compactMetadata: { preTokens: 21_300, postTokens: 9_000 } }),
  line({ type: 'system', subtype: 'turn_duration', timestamp: '2026-10-15T12:00:09.000Z', durationMs: 1500 }),
  line({ type: 'user', timestamp: '2026-10-15T12:00:10.000Z', origin: { kind: 'task-notification' }, message: { content: 'a child finished' } }),
  line({ type: 'pr-link', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', timestamp: '2026-10-15T12:00:11.000Z' }),
  line({ type: 'pr-link', prNumber: 7, prUrl: 'https://github.com/o/r/pull/7', timestamp: '2026-10-15T12:00:11.000Z' }),
  line({ type: 'cost-state', totalCostUSD: 0.0037551000000000004 }),
  line({ type: 'api-request-shape', timestamp: '2026-10-15T13:00:00.000Z', shape: {} }),
  '{not json',
]

test('a transcript is counted message by message, the last record of each winning', () => {
  const c = countTranscript(transcript)
  assert.deepEqual(c.main, row(3, 470, 249_100, 10, 2))
  assert.deepEqual(c.sidechain, row(1, 2, 3, 4, 1))
  assert.deepEqual(c.byModel, { 'claude-opus-5': row(4, 472, 249_103, 14, 3) })
  assert.deepEqual(c.messages, { main: 2, sidechain: 1 })
  assert.deepEqual([...c.ids].sort(), ['m1', 'm3', 's1'])
})

test('the context, its window and what it was at each compaction', () => {
  const c = countTranscript(transcript)
  assert.equal(c.context, 9_000, 'a compaction states the size until the next call')
  assert.equal(c.window, 1_000_000, 'it passed 200k')
  assert.deepEqual(c.compactions, [{ pre: 249_539, post: 21_261 }, { pre: 21_300, post: 9_000 }])
  assert.deepEqual(c.measured, [[249_539, 249_400]], 'only a compaction with a call before it is held against one')
  assert.equal(countTranscript([call('2026-10-15T12:00:01.000Z', 'm1', usage(1, 1, 150_000, 0))]).window, 200_000)
  assert.equal(countTranscript([call('2026-10-15T12:00:01.000Z', 'm1', usage(1, 1, 9, 0), { requestedModel: 'claude-opus-5[1m]' })]).window, 1_000_000)
  const asked = line({ type: 'api-request', querySource: 'repl_main_thread', params: { betas: ['context-1m-2025-08-07'] } })
  assert.equal(countTranscript([asked]).window, 1_000_000)
  assert.equal(countTranscript([asked.replace('repl_main_thread', 'compact')]).window, 200_000)
})

test('tool calls, turns, screenshots and what the session calls itself', () => {
  const c = countTranscript(transcript)
  assert.equal(c.activityTotal, 3, "a side chain's call is not the session's")
  assert.deepEqual(c.activityCounts, { browser: 1, read: 1, shell: 1 })
  assert.deepEqual([c.turns, c.turnMs, c.shots], [1, 1500, 1])
  assert.equal(c.title, 'the reader')
  assert.deepEqual([c.startedAt, c.lastAt], [Date.parse('2026-10-15T12:00:00.000Z'), Date.parse('2026-10-15T12:00:11.000Z')], "a request's own record is no event")
  assert.deepEqual(c.prs, ['https://github.com/o/r/pull/7'])
  assert.equal(c.costUsd, 0.0037551000000000004)
})

test('a tool has a kind and a prompt is typed or not', () => {
  assert.deepEqual(['Read', 'PowerShell', 'ToolSearch', 'mcp__mnemo__read_mnemo_rule', 'mcp__Claude_Browser__navigate', 'mcp__desktop__desktop_pane_snapshot', 'mcp__desktop__desktop_list_panes', 'Mystery'].map(kindOf),
    ['read', 'shell', 'meta', 'memory', 'browser', 'browser', 'mcp', 'other'])
  assert.equal(isTyped({}, ' land it '), true)
  assert.equal(isTyped({ origin: { kind: 'human' } }, '<pasted>x</pasted> go'), true)
  assert.equal(isTyped({}, '<mnemo-child-finished>x</mnemo-child-finished>'), false)
  assert.equal(isTyped({ origin: { kind: 'peer' } }, 'hello'), false)
  assert.equal(isTyped({ origin: { kind: 'human' } }, '<command-name>/clear</command-name>'), false)
  assert.equal(isTyped({ origin: { kind: 'human' } }, '<system-reminder>a</system-reminder> '), false)
  assert.equal(isTyped({ isMeta: true }, 'x'), false)
  assert.equal(isTyped({ isSidechain: true }, 'x'), false)
})

test("a sub-agent's messages are counted once, and not where the session already holds them", () => {
  const fork = countSubagent([call('t', 'm3', usage(0, 400, 249_000, 0)), call('t', 'f1', usage(1, 1, 1, 1)), call('t', 'f1', usage(1, 5, 1, 1))])
  const second = countSubagent([call('t', 'f1', usage(1, 5, 1, 1)), call('t', 'g1', usage(2, 2, 2, 2))])
  const rows = subagentRows([{ id: 'a', rows: fork }, { id: 'b', rows: second }], countTranscript(transcript).ids)
  assert.deepEqual(rows, [{ id: 'a', calls: 1, tokens: row(1, 5, 1, 1, 1) }, { id: 'b', calls: 1, tokens: row(2, 2, 2, 2, 1) }])
})

test('the comparison names each counter that differs, and only those', () => {
  const mine = countTranscript(transcript)
  const subagents = [{ id: 'a', calls: 1, tokens: row(1, 5, 1, 1, 1) }]
  const core = {
    messages: { main: 2, sidechain: 1 },
    measured: [[249_539, 249_400]],
    shotsRead: 1,
    insight: {
      title: 'the reader', startedAt: mine.startedAt, lastAt: mine.lastAt, turns: 1, turnMs: 1500,
      tokens: { main: mine.main, sidechain: mine.sidechain, byModel: mine.byModel, subagents: [{ ...subagents[0], description: '', agentType: null, model: null }], own: row(5, 477, 249_104, 15, 4) },
      cost: { usd: 0.0037551000000000004 },
      context: { tokens: 9_000, window: 1_000_000, compactions: [{ at: 1, pre: 249_539, post: 21_261, trigger: 'auto' }, { at: 2, pre: 21_300, post: 9_000, trigger: null }] },
      activityTotal: 3, activityCounts: { shell: 1, read: 1, browser: 1 },
      web: { shots: [{ id: '0.0.1' }] },
      prs: [{ number: 7, url: 'https://github.com/o/r/pull/7', repo: 'o/r' }],
    },
  }
  assert.deepEqual(compare(core, mine, subagents), [])
  const off = structuredClone(core)
  off.insight.tokens.main.output += 1
  off.insight.cost.usd = 0.0037551
  off.insight.context.tokens = 249_400
  assert.deepEqual(compare(off, mine, subagents).map(d => d.field), ['tokens.main', 'context.tokens', 'cost.usd'])
})

test('the context error is how far each stated size was from the last call', () => {
  assert.equal(contextError([]), null)
  const e = contextError([[200_000, 200_000], [400_000, 401_600], [300_000, 299_700]])
  assert.deepEqual([e.compactions, e.smallest, e.largest], [3, 200_000, 400_000])
  assert.ok(Math.abs(e.median) < 1e-12 && Math.abs(e.worst - 0.004) < 1e-12)
})

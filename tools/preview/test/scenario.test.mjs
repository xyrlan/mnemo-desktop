import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getScenario, loadScenarios, PreviewChannel, reviveChannels, scenario, scenarioNames } from '../scenario.mjs'

test('the shipped scenarios load', async () => {
  await loadScenarios()
  for (const name of ['empty-workspace', 'terminal-pane']) assert.ok(scenarioNames().includes(name), name)
})

test('scenario() keeps ipc and events, defaulting events to none', () => {
  const ipc = () => 1
  scenario('reg-a', { ipc })
  assert.equal(getScenario('reg-a').ipc, ipc)
  assert.deepEqual(getScenario('reg-a').events, [])
})

test('scenario() refuses a bad name, a missing ipc, a bad event and a second registration', () => {
  assert.throws(() => scenario('Bad Name', { ipc: () => {} }), /kebab-case/)
  assert.throws(() => scenario('reg-b', {}), /ipc must be a function/)
  assert.throws(() => scenario('reg-c', { ipc: () => {}, events: [{ payload: 1 }] }), /event/)
  assert.throws(() => scenario('reg-d', { ipc: () => {}, events: [{ event: 'e', payload: 1, afterMs: -1 }] }), /afterMs/)
  scenario('reg-e', { ipc: () => {} })
  assert.throws(() => scenario('reg-e', { ipc: () => {} }), /twice/)
})

test('a Channel marker anywhere in the args becomes a PreviewChannel', async () => {
  const sent = []
  const args = reviveChannels({ onOutput: '__CHANNEL__:7', nested: ['__CHANNEL__:8', 'plain'], n: 1 }, async (id, m) => void sent.push([id, m]))
  assert.ok(args.onOutput instanceof PreviewChannel)
  assert.equal(args.nested[0].id, 8)
  assert.equal(args.nested[1], 'plain')
  assert.equal(args.n, 1)
  await args.onOutput.sendBytes('hi')
  await args.onOutput.send({ a: 1 })
  assert.deepEqual(sent, [[7, [104, 105]], [7, { a: 1 }]])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getScenario, loadScenarios, PreviewChannel, reviveChannels, scenario, scenarioNames } from '../scenario.mjs'

test('the shipped scenarios load', async () => {
  await loadScenarios()
  for (const name of ['empty-workspace', 'next-console']) assert.ok(scenarioNames().includes(name), name)
})

test('scenario() keeps ipc and events, defaulting events to none', () => {
  const ipc = () => 1
  scenario('reg-a', { ipc })
  assert.equal(getScenario('reg-a').ipc, ipc)
  assert.deepEqual(getScenario('reg-a').events, [])
  // Unless it says otherwise a scenario plays no boot clip.
  assert.deepEqual(getScenario('reg-a').storage, { 'mnemo.boot': '0' })
  assert.equal(getScenario('reg-a').drive, undefined)
  assert.equal(getScenario('reg-a').before, undefined)
})

test('a scenario that says which world it shows, or that it plays the boot clip, is taken at its word', () => {
  const before = async () => {}
  scenario('reg-next', { ipc: () => 1, storage: { 'mnemo.boot': '1', 'mnemo.world': 'sample' }, before })
  assert.deepEqual(getScenario('reg-next').storage, { 'mnemo.boot': '1', 'mnemo.world': 'sample' })
  assert.equal(getScenario('reg-next').before, before)
})

test('no picture of a URL is a picture of the launch, but the one that is meant to be', async () => {
  await loadScenarios()
  assert.equal(getScenario('next-orbit').storage['mnemo.boot'], '0')
  assert.equal(getScenario('next-swap-boot').storage['mnemo.boot'], '1')
})

test('scenario() refuses a bad name, a missing ipc, a bad event and a second registration', () => {
  assert.throws(() => scenario('Bad Name', { ipc: () => {} }), /kebab-case/)
  assert.throws(() => scenario('reg-b', {}), /ipc must be a function/)
  assert.throws(() => scenario('reg-c', { ipc: () => {}, events: [{ payload: 1 }] }), /event/)
  assert.throws(() => scenario('reg-d', { ipc: () => {}, events: [{ event: 'e', payload: 1, afterMs: -1 }] }), /afterMs/)
  assert.throws(() => scenario('reg-f', { ipc: () => {}, storage: { k: 1 } }), /storage values are strings/)
  assert.throws(() => scenario('reg-g', { ipc: () => {}, drive: 'press /' }), /drive must be a function/)
  assert.throws(() => scenario('reg-h', { ipc: () => {}, before: 'abort the frame' }), /before must be a function/)
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

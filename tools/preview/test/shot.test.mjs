// The shipped scenarios, shot through the repo's real vite and `src/`.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { loadScenarios } from '../scenario.mjs'
import { shoot } from '../shot.mjs'

let dir
before(async () => {
  await loadScenarios()
  dir = await mkdtemp(path.join(tmpdir(), 'preview-shot-'))
})
after(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function pngSize(file) {
  const b = await readFile(file)
  assert.equal(b.subarray(1, 4).toString(), 'PNG')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

test('empty-workspace: Home, every launch command answered, no page error', async () => {
  const out = path.join(dir, 'nested', 'empty.png')
  const { unanswered, pageErrors } = await shoot({ scenario: 'empty-workspace', out, size: { width: 1024, height: 640 }, log: () => {} })
  assert.deepEqual(unanswered, [])
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(await pngSize(out), { width: 1024, height: 640 })
})

test('terminal-pane: the saved tab restores into a spawned pty that gets the fixture output', async () => {
  const out = path.join(dir, 'terminal.png')
  const lines = []
  const { unanswered, pageErrors } = await shoot({ scenario: 'terminal-pane', out, trace: true, log: (l) => lines.push(l) })
  assert.deepEqual(unanswered, [])
  assert.deepEqual(pageErrors, [])
  assert.ok(lines.some((l) => l.startsWith('ipc pty_spawn ') && l.includes('__CHANNEL__:')), 'the terminal pane spawned a pty with an output channel')
  assert.deepEqual(await pngSize(out), { width: 1440, height: 900 })
})

test('an unknown scenario names the ones there are', async () => {
  await assert.rejects(shoot({ scenario: 'nope', out: path.join(dir, 'x.png') }), /no scenario named nope \(have: .*empty-workspace/)
})

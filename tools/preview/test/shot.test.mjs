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

/** The page's frame, as a test reads it after the shot: which view is drawn, the sessions the
 *  roster lists, and whether what stands in a broken frame's place is there. */
const look = (page) =>
  page.evaluate(() => ({
    frame: !!document.querySelector('.mn'),
    broken: !!document.querySelector('[data-frame-broken]'),
    sessions: document.querySelectorAll('[data-session]').length,
    bodies: document.querySelectorAll('[data-body]').length,
  }))

test('next-console: the sample world on Console, with no page error, at the size asked for', async () => {
  const out = path.join(dir, 'console.png')
  const { pageErrors, inspected } = await shoot({ scenario: 'next-console', out, log: () => {}, inspect: look })
  assert.deepEqual(pageErrors, [])
  assert.equal(inspected.frame, true)
  assert.equal(inspected.broken, false)
  assert.ok(inspected.sessions > 0, 'the roster lists sessions')
  assert.deepEqual(await pngSize(out), { width: 1440, height: 900 })
})

test('next-orbit: the sample world in Orbit, a body per family, into a folder that did not exist', async () => {
  const out = path.join(dir, 'nested', 'orbit.png')
  const { pageErrors, inspected } = await shoot({ scenario: 'next-orbit', out, size: { width: 1024, height: 640 }, log: () => {}, inspect: look })
  assert.deepEqual(pageErrors, [])
  assert.equal(inspected.broken, false)
  assert.ok(inspected.bodies > 0, 'Orbit draws bodies')
  assert.deepEqual(await pngSize(out), { width: 1024, height: 640 })
})

test('empty-workspace: a fresh boot draws the frame, every launch command answered, no page error', async () => {
  const out = path.join(dir, 'empty.png')
  const { unanswered, pageErrors, inspected } = await shoot({ scenario: 'empty-workspace', out, log: () => {}, inspect: look })
  assert.deepEqual(unanswered, [])
  assert.deepEqual(pageErrors, [])
  assert.equal(inspected.frame, true)
  assert.equal(inspected.broken, false)
})

test('next-swap-broken: a frame that does not arrive is replaced by what says so', async () => {
  const { inspected } = await shoot({ scenario: 'next-swap-broken', out: path.join(dir, 'broken.png'), log: () => {}, inspect: look })
  assert.equal(inspected.broken, true)
})

test('an unknown scenario names the ones there are', async () => {
  await assert.rejects(shoot({ scenario: 'nope', out: path.join(dir, 'x.png') }), /no scenario named nope \(have: .*empty-workspace/)
})

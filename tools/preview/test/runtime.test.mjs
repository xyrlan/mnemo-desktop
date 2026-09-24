// The Tauri stand-in in real Chromium, on a blank page: what @tauri-apps/api does with
// `__TAURI_INTERNALS__`, done by hand.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium } from 'playwright'
import { preparePage } from '../shot.mjs'

let browser
before(async () => {
  browser = await chromium.launch()
})
after(async () => {
  await browser?.close()
})

async function open(setup) {
  const page = await browser.newPage()
  const unanswered = await preparePage(page, setup)
  await page.goto('about:blank')
  return { page, unanswered }
}

test('invoke reaches the scenario with its args and resolves with the answer', async () => {
  const seen = []
  const { page, unanswered } = await open({
    ipc: (cmd, args) => {
      seen.push([cmd, args])
      return cmd === 'known' ? { ok: args.n + 1 } : undefined
    },
  })
  assert.deepEqual(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('known', { n: 1 })), { ok: 2 })
  assert.equal(await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('unknown')), null)
  assert.deepEqual(seen, [['known', { n: 1 }], ['unknown', {}]])
  assert.deepEqual([...unanswered], ['unknown'])
  await page.close()
})

test('a scenario that throws makes invoke reject with the message, as an Err would', async () => {
  const { page } = await open({
    ipc: () => {
      throw new Error('no such repo')
    },
  })
  const got = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('x').then(() => 'resolved', (e) => e))
  assert.equal(got, 'no such repo')
  await page.close()
})

test('events reach listeners on their timers, and an unlistened handler stops hearing them', async () => {
  const { page } = await open({
    ipc: () => null,
    events: [
      { event: 'job-line', payload: { line: 'one' }, afterMs: 100 },
      { event: 'job-line', payload: { line: 'two' }, afterMs: 250 },
      { event: 'other', payload: 1, afterMs: 100 },
    ],
  })
  const got = await page.evaluate(async () => {
    const T = window.__TAURI_INTERNALS__
    const heard = []
    const handler = T.transformCallback((e) => heard.push([e.event, e.payload]))
    const eventId = await T.invoke('plugin:event|listen', { event: 'job-line', target: { kind: 'Any' }, handler })
    await new Promise((r) => setTimeout(r, 150))
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener('job-line', eventId)
    await new Promise((r) => {
      const t = setInterval(() => window.__previewEventsDone && (clearInterval(t), r()), 10)
    })
    return heard
  })
  assert.deepEqual(got, [['job-line', { line: 'one' }]])
  await page.close()
})

test('the page emits to its own listeners', async () => {
  const { page } = await open({ ipc: () => null })
  const got = await page.evaluate(async () => {
    const T = window.__TAURI_INTERNALS__
    let heard = null
    const handler = T.transformCallback((e) => (heard = e.payload))
    await T.invoke('plugin:event|listen', { event: 'ping', target: { kind: 'Any' }, handler })
    await T.invoke('plugin:event|emit', { event: 'ping', payload: 42 })
    return heard
  })
  assert.equal(got, 42)
  await page.close()
})

test('a channel passed to a command gets what the scenario sends, in order', async () => {
  const { page } = await open({
    ipc: async (_cmd, { onOutput }) => {
      await onOutput.sendBytes('ab')
      await onOutput.send('second')
      return 7
    },
  })
  const got = await page.evaluate(async () => {
    const T = window.__TAURI_INTERNALS__
    const heard = []
    // What `new Channel()` does: a callback fed `{ index, message }`, serialised as a marker.
    const id = T.transformCallback((raw) => heard.push(raw))
    const reply = await T.invoke('pty_spawn', { onOutput: `__CHANNEL__:${id}` })
    return { reply, heard }
  })
  assert.deepEqual(got, { reply: 7, heard: [{ index: 0, message: [97, 98] }, { index: 1, message: 'second' }] })
  await page.close()
})

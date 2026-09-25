import { expect, test } from 'vitest'
import { makeDesignMode, POLL_MS, SENT_MS, type Deps } from './design'
import { ARM_SCRIPT, TAKE_SCRIPT, TEARDOWN_SCRIPT } from './grab-guest'
import type { AgentTarget } from './grab-agent'

const ID = -4
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

/** A page that answers `TAKE_SCRIPT` from a queue, and timers the test fires by hand. */
function rig(over: Partial<Deps> = {}) {
  const takes: string[] = []
  const evals: string[] = []
  const timers: Array<{ f: () => void; ms: number; live: boolean }> = []
  const sent: Array<{ target: AgentTarget; text: string; shot: string | null }> = []
  const script = (s: string) => (s === ARM_SCRIPT ? 'arm' : s === TAKE_SCRIPT ? 'take' : s === TEARDOWN_SCRIPT ? 'teardown' : s)
  let target: AgentTarget = { kind: 'pane', pane: 7, title: 'fix the header' }
  const design = makeDesignMode({
    evaluate: async (_id, s) => {
      evals.push(script(s))
      return s === TAKE_SCRIPT ? (takes.shift() ?? '{"armed":true}') : 'true'
    },
    snapshot: async () => ({ mime: 'image/png', data: 'FULL' }),
    crop: async (snap) => `${snap.data}-CROPPED`,
    save: async (id, png) => `/tmp/${id}-${png}.png`,
    target: () => target,
    deliver: async (t, text, shot) => {
      if (t.kind === 'none') throw new Error(t.reason)
      sent.push({ target: t, text, shot })
    },
    timers: {
      set: (f, ms) => {
        const t = { f, ms, live: true }
        timers.push(t)
        return t
      },
      clear: (t) => void ((t as { live: boolean }).live = false),
    },
    ...over,
  })
  /** Fires every pending timer once, then lets the promises they started settle. */
  const fire = async () => {
    const due = timers.splice(0).filter((t) => t.live)
    due.forEach((t) => t.f())
    await flush()
    return due.map((t) => t.ms)
  }
  const state = () => design.store.getState().panes[ID]
  return { design, takes, evals, fire, sent, state, setTarget: (t: AgentTarget) => (target = t) }
}

const picked = JSON.stringify({ picked: { page: { sanitizedUrl: 'http://localhost:3000/' }, target: { tagName: 'button', selector: 'button#save' } } })

test('starting arms the page and polls it until something happens', async () => {
  const r = rig()
  r.design.start(ID)
  expect(r.state()).toEqual({ mode: 'picking', error: null })
  await flush()
  expect(r.evals).toEqual(['arm'])
  expect(await r.fire()).toEqual([POLL_MS])
  expect(r.evals).toEqual(['arm', 'take'])
  expect(await r.fire()).toEqual([POLL_MS])
  expect(r.evals).toEqual(['arm', 'take', 'take'])
})

test('a page that lost the overlay (it navigated) is armed again', async () => {
  const r = rig()
  r.design.start(ID)
  await flush()
  r.takes.push('{"armed":false}')
  await r.fire()
  expect(r.evals).toEqual(['arm', 'take', 'arm'])
  expect(await r.fire()).toEqual([POLL_MS])
})

test('Escape in the page leaves Design Mode', async () => {
  const r = rig()
  r.design.start(ID)
  await flush()
  r.takes.push('{"cancelled":true}')
  await r.fire()
  expect(r.state()).toBeUndefined()
  expect(await r.fire()).toEqual([])
})

test('an error in the page is shown and picking goes on', async () => {
  const r = rig()
  r.design.start(ID)
  await flush()
  r.takes.push('{"error":"boom"}')
  await r.fire()
  expect(r.state()).toEqual({ mode: 'picking', error: 'boom' })
  expect(r.evals.at(-1)).toBe('arm')
})

test('a page that does not answer is asked again', async () => {
  let fail = true
  const r = rig({
    evaluate: async (_id, s) => {
      if (s === TAKE_SCRIPT && fail) throw new Error('the page did not answer the read in time')
      return s === TAKE_SCRIPT ? picked : 'true'
    },
  })
  r.design.start(ID)
  await flush()
  await r.fire()
  expect(r.state()?.mode).toBe('picking')
  fail = false
  await r.fire()
  expect(r.state()?.mode).toBe('picked')
})

test('a pick stops the polling and is screenshotted, cropped and saved', async () => {
  const r = rig()
  r.design.start(ID)
  await flush()
  r.takes.push(picked)
  await r.fire()
  const d = r.state()
  expect(d).toMatchObject({ mode: 'picked', shot: { state: 'taking' }, sending: false, error: null })
  if (d?.mode !== 'picked') return
  expect(d.payload.target.selector).toBe('button#save')
  // The repaint wait, and no poll beside it.
  expect(await r.fire()).toEqual([80])
  await flush()
  expect(r.state()).toMatchObject({ shot: { state: 'ready', path: `/tmp/${ID}-FULL-CROPPED.png`, data: 'FULL-CROPPED' } })
  expect(await r.fire()).toEqual([])
})

test('a screenshot that fails leaves the pick, saying why', async () => {
  const r = rig({ snapshot: async () => Promise.reject(new Error('pane snapshots are only implemented on macOS')) })
  r.design.start(ID)
  await flush()
  r.takes.push(picked)
  await r.fire()
  await r.fire()
  await flush()
  expect(r.state()).toMatchObject({ mode: 'picked', shot: { state: 'none', error: 'pane snapshots are only implemented on macOS' } })
})

async function pickedRig(over: Partial<Deps> = {}) {
  const r = rig(over)
  r.design.start(ID)
  await flush()
  r.takes.push(picked)
  await r.fire()
  await r.fire()
  await flush()
  return r
}

test('stopping mid-capture drops the late screenshot and takes the overlay off', async () => {
  const r = rig()
  r.design.start(ID)
  await flush()
  r.takes.push(picked)
  await r.fire()
  r.design.stop(ID)
  expect(r.state()).toBeUndefined()
  await r.fire()
  await flush()
  expect(r.state()).toBeUndefined()
  expect(r.evals.at(-1)).toBe('teardown')
})

test("a capture that outlived its pick does not land on the next one", async () => {
  const shots: Array<(s: { mime: string; data: string }) => void> = []
  const r = rig({ snapshot: () => new Promise((res) => shots.push(res)) })
  r.design.start(ID)
  await flush()
  r.takes.push(picked)
  await r.fire()
  await r.fire() // the first capture now waits on its snapshot
  r.design.stop(ID)
  r.design.start(ID)
  await flush()
  r.takes.push(picked)
  await r.fire()
  await r.fire()
  shots[1]({ mime: 'image/png', data: 'SECOND' })
  await flush()
  await flush()
  expect(r.state()).toMatchObject({ shot: { state: 'ready', data: 'SECOND-CROPPED' } })
  shots[0]({ mime: 'image/png', data: 'FIRST' })
  await flush()
  await flush()
  expect(r.state()).toMatchObject({ shot: { state: 'ready', data: 'SECOND-CROPPED' } })
})

test('send hands the write-up and the screenshot to the agent, then says so for a moment', async () => {
  const r = await pickedRig()
  expect(await r.design.send(ID, 'Make it blue')).toBe(true)
  expect(r.sent).toHaveLength(1)
  expect(r.sent[0].target).toEqual({ kind: 'pane', pane: 7, title: 'fix the header' })
  expect(r.sent[0].shot).toBe(`/tmp/${ID}-FULL-CROPPED.png`)
  expect(r.sent[0].text).toContain('Make it blue')
  expect(r.sent[0].text).toContain('**Screenshot:** /tmp/-4-FULL-CROPPED.png')
  expect(r.state()).toEqual({ mode: 'sent', title: 'fix the header' })
  expect(await r.fire()).toEqual([SENT_MS])
  expect(r.state()).toBeUndefined()
})

test('a failed send keeps the pick with the reason, and can be sent again', async () => {
  const r = await pickedRig()
  r.setTarget({ kind: 'none', reason: 'no agent is running in feature' })
  expect(await r.design.send(ID, 'x')).toBe(false)
  expect(r.state()).toMatchObject({ mode: 'picked', sending: false, error: 'no agent is running in feature' })
  r.setTarget({ kind: 'mission', id: 'c1', title: 'child' })
  expect(await r.design.send(ID, 'x')).toBe(true)
  expect(r.sent[0].target.kind).toBe('mission')
})

test('the write-up says when there is no screenshot', async () => {
  const r = await pickedRig({ save: async () => Promise.reject('disk full') })
  expect(r.design.text(ID, 'n')).toContain('**Screenshot:** none (disk full)')
  await r.design.send(ID, 'n')
  expect(r.sent[0].shot).toBeNull()
})

test('toggle starts, stops, and starts again after a send', async () => {
  const r = await pickedRig()
  r.design.toggle(ID)
  expect(r.state()).toBeUndefined()
  r.design.toggle(ID)
  expect(r.state()?.mode).toBe('picking')
  r.takes.push(picked)
  await flush()
  await r.fire()
  await r.fire()
  await flush()
  await r.design.send(ID, '')
  expect(r.state()?.mode).toBe('sent')
  r.design.toggle(ID)
  expect(r.state()?.mode).toBe('picking')
  // The "sent" timer must not clear the new run.
  await r.fire()
  expect(r.state()?.mode).toBe('picking')
})

test('nothing picked: no text, no send; stopping a pane that is off does nothing', async () => {
  const r = rig()
  expect(r.design.text(ID, 'x')).toBeNull()
  expect(await r.design.send(ID, 'x')).toBe(false)
  r.design.stop(ID)
  expect(r.evals).toEqual([])
})

test('waiting arms nothing until the page loads; a load then arms it', async () => {
  const r = rig()
  r.design.toggle(ID, false)
  expect(r.state()).toEqual({ mode: 'waiting' })
  await flush()
  expect(r.evals).toEqual([])
  expect(await r.fire()).toEqual([])
  r.design.loaded(ID)
  expect(r.state()).toEqual({ mode: 'picking', error: null })
  await flush()
  expect(r.evals).toEqual(['arm'])
})

test('a load leaves a pane alone unless it waits; stopping a wait tears nothing down', async () => {
  const r = rig()
  r.design.loaded(ID)
  expect(r.state()).toBeUndefined()
  r.design.wait(ID)
  r.design.toggle(ID)
  expect(r.state()).toBeUndefined()
  await flush()
  expect(r.evals).toEqual([])
  r.design.loaded(ID)
  expect(r.state()).toBeUndefined()
})

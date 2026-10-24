import { createJarvisStore, addLine } from '../store'
import { createOrbControl, type OrbApi } from './control'
import { LINGER_MS, type OrbState } from './show'

const settle = () => new Promise((r) => setTimeout(r, 0))

function setup(enabled: boolean | 'fails') {
  const store = createJarvisStore()
  const calls: (boolean | OrbState)[] = []
  let ready: (() => void) | undefined
  const api: OrbApi = {
    enabled: () => (enabled === 'fails' ? Promise.reject(new Error('jarvis.json: malformed')) : Promise.resolve(enabled)),
    show: async (show) => void calls.push(show),
    send: async (state) => void calls.push(state),
    onReady: async (cb) => {
      ready = cb
      return () => (ready = undefined)
    },
  }
  let t = 0
  const timers: { at: number; f: () => void }[] = []
  const control = createOrbControl({
    store,
    api,
    spoken: (s) => s,
    now: () => t,
    setTimer: (f, ms) => {
      const timer = { at: t + ms, f }
      timers.push(timer)
      return timer
    },
    clearTimer: (x) => {
      const i = timers.indexOf(x as (typeof timers)[number])
      if (i >= 0) timers.splice(i, 1)
    },
  })
  const advance = (ms: number) => {
    t += ms
    for (const timer of timers.filter((x) => x.at <= t)) {
      timers.splice(timers.indexOf(timer), 1)
      timer.f()
    }
  }
  return { store, calls, control, advance, ready: () => ready?.() }
}

test('a take does not open the panel while the orb is on', async () => {
  const { control } = setup(true)
  expect(control.opensPanel()).toBe(true)
  await settle()
  expect(control.opensPanel()).toBe(false)
})

test('with voice.orb false, or a config that will not read, a take opens the panel and no orb shows', async () => {
  for (const enabled of [false, 'fails'] as const) {
    const { store, calls, control } = setup(enabled)
    await settle()
    expect(control.opensPanel()).toBe(true)
    store.setState({ voice: 'listening' })
    expect(calls).toEqual([])
  }
})

test('the orb shows for a conversation, is told each look, and hides after the linger', async () => {
  const { store, calls, advance } = setup(true)
  await settle()
  store.setState({ voice: 'listening' })
  addLine(store, { who: 'you', text: 'oi James', spoken: true }, 0)
  store.setState({ voice: 'transcribing' })
  store.setState({ voice: 'idle', busy: true })
  addLine(store, { who: 'james', text: 'Olá.' }, 0)
  store.setState({ voice: 'speaking' })
  store.setState({ voice: 'idle', busy: false })
  expect(calls).toEqual([
    true,
    { look: 'listening', captions: [] },
    { look: 'listening', captions: [{ who: 'you', text: 'oi James', at: 0 }] },
    { look: 'thinking', captions: [{ who: 'you', text: 'oi James', at: 0 }] },
    // Busy and transcribing look the same: nothing new to send until James answers.
    { look: 'thinking', captions: [{ who: 'you', text: 'oi James', at: 0 }, { who: 'james', text: 'Olá.', at: 0 }] },
    { look: 'speaking', captions: [{ who: 'you', text: 'oi James', at: 0 }, { who: 'james', text: 'Olá.', at: 0 }] },
    { look: null, captions: [{ who: 'you', text: 'oi James', at: 0 }, { who: 'james', text: 'Olá.', at: 0 }] },
  ])
  calls.length = 0
  advance(LINGER_MS - 1)
  expect(calls).toEqual([])
  advance(1)
  expect(calls).toEqual([false])
})

test('a new take within the linger keeps the orb up', async () => {
  const { store, calls, advance } = setup(true)
  await settle()
  store.setState({ voice: 'listening' })
  store.setState({ voice: 'idle' })
  advance(LINGER_MS / 2)
  store.setState({ voice: 'listening' })
  advance(LINGER_MS)
  expect(calls.filter((c) => typeof c === 'boolean')).toEqual([true])
})

test('the orb’s page, once loaded, is sent the state it missed', async () => {
  const { store, calls, ready } = setup(true)
  await settle()
  store.setState({ voice: 'waiting' })
  calls.length = 0
  ready()
  expect(calls).toEqual([{ look: 'waiting', captions: [] }])
})

test('disposing hides a shown orb and stops following the store', async () => {
  const { store, calls, control } = setup(true)
  await settle()
  store.setState({ voice: 'speaking' })
  control.dispose()
  expect(calls.at(-1)).toBe(false)
  calls.length = 0
  store.setState({ voice: 'listening' })
  expect(calls).toEqual([])
})

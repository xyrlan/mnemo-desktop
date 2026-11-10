// What is drawn over the front, in the new identity: James's presence and panel, the
// notification stack, and dictation's indicator (docs/superpowers/specs/2026-11-10-recreation-front.md,
// "The overlays"). James's states are set in the page by `src/jarvis/panel/sheet.tsx`; the
// notifications are the agent events the core would send; dictation is its own action, run with
// a text field in focus.
//
// `src/jarvis/panel/shots/` keeps the pictures the piece's pull request showed: whole frames
// named `<scenario without next-overlays->-<width>.png`, and sheets cut from several of them
// (`panel-states`, `presence-states`, `dictation-states`; `orb-looks` and `orb-still` are the
// orb's own page, `orb.html`, which no scenario here opens).
//
//   for s in 2560x1440 1920x1080 1366x768; do
//     node tools/preview/shot.mjs --scenario next-overlays-james --size $s --out /tmp/james-$s.png
//   done
import { scenario } from '../scenario.mjs'
import { appIpc } from '../fixtures/app.mjs'
import { next as front, sessionTitled } from '../fixtures/next.mjs'

// The orb's own window is asked for whenever James listens or speaks: it is not in these pictures.
const ORB = { jarvis_orb: null }
const next = (route, ipc = {}) => front(route, { ...ORB, ...ipc })

const asking = sessionTitled('Order status history')
const webhook = sessionTitled('Webhook signature')
const bundle = sessionTitled('Why is the bundle')
const cursor = sessionTitled('Cursor pagination')

/** Run one of the sheet's exports in the page. */
const sheet = (page, fn, ...args) => page.evaluate(([f, a]) => import('/src/jarvis/panel/sheet.tsx').then((m) => m[f](...a)), [fn, args])

/** Run an action of the app, as its chord does. */
const act = (page, id) => page.evaluate((action) => import('/src/actions/registry.ts').then((m) => m.run(action)), id)

const console_ = { v: 'console', s: asking }

// ── James ──

// Closed: his presence docked in the corner, since the seam's top bar does not have him yet.
scenario('next-overlays-presence', { ...next(console_), drive: (page) => sheet(page, 'james', 'closed') })

// His presence where the frame's top bar will have it (the dock stands down), speaking, with an
// approval waiting; and every state it has.
scenario('next-overlays-presence-bar', {
  ...next(console_),
  drive: async (page) => {
    await sheet(page, 'james', 'speaking')
    await sheet(page, 'placeInTopBar')
  },
})
scenario('next-overlays-presence-states', { ...next(console_), drive: (page) => sheet(page, 'showPresences') })

// The panel: a conversation with a parent waiting on an approval, James listening (the orb
// turns); his researches while he thinks; a first run; the model's download; a voice failure.
for (const state of ['talk', 'research', 'first', 'download', 'failed']) {
  scenario(`next-overlays-james${state === 'talk' ? '' : `-${state}`}`, { ...next(console_), drive: (page) => sheet(page, 'james', state) })
}

// Stilled by the frame's switch: the orb is its first frame, and nothing turns.
scenario('next-overlays-james-still', {
  ...next(console_),
  drive: async (page) => {
    await page.evaluate(() => document.querySelector('.mn[data-view]').setAttribute('data-motion', 'reduced'))
    await sheet(page, 'james', 'talk')
  },
})

// ── notifications ──

const agentEvent = (sessionId, cwd, kind, message, afterMs) => ({
  event: 'agent://event',
  payload: { sessionId, cwd, kind, at: Date.parse('2026-11-10T12:00:00Z') + afterMs, ...(message ? { message } : {}) },
  afterMs,
})

// Sessions of the sample world finishing and asking while another is on stage: one card each,
// newest at the top, named by the world's own titles.
const NOTES = [
  agentEvent(bundle, '/Users/preview/work/lumen-web', 'stop', null, 1500),
  agentEvent(cursor, '/Users/preview/work/atlas-api-wt-cursor', 'stop', null, 1600),
  agentEvent(webhook, '/Users/preview/work/atlas-api-wt-webhook', 'notification', 'Claude needs your permission to use Bash: cargo test -p webhooks signature', 1700),
  agentEvent(asking, '/Users/preview/work/atlas-api', 'notification', 'Claude has a question: should the status history be backfilled online or in a maintenance window?', 1800),
]
const notes = (route) => ({ ...next(route, { agent_notify: null }), events: NOTES })

scenario('next-overlays-notes', notes({ v: 'console', s: sessionTitled('Design the plugin manifest') }))

// A card whose session the world does not have: its click opened nothing, and it says so.
scenario('next-overlays-notes-unopened', {
  ...next(console_, { agent_notify: null }),
  events: [agentEvent('7b1d9c02-0000-4000-8000-000000000000', '/Users/preview/work/harbor-cli-wt-docs', 'stop', null, 1500)],
  drive: (page) => page.locator('.note-open').click(),
})

// ── dictation ──

const VOICE = { voice_start: 'Studio Microphone', voice_stop: 'online, but pause it during the nightly export', voice_set_language: null, mission_translate: ({ text }) => text }

/** Dictate into the waiting card's "in your words": the field that has focus is where it types. */
const dictate = async (page) => {
  await page.getByRole('region', { name: 'Transcript' }).locator('.pending-own').click()
  await act(page, 'dictation.toggle')
}

scenario('next-overlays-dictation', { ...next(console_, VOICE), drive: dictate })
scenario('next-overlays-dictation-done', {
  ...next(console_, VOICE),
  drive: async (page) => {
    await dictate(page)
    await page.waitForSelector('[data-testid="dictation-indicator"][data-phase="listening"]')
    await act(page, 'dictation.toggle')
  },
})
scenario('next-overlays-dictation-error', {
  ...next(console_, {
    ...VOICE,
    voice_start: () => {
      throw new Error('microphone Studio Microphone: failed to initialize the audio client: the audio endpoint device has been unplugged')
    },
  }),
  drive: dictate,
})
// The first take waits for the speech model, which is on its way down.
scenario('next-overlays-dictation-download', {
  ...next(console_, { ...VOICE, voice_stop: () => new Promise(() => {}) }),
  drive: async (page) => {
    await dictate(page)
    await page.waitForSelector('[data-testid="dictation-indicator"][data-phase="listening"]')
    await act(page, 'dictation.toggle')
    await page.evaluate(() => window.__previewEmit('voice://progress', { downloaded: 61_000_000, total: 148_000_000 }))
  },
})

// ── together ──

// Everything at once, so the layers are seen: the panel, the cards beside it, the indicator.
scenario('next-overlays-together', {
  ...next(console_, { ...VOICE, agent_notify: null }),
  events: NOTES,
  drive: async (page) => {
    await dictate(page)
    await sheet(page, 'james', 'talk')
  },
})

// Under the ship (the flag off) the overlays wear the same identity: James docked in the corner,
// the cards, and the panel over the Nexus.
const ship = { ipc: appIpc({ ...ORB, agent_notify: null }), events: [NOTES[1], NOTES[2]] }
scenario('next-overlays-ship', { ...ship, drive: (page) => sheet(page, 'james', 'closed') })
scenario('next-overlays-ship-james', { ...ship, drive: (page) => sheet(page, 'james', 'talk') })

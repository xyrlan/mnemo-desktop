// Score's states on the synthetic world (src/score/). The day with nothing selected is
// `next-score-day`; the others select a line, hold the playhead, zoom, fold and answer.
// Shoot each at 2560x1440, 1920x1080 and 1366x768.
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const at = (iso) => String(Date.parse(iso))
/** The score's own state from a last run: `span=2h`, `fold=<parent id>,…` (src/score/state.ts). */
const kept = (route, score) => {
  const setup = next(route)
  return { ...setup, storage: { ...setup.storage, 'mnemo.score': new URLSearchParams(score).toString() } }
}

const retries = sessionTitled('Idempotent retries')
const orders = sessionTitled('Order status history')
const optimistic = sessionTitled('Optimistic updates')
const release = sessionTitled('Release 2.4 checklist')

// The day: every line, nothing selected, twelve hours ending now.
scenario('next-score-day', next({ v: 'score' }))

// A waiting question, open where its line meets now, with the instruments beside it.
scenario('next-score-waiting', next({ v: 'score', s: orders }))

// The playhead held three hours back: the now column replays, the instruments read that moment.
scenario('next-score-replay', next({ v: 'score', s: retries, at: at('2026-11-09T18:20:00Z'), r: 'memory' }))

// The same held playhead on a line that waits now: the card stands back until now.
scenario('next-score-replay-waiting', next({ v: 'score', s: orders, at: at('2026-11-09T20:30:00Z') }))

// Two hours: every tool call on its own, as long as it took.
scenario('next-score-two-hours', kept({ v: 'score', s: optimistic }, { span: '2h' }))

// Two days: yesterday's line comes into view.
scenario('next-score-two-days', kept({ v: 'score' }, { span: '48h' }))

// A parent's ended child folded into its ensemble lane.
scenario('next-score-folded', kept({ v: 'score', s: release }, { fold: release }))

// Moved through time with the keys: three steps back, then zoomed in around the playhead.
scenario('next-score-keys', {
  ...next({ v: 'score', s: optimistic }),
  drive: async (page) => {
    await page.locator('section.score').focus()
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', '+']) await page.keyboard.press(key)
  },
})

// The question answered at its line: the session goes back to work and the lines re-order.
scenario('next-score-answered', {
  ...next({ v: 'score', s: orders }),
  drive: async (page) => {
    await page.getByRole('button', { name: /Online, in batches/ }).click()
  },
})

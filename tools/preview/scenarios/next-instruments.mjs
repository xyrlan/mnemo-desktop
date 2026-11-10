// The instruments (src/instruments) on the synthetic world: every state worth looking at.
//
//   node tools/preview/shot.mjs --scenario next-instruments-memory --out /tmp/memory.png --size 2560x1440
//
// The seam's frame gives the instruments a 30em column and never a moment. Until the frame
// and the score land, two scenarios make the room themselves: `column` widens Console's
// third column, and `beside` stands the instruments beside the score at a past moment
// (src/instruments/bench.tsx, which only this file loads).
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const retries = sessionTitled('Idempotent retries') // a parent with children, sub-agents, a compaction, pages and shots
const pagination = sessionTitled('Cursor pagination') // a child: a cost line, a pull request, its place in the tree
const contrast = sessionTitled('Dark theme contrast') // 83% full
const roadmap = sessionTitled('Notes for the 2.5 roadmap') // nearly nothing: what the readings say when lists are empty

/** Console's third column, `em` wide: the room the frame piece gives at 2560. */
const column = (em) => (page) => page.addStyleTag({ content: `.mn[data-view='console'] main > div { grid-template-columns: 24em minmax(0, 1fr) ${em}em !important; }` })

/** The instruments beside the score, reading `minutesAgo` before the world's now. */
const beside = (minutesAgo) => (page) =>
  page.evaluate((ago) => import('/src/instruments/bench.tsx').then((bench) => bench.stand({ minutesAgo: ago })), minutesAgo)

// One at a time, under three headers with their numbers: the column as the seam gives it.
scenario('next-instruments-context', next({ v: 'console', s: retries }))
scenario('next-instruments-memory', next({ v: 'console', s: retries, r: 'memory' }))
scenario('next-instruments-sight', next({ v: 'console', s: retries, r: 'sight' }))

// All three at once: context over sight beside memory at 61em, three across from 84em.
scenario('next-instruments-pair', { ...next({ v: 'console', s: retries }), drive: column(61) })
scenario('next-instruments-three', { ...next({ v: 'console', s: retries }), drive: column(90) })

// A screenshot the session took, opened large.
scenario('next-instruments-shot', {
  ...next({ v: 'console', s: retries, r: 'sight' }),
  drive: async (page) => {
    await page.locator('.instruments-shot').first().click()
  },
})

// Other sessions: a child with a cost line and a pull request, one nearly full, one with little.
scenario('next-instruments-child', next({ v: 'console', s: pagination }))
scenario('next-instruments-child-sight', next({ v: 'console', s: pagination, r: 'sight' }))
scenario('next-instruments-hot', next({ v: 'console', s: contrast }))
scenario('next-instruments-quiet', next({ v: 'console', s: roadmap, r: 'memory' }))
scenario('next-instruments-quiet-sight', next({ v: 'console', s: roadmap, r: 'sight' }))

// A past moment (Score's playhead): three hours ago, before its compaction, and forty minutes
// ago, between its pages. What had not happened yet is dimmed.
scenario('next-instruments-at-context', { ...next({ v: 'score', s: retries }), drive: beside(180) })
scenario('next-instruments-at-memory', { ...next({ v: 'score', s: retries, r: 'memory' }), drive: beside(180) })
scenario('next-instruments-at-sight', { ...next({ v: 'score', s: retries, r: 'sight' }), drive: beside(40) })

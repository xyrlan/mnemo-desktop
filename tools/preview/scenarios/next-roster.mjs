// The roster's states on the synthetic world (src/roster). Shoot each at 2560x1440, 1920x1080
// and 1366x768: the roster is drawn at the first of four densities that fits its height, so the
// same state is a different drawing at each size.
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const on = (title, route = {}) => next({ v: 'console', s: sessionTitled(title), ...route })
const byProject = (setup) => ({ ...setup, storage: { ...setup.storage, 'mnemo.roster.group': 'project' } })

// A parent on stage with its four children under it, three of them waiting: each waiting item
// is one line under its session.
scenario('next-roster', on('Idempotent retries'))

// The session on stage is the one that asks: its question is open under it.
scenario('next-roster-question', on('Order status history'))

// A child on stage: the beam is on the child, its permission open under it.
scenario('next-roster-child', on('Webhook signature check'))

// `G`: the same sessions, project by project.
scenario('next-roster-project', byProject(on('Idempotent retries')))

// An ended child on stage: it is drawn in its family, where a quiet family keeps it behind
// its count.
scenario('next-roster-ended', on('Shell completions for fish'))

// `G` pressed with the focus in the roster, from the state above it.
scenario('next-roster-key', {
  ...on('Why is the bundle'),
  drive: async (page) => {
    await page.locator('[data-roster] [data-sel]').focus()
    await page.keyboard.press('g')
  },
})

// Everything answered: each waiting line is chosen, then the first choice of its card, until
// nothing waits. The families move down to where their new states put them.
scenario('next-roster-answered', {
  ...on('Idempotent retries'),
  drive: async (page) => {
    for (let i = 0; i < 8; i++) {
      const line = page.locator('[data-roster] [data-wait]').first()
      if (await line.count()) await line.click()
      const choice = page.locator('[data-roster] .roster-card button').first()
      if (!(await choice.count())) break
      await choice.click()
      await page.waitForTimeout(60)
    }
    // the pointer rests on no row
    await page.mouse.move(0, 0)
  },
})

// A fleet the size of a working day: 18 parents and 40 sessions, grown from the sample's own
// (the extra ones are the sample's again under invented names). What the densities are for.
const MORE = [
  ['Rate limit the export endpoint', 'atlas-api'],
  ['Invoice PDF renders blank on Safari', 'lumen-web'],
  ['Move the job queue off cron', 'atlas-api'],
  ['Keyboard shortcuts for the orders table', 'lumen-web'],
  ['Changelog for 2.4', 'harbor-cli'],
  ['Plugin sandbox permissions', 'tessera'],
  ['Slow first paint on the dashboard', 'lumen-web'],
  ['Audit log for admin actions', 'atlas-api'],
  ['Windows installer signing', 'harbor-cli'],
]
const KIDS = ['Backfill script for the new column', 'Tests for the retry path', 'Docs for the new flag', 'Benchmark before and after', 'Feature flag and rollout plan', 'Types for the public client', 'Migration dry run on a copy', 'Error copy for the empty state', 'Telemetry for the slow path', 'Fixture for the snapshot test', 'Changelog entry', 'Lint rule for the old import', 'Cache key audit', 'Screenshot pass at three sizes', 'Rollback note', 'Follow-up issue list']
const STATES = ['working', 'idle', 'idle', 'ended', 'idle', 'working', 'ended', 'idle', 'ended']

async function crowd(page) {
  await page.evaluate(
    async ({ more, kids, states }) => {
      const { worldStore } = await import('/src/world/store.ts')
      const world = worldStore.getState().world
      const id = (n) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
      const parents = world.sessions.filter((s) => s.role === 'parent')
      const children = world.sessions.filter((s) => s.role === 'child')
      const sessions = [...world.sessions]
      let k = 0
      more.forEach(([title, project], i) => {
        const from = parents[i % parents.length]
        const mine = id(0xa000 + i)
        const state = states[i]
        // the working ones dispatched children; an ended one keeps its ended children
        const n = state === 'working' ? 4 : state === 'ended' ? 2 : i % 3 === 0 ? 2 : 0
        const own = []
        for (let j = 0; j < n && k < kids.length; j++, k++) {
          const like = children[k % children.length]
          const kid = id(0xb000 + k)
          const kidState = state === 'ended' ? 'ended' : j === 0 ? 'working' : j === 1 ? 'ended' : 'idle'
          sessions.push({ ...like, id: kid, short: kid.slice(0, 8), title: kids[k], project, parent: mine, state: kidState, live: kidState !== 'ended', lastAt: world.at - (k + 2) * 240000 })
          own.push(kid)
        }
        // only a working session has a call still running
        const activity = state === 'working' ? from.activity : from.activity.map((a) => ({ ...a, running: false }))
        sessions.push({ ...from, id: mine, short: mine.slice(0, 8), title, project, state, live: state !== 'ended', children: own, activity, lastAt: world.at - (i + 1) * 660000 })
      })
      worldStore.getState().set({ ...world, sessions })
    },
    { more: MORE, kids: KIDS, states: STATES },
  )
}

scenario('next-roster-crowded', { ...on('Idempotent retries'), drive: crowd })
scenario('next-roster-crowded-project', { ...byProject(on('Idempotent retries')), drive: crowd })
// The same fleet with a quiet session at the foot of the list on stage: the list has followed
// it, and the ended parents under it share one line.
scenario('next-roster-crowded-foot', {
  ...on('Notes for the 2.5'),
  drive: async (page) => {
    await crowd(page)
    // he scrolls to the very foot
    await page.locator('.roster-scroll').evaluate((el) => (el.scrollTop = el.scrollHeight))
  },
})

// The column as the Console prototype sizes it (39, 33 and 26 root sizes wide): the seam's
// frame gives the roster 24, and the frame piece chooses the real width. From 30 the roster
// lays the state beside the title.
const columns = async (page) => {
  await page.addStyleTag({
    content: `.mn[data-view='console'] main > div { grid-template-columns: 26em minmax(0, 1fr) 26.5em !important; }
      @media (min-width: 1600px) { .mn[data-view='console'] main > div { grid-template-columns: 33em minmax(0, 1fr) 34em !important; } }
      @media (min-width: 2300px) { .mn[data-view='console'] main > div { grid-template-columns: 39em minmax(0, 1fr) 61em !important; } }`,
  })
}
scenario('next-roster-columns', { ...on('Idempotent retries'), drive: columns })
scenario('next-roster-columns-question', { ...on('Order status history'), drive: columns })
scenario('next-roster-columns-crowded', {
  ...on('Idempotent retries'),
  drive: async (page) => {
    await columns(page)
    await crowd(page)
  },
})

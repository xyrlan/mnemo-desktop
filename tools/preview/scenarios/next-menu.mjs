// The menu on a session, a project's name, a held terminal (src/menu;
// docs/superpowers/specs/2026-11-10-session-menu.md), one scenario per state worth looking at,
// on the synthetic world: its actions are the sample's, so nothing leaves the page. Every name,
// prompt and path is invented.
//
//   next-menu               a session the app hosts, right-clicked in the roster: the stage does not move
//   next-menu-child         a child that runs and waits: Answer…, Stop, Message…
//   next-menu-merge         a child whose pull request is green: Open pull request, Merge
//   next-menu-merge-wait    the same with its checks still running: Merge is there, off, and says why
//   next-menu-asked         Close session, asked once on the same item
//   next-menu-refused       a refusal, in the words the action gave; the menu stays
//   next-menu-message       Message…: the line typed in the menu
//   next-menu-copy          Copy, a row of three
//   next-menu-outside       a session another terminal runs: Close is off, "runs outside this app"
//   next-menu-ended         an ended session the maintainer talked to: Resume here
//   next-menu-said          an item was chosen: the menu is gone and the foot says what came of it
//   next-menu-project       a project's name, at the roster's group head
//   next-menu-key           `M` with the keys on the stage: the menu stands under the stage's head
//   next-menu-chip          a family tab on the stage
//   next-menu-edge          opened at the window's corner: all of it stays inside
//   next-menu-terminal      a terminal listed under Terminals
//   next-menu-orbit         a body in Orbit
//   next-menu-orbit-moon    a moon in Orbit
//   next-menu-orbit-key     `M` in Orbit: the menu stands at the selected body
//   next-menu-orbit-project a project's name on Orbit's rim
//   next-menu-score         a line in Score (the canvas), away from its card
//   next-menu-score-card    a line's card in Score
//
//   for s in 2560x1440 1920x1080 1366x768; do
//     node tools/preview/shot.mjs --scenario next-menu --size $s --out docs/superpowers/shots/menu/session-${s%x*}.png
//   done
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const billing = sessionTitled('Idempotent retries')
const bundle = sessionTitled('Why is the bundle')
const webhook = sessionTitled('Webhook signature check')
const cursor = sessionTitled('Cursor pagination')
const empty = sessionTitled('Empty state for the orders table')
const tenant = sessionTitled('Tenant in every cache key')
const roadmap = sessionTitled('Notes for the 2.5')
const history = sessionTitled('Order status history')

const console_ = (s = billing) => next({ v: 'console', s })
const byProject = (setup) => ({ ...setup, storage: { ...setup.storage, 'mnemo.roster.group': 'project' } })

/** A right-click on the first thing that matches. */
const rightClick = (page, selector) => page.locator(selector).first().click({ button: 'right' })
const inRoster = (id) => `[data-roster] .roster-list [data-menu="session:${id}"]`
const item = (id) => `[data-menu-root] [data-menu-item="${id}"]`

/** Changes the sample world in the page: `change` gets the world and returns the next one. */
const patchWorld = (page, change, arg) =>
  page.evaluate(
    async ({ source, arg }) => {
      const { worldStore } = await import('/src/world/store.ts')
      const next = new Function('world', 'arg', `return (${source})(world, arg)`)(worldStore.getState().world, arg)
      worldStore.getState().set(next)
    },
    { source: change.toString(), arg },
  )

scenario('next-menu', { ...console_(), drive: (page) => rightClick(page, inRoster(bundle)) })

scenario('next-menu-child', { ...console_(), drive: (page) => rightClick(page, inRoster(webhook)) })

scenario('next-menu-merge', { ...console_(), drive: (page) => rightClick(page, inRoster(cursor)) })

scenario('next-menu-merge-wait', { ...console_(sessionTitled('Optimistic updates')), drive: (page) => rightClick(page, inRoster(empty)) })

scenario('next-menu-asked', {
  ...console_(),
  drive: async (page) => {
    await rightClick(page, inRoster(bundle))
    await page.click(item('close'))
  },
})

scenario('next-menu-refused', {
  ...console_(),
  drive: async (page) => {
    await page.evaluate(async () => {
      const { actions, setActions } = await import('/src/world/actions.ts')
      setActions({ ...actions(), stop: async () => ({ ok: false, why: 'Not stopped: it is in the middle of a commit. Try again when the commit is made.' }) })
    })
    await rightClick(page, inRoster(tenant))
    await page.click(item('stop'))
    await page.click(item('stop'))
  },
})

scenario('next-menu-message', {
  ...console_(),
  drive: async (page) => {
    await rightClick(page, inRoster(tenant))
    await page.keyboard.press('m')
    await page.keyboard.type('keep the old key readable for one release')
  },
})

scenario('next-menu-copy', {
  ...console_(),
  drive: async (page) => {
    await rightClick(page, inRoster(bundle))
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
  },
})

scenario('next-menu-outside', {
  ...console_(),
  drive: async (page) => {
    await patchWorld(page, (world, id) => ({ ...world, sessions: world.sessions.map((s) => (s.id === id ? { ...s, hosted: false } : s)) }), bundle)
    await rightClick(page, inRoster(bundle))
  },
})

scenario('next-menu-ended', {
  ...console_(),
  drive: async (page) => {
    await patchWorld(page, (world, id) => ({ ...world, sessions: world.sessions.map((s) => (s.id === id ? { ...s, state: 'ended', live: false, hosted: false } : s)) }), roadmap)
    await rightClick(page, inRoster(roadmap))
  },
})

scenario('next-menu-said', {
  ...console_(),
  drive: async (page) => {
    await rightClick(page, inRoster(bundle))
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    // the pointer rests on no row
    await page.mouse.move(0, 0)
  },
})

scenario('next-menu-project', { ...byProject(console_()), drive: (page) => rightClick(page, '[data-roster] [data-menu="project:lumen-web"]') })

scenario('next-menu-key', {
  ...console_(history),
  drive: async (page) => {
    await page.locator('[data-stage]').focus()
    await page.keyboard.press('m')
  },
})

scenario('next-menu-chip', { ...console_(), drive: (page) => rightClick(page, `[data-stage] .stage-chip[data-menu="session:${webhook}"]`) })

scenario('next-menu-edge', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    // Asked for three pixels from the window's corner, as a right-click there would: all of it
    // stays inside the window.
    const size = page.viewportSize()
    await page.evaluate(async (id) => {
      const { openMenu } = await import('/src/menu/index.ts')
      openMenu({ kind: 'session', id }, { x: window.innerWidth - 3, y: window.innerHeight - 3 })
    }, cursor)
    await page.mouse.move(size.width - 3, size.height - 3)
  },
})

scenario('next-menu-terminal', {
  ...console_(),
  drive: async (page) => {
    // Only a live world holds a terminal that is no session: here the page is told of one.
    await page.evaluate(async () => {
      const { runtimeStore } = await import('/src/runtime/current.ts')
      const hosted = [{ id: 'tab-7', kind: 'session', label: '', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 7 }]
      runtimeStore.setState({ runtime: { canHost: () => false, Terminal: () => null, hosted: () => hosted, subscribe: () => () => {}, focus: () => false } })
    })
    await rightClick(page, '[data-roster] [data-menu="terminal:tab-7"]')
  },
})

scenario('next-menu-orbit', { ...next({ v: 'orbit' }), drive: (page) => rightClick(page, `.orbit-lab[data-menu="session:${billing}"]`) })

scenario('next-menu-orbit-moon', { ...next({ v: 'orbit' }), drive: (page) => page.locator(`.orbit-moon[data-menu="session:${webhook}"]`).first().dispatchEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 2 }) })

scenario('next-menu-orbit-key', {
  ...next({ v: 'orbit', s: history }),
  drive: async (page) => {
    await page.locator('.orbit').focus()
    await page.keyboard.press('m')
  },
})

scenario('next-menu-orbit-project', { ...next({ v: 'orbit' }), drive: (page) => rightClick(page, '.orbit-chart [data-menu="project:harbor-cli"] text') })

scenario('next-menu-score', {
  ...next({ v: 'score' }),
  drive: async (page) => {
    // On the line itself, well left of its card: the canvas knows whose row it is.
    const card = await page.locator(`[data-score-card="${billing}"]`).boundingBox()
    const canvas = await page.locator('.score-canvas').boundingBox()
    await page.mouse.click(canvas.x + canvas.width * 0.45, card.y + card.height / 2, { button: 'right' })
  },
})

scenario('next-menu-score-card', { ...next({ v: 'score', s: billing }), drive: (page) => rightClick(page, `[data-score-card="${webhook}"]`) })

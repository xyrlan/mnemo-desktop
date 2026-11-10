// Orbit's states on the synthetic world (src/orbit/). `next-orbit` itself, the scene at
// rest, is in next.mjs. Shoot each at 2560x1440, 1920x1080 and 1366x768.
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

/** The id of what waits on a sample session, as src/world/capture.ts names it. */
const waitingOn = (text, kind) => `${sessionTitled(text)}:${kind}`

// The cursor on a body: the fleet's selection, four corners round it and its moons.
scenario('next-orbit-cursor', next({ v: 'orbit', s: sessionTitled('Why is the bundle') }))

// A question open on its own body, its choices as digits.
scenario('next-orbit-card', next({ v: 'orbit', s: sessionTitled('Order status history'), p: waitingOn('Order status history', 'question') }))

// A child's permission open on its family's body: the moon that asks is lit.
scenario('next-orbit-card-child', next({ v: 'orbit', s: sessionTitled('Webhook signature check'), p: waitingOn('Webhook signature check', 'permission') }))

// A merge that waits, on a body in the left half: the card grows the other way.
scenario('next-orbit-card-merge', next({ v: 'orbit', s: sessionTitled('Empty state for the orders'), p: waitingOn('Empty state for the orders', 'merge') }))

// Arrow keys: from nothing to the body that asks loudest, then two neighbours on.
scenario('next-orbit-keys', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft']) await page.keyboard.press(key)
  },
})

// The centre opened: what the vault holds and what mnemo did.
scenario('next-orbit-vault', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    await page.keyboard.press('Home')
    await page.waitForTimeout(900)
  },
})

// The cursor on the centre, before it is opened.
scenario('next-orbit-centre', {
  ...next({ v: 'orbit', s: sessionTitled('Order status history') }),
  drive: async (page) => {
    await page.keyboard.press('ArrowLeft')
  },
})

// Typing finds a session: the matches stay lit in the scene.
scenario('next-orbit-finder', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    await page.keyboard.type('orders')
    await page.keyboard.press('ArrowDown')
  },
})

// A rule on its way from a node of the lattice to the session it was handed to. The mote
// is held still part of the way, since a shot would otherwise catch it anywhere or nowhere.
scenario('next-orbit-mote', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    await page.waitForSelector('.orbit-mote', { state: 'attached', timeout: 8000 })
    await page.evaluate(() => {
      for (const a of document.querySelector('.orbit-motes').getAnimations({ subtree: true })) {
        a.pause()
        a.currentTime = Number(a.effect.getComputedTiming().duration) * 0.45
      }
    })
  },
})

// Everything answered: the band's light is out and its name says so.
scenario('next-orbit-settled', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    for (let i = 0; i < 8; i++) {
      const want = page.locator('.orbit-lab-want').first()
      if (!(await want.count())) break
      await want.click()
      await page.locator('[data-orbit-card] button').first().click()
      await page.waitForTimeout(250)
    }
    // the ring that crosses the scene once has gone by the time of the shot
    await page.waitForTimeout(2400)
  },
})

// Motion reduced: the loops and the travel stop, the state stays in shape, word and place.
scenario('next-orbit-reduced', {
  ...next({ v: 'orbit', s: sessionTitled('Order status history') }),
  drive: async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  },
})

// The scene small, at the head of the roster, with the family of the session on stage lit
// (here a child: its moon carries the ring).
scenario('next-orbit-map', next({ v: 'console', s: sessionTitled('Webhook signature check') }))

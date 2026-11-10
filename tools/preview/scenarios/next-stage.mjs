// The stage (src/stage/): Console's middle column, in every state worth looking at. All on
// the synthetic world; the terminal here is the transcript drawn from it, since nothing
// hosts a session in a preview.
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const on = (title, route = {}) => next({ v: 'console', s: sessionTitled(title), ...route })
const reply = '[data-stage-reply]'
// An entrance is over well inside this; the shot is of the state, not of the way into it.
const SETTLED = 900

// A parent at work: a family of five across the top, a call still running.
scenario('next-stage', on('Idempotent retries'))
// A question waits: its card closes the transcript, and the box under it answers in words.
scenario('next-stage-question', on('Order status history'))
// A child that waits on a permission: whose child it is, what it was sent to do.
scenario('next-stage-permission', on('Webhook signature check'))
// A child that stalled after a dozen calls: a short transcript stands on the floor.
scenario('next-stage-stalled', on('Forward-only migration'))
// A child that is over with its pull request open.
scenario('next-stage-merge', on('Cursor pagination'))
// A parent whose turn it is, 260 calls in: only the newest are drawn.
scenario('next-stage-idle', on('Optimistic updates'))
// A child that ended, beside its parent.
scenario('next-stage-ended', on('Shell completions'))
// A session with no family and little history.
scenario('next-stage-quiet', on('Notes for the 2.5 roadmap'))
// The terminal has the room: the head folds and the pulse goes.
scenario('next-stage-wide', on('Idempotent retries', { wide: '1' }))
// Nothing on stage.
scenario('next-stage-empty', next({ v: 'console' }))

// Right walks the family: the first child takes the stage, and the focus goes with it.
scenario('next-stage-walked', {
  ...on('Idempotent retries'),
  drive: async (page) => {
    await page.locator('.stage-chip[aria-current="true"]').focus()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(SETTLED)
  },
})

// Enter puts the keys in the reply box; words are being typed.
scenario('next-stage-typing', {
  ...on('Idempotent retries'),
  drive: async (page) => {
    await page.locator('[data-stage]').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.type('keep the old handler behind a flag until Friday')
  },
})

// The words were sent: they stand in the transcript, and the session works on them.
scenario('next-stage-said', {
  ...on('Order status history'),
  drive: async (page) => {
    await page.locator(reply).fill('online, in batches, and pause it if the replica lags')
    await page.keyboard.press('Enter')
    await page.locator('[data-stage]').focus()
  },
})

// The session would not take the words: why is said under the box, and the words stay in it.
scenario('next-stage-refused', {
  ...on('Dark theme contrast'),
  drive: async (page) => {
    await page.evaluate(async () => {
      const { actions, setActions } = await import('/src/world/actions.ts')
      setActions({ ...actions(), reply: async () => ({ ok: false, why: 'Its input box holds a draft: nothing was typed over it.' }) })
    })
    await page.locator(reply).fill('ship the two charts as they are')
    await page.keyboard.press('Enter')
  },
})

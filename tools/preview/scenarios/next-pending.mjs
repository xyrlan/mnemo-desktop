// What waits, in the new front: the card where the seam's roster lists it, and the sheet of
// every state the card and the top bar's count have (src/pending/sheet.tsx).
//
// `src/pending/shots/` keeps the pictures the piece's pull request showed, named
// `<scenario without next-pending->-<width>.png`.
//
//   for s in 2560x1440 1920x1080 1366x768; do
//     node tools/preview/shot.mjs --scenario next-pending-sheet-kinds --size $s --out /tmp/kinds-$s.png
//   done
import { scenario } from '../scenario.mjs'
import { next, sessions, sessionTitled } from '../fixtures/next.mjs'

const asking = sessionTitled('Order status history')
const child = (title) => sessions.find((s) => s.role === 'child' && s.title.startsWith(title)).id

/** A waiting item's id in the sample world. */
const item = (session, kind) => `${session}:${kind}`

/** Run one of the sheet's exports in the page. */
const sheet = (page, fn, ...args) => page.evaluate(([f, a]) => import('/src/pending/sheet.tsx').then((m) => m[f](...a)), [fn, args])

const choice = (page, n) => page.locator('[data-armed] .pending-choice').nth(n - 1)

// In place: the item armed because its session is selected, and because its card was opened.
scenario('next-pending-question', next({ v: 'console', s: asking }))
scenario('next-pending-permission', next({ v: 'console', s: asking, p: item(child('Webhook signature'), 'permission') }))
scenario('next-pending-merge', next({ v: 'console', s: asking, p: item(child('Empty state'), 'merge') }))

// "In your words": the key's button, then a sentence.
scenario('next-pending-words', {
  ...next({ v: 'console', s: asking }),
  drive: async (page) => {
    await page.locator('[data-armed] .pending-own').click()
    await page.keyboard.type('Online, but pause it during the nightly export.')
  },
})

// A refusal is said on the card, and the choices stay.
scenario('next-pending-refused', {
  ...next({ v: 'console', s: asking }),
  drive: async (page) => {
    await sheet(page, 'refuseAnswers', 'The prompt on screen is not the one this card shows. Open the session to answer it.')
    await choice(page, 1).click()
    await page.locator('[data-armed] [role="alert"]').scrollIntoViewIfNeeded()
  },
})

// An answer the world has not caught up with: the card is settled and takes no second digit.
scenario('next-pending-settled', {
  ...next({ v: 'console', s: asking }),
  drive: async (page) => {
    await sheet(page, 'keepAnswered')
    await choice(page, 2).click()
  },
})

// An answer in the sample world: the item is gone and its session is working.
scenario('next-pending-answered', {
  ...next({ v: 'console', s: asking }),
  drive: async (page) => {
    await choice(page, 1).click()
  },
})

// The sheet: every kind at the widths the views give it, every state, and the count (five wait,
// the armed one lit; then one opened by its card; then none).
for (const name of ['kinds', 'foot', 'words']) scenario(`next-pending-sheet-${name}`, { ...next({ v: 'console', s: asking }), drive: (page) => sheet(page, 'showSheet', name) })
scenario('next-pending-sheet-answers', { ...next({ v: 'console', s: asking, p: item(child('Forward-only'), 'stalled') }), drive: (page) => sheet(page, 'showSheet', 'answers') })
scenario('next-pending-sheet-clear', {
  ...next({ v: 'console', s: asking }),
  drive: async (page) => {
    await sheet(page, 'answerAll')
    await sheet(page, 'showSheet', 'kinds')
  },
})

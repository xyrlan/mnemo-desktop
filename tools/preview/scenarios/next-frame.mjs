// The frame's own states on the synthetic world: the top bar over each view, Console's columns
// and `wide`, the command line (offers, a whole line, a batch asked about, what a command said),
// the key sheet, and the line that says what the world could not read.
//
//   for s in 2560x1440 1920x1080 1366x768; do
//     node tools/preview/shot.mjs --scenario next-frame-console --size $s --out /tmp/frame-console-$s.png
//   done
import { scenario } from '../scenario.mjs'
import { next, sessionTitled } from '../fixtures/next.mjs'

const billing = sessionTitled('Idempotent retries')
const console_ = { v: 'console', s: billing }

/** Opens the command line and types `text`, then presses `keys`. */
const typed =
  (text, ...keys) =>
  async (page) => {
    await page.keyboard.press(';')
    await page.keyboard.type(text)
    for (const k of keys) await page.keyboard.press(k)
  }

scenario('next-frame-orbit', next({ v: 'orbit' }))
scenario('next-frame-console', next(console_))
scenario('next-frame-wide', next({ ...console_, wide: '1' }))
scenario('next-frame-score', next({ v: 'score', s: billing }))

// The line as it opens: every verb. Then a few letters: the verbs they start, and the sessions
// they find.
scenario('next-frame-command', { ...next(console_), drive: typed('') })
scenario('next-frame-command-find', { ...next(console_), drive: typed('or') })
// A whole line: what Enter will do, with its options read back.
scenario('next-frame-command-dispatch', { ...next(console_), drive: typed('dispatch atlas-api #12 #14 model=opus-5.5 effort=high may=pr') })
// A batch verb is asked about before it runs.
scenario('next-frame-command-confirm', { ...next(console_), drive: typed('stop all', 'Enter') })
// What a command came to, beside the closed line.
scenario('next-frame-command-said', { ...next(console_), drive: typed('merge green', 'Enter', 'Enter') })
// A line that cannot run says why.
scenario('next-frame-command-refused', { ...next(console_), drive: typed('message nobody hello') })

scenario('next-frame-keys', {
  ...next(console_),
  drive: async (page) => {
    await page.keyboard.press('?')
  },
})

// What the world could not read. The sample reads everything, so the scenario says two things
// were not, the way the live world would.
scenario('next-frame-unread', {
  ...next({ v: 'orbit' }),
  drive: async (page) => {
    await page.evaluate(async () => {
      const { worldStore } = await import('/src/world/store.ts')
      const { world, set } = worldStore.getState()
      set({ ...world, errors: ['Plan usage for the account "second": the sign-in expired.', 'Memory trail: this build of mnemo does not answer it yet.'] })
    })
  },
})

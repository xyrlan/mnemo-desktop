// The design system's gallery (src/ds/Gallery.tsx): every primitive in every state, on the
// synthetic world, one scenario per page. Shoot each at 2560x1440, 1920x1080 and 1366x768.
//
//   next-ds            identity: the lattice with a node lit, the mark, the type, the ground
//   next-ds-sessions   the state marks, the figures, keys, labels, pills
//   next-ds-readings   meters, rings, the context curve, spent by kind, a full value, empty lines
//   next-ds-still      the sessions page with motion reduced: every mark at rest
//   next-ds-open       the readings page with a cut value opened from the keyboard
import { scenario } from '../scenario.mjs'
import { next } from '../fixtures/next.mjs'

/** The gallery at `page`, over the new front on the sample world. */
function gallery(page, more = {}) {
  const setup = next()
  return { ...setup, storage: { ...setup.storage, 'mnemo.ds': page, ...more } }
}

scenario('next-ds', {
  ...gallery('identity'),
  // a node lights when mnemo hands a rule to a session: press the key that hands one
  drive: async (page) => {
    await page.locator('[data-gallery]').waitFor()
    await page.keyboard.press('l')
  },
})
scenario('next-ds-sessions', gallery('sessions'))
scenario('next-ds-readings', gallery('readings'))
scenario('next-ds-still', gallery('sessions', { 'mnemo.ds.motion': 'reduced' }))
scenario('next-ds-open', {
  ...gallery('readings'),
  drive: async (page) => {
    await page.locator('[data-gallery] .mn-full[data-cut]').first().waitFor()
    await page.locator('[data-gallery] .mn-full[data-cut]').first().focus()
    await page.keyboard.press('Enter')
  },
})

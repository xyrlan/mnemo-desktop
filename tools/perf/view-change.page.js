// Runs in the page: times a change of view. It is one expression that evaluates to a promise of
// the timings, so it can be handed to Playwright's `page.evaluate` (view-change.mjs) or to the
// desktop MCP's `desktop_app_drive` in a dev build, unchanged.
//
// For each step it presses the view's key as the keyboard would (a keydown on the page) and
// reads the clock three times: when the press was made, at the first frame that has the new
// view in the page (what "the view changed" means to the eye), and when the movement between
// the two views has ended. The first is what the design's budget of 100 ms is about; the
// second is the frame's own animation, 320 ms by design (none with motion reduced).
;(async () => {
  const KEY = { orbit: 'h', console: 'c', score: 't' }
  const frame = () => new Promise((done) => requestAnimationFrame(() => done(performance.now())))
  const layer = (view) => document.querySelector(`.frame-view[data-layer="${view}"]`)
  const viewNow = () => document.querySelector('.mn')?.getAttribute('data-view')

  async function change(to) {
    const from = viewNow()
    const start = performance.now()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: KEY[to], bubbles: true, cancelable: true }))
    let shown = null
    let settled = null
    const limit = start + 5000
    while (performance.now() < limit) {
      const at = await frame()
      const here = layer(to)
      if (shown === null && here && !here.hasAttribute('inert')) {
        // one more frame: the one that painted it
        shown = (await frame()) - start
      }
      if (shown !== null && here && !here.dataset.phase && document.querySelectorAll('.frame-view').length === 1) {
        settled = at - start
        break
      }
    }
    return { from, to, shown, settled }
  }

  const steps = ['console', 'score', 'orbit', 'score', 'console', 'orbit']
  const out = []
  // from wherever the page is, to Orbit first, unmeasured
  if (viewNow() !== 'orbit') await change('orbit')
  for (let round = 0; round < 5; round++) for (const to of steps) out.push(await change(to))
  return out
})()

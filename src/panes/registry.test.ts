import { registerPaneView, paneView, paneViews } from './registry'

test('views register and resolve by name', () => {
  const C = () => null
  registerPaneView('x', C)
  expect(paneView('x')).toBe(C)
  expect(paneView('missing')).toBeUndefined()
  expect(paneViews()).toContain('x')
})

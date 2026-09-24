import { resizeRequest } from './reattach'

test('CSI 8 ; rows ; cols t is a size, anything else is not', () => {
  expect(resizeRequest([8, 40, 120])).toEqual({ rows: 40, cols: 120 })
  // Other window ops (a report asked for, a title pushed) are left to xterm.
  expect(resizeRequest([18])).toBeNull()
  expect(resizeRequest([22, 0])).toBeNull()
  // The same shape in pixels is not a size in cells.
  expect(resizeRequest([4, 600, 800])).toBeNull()
  expect(resizeRequest([8])).toBeNull()
  expect(resizeRequest([8, 40])).toBeNull()
  expect(resizeRequest([8, [40], 120])).toBeNull()
  expect(resizeRequest([8, 0, 120])).toBeNull()
  expect(resizeRequest([8, 40, 5000])).toBeNull()
})

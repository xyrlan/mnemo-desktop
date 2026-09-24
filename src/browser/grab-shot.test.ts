import { expect, test } from 'vitest'
import { cropBox, SHOT_MARGIN } from './grab-shot'

const m = SHOT_MARGIN

test("the element's CSS rect becomes a box in the snapshot's pixels, with a margin", () => {
  // A retina snapshot of a 1000px-wide page: 2 device pixels per CSS pixel.
  expect(cropBox({ x: 100, y: 50, width: 200, height: 40 }, 1000, { width: 2000, height: 1600 })).toEqual({
    x: (100 - m) * 2,
    y: (50 - m) * 2,
    w: (200 + 2 * m) * 2,
    h: (40 + 2 * m) * 2,
  })
})

test('the scale is read off the widths, not assumed', () => {
  expect(cropBox({ x: 10, y: 10, width: 10, height: 10 }, 1000, { width: 1000, height: 800 })).toEqual({ x: 10 - m, y: 10 - m, w: 10 + 2 * m, h: 10 + 2 * m })
})

test('what lies outside the viewport is cut off', () => {
  expect(cropBox({ x: -50, y: 700, width: 200, height: 300 }, 1000, { width: 1000, height: 800 })).toEqual({ x: 0, y: 700 - m, w: 150 + m, h: 100 + m })
})

test('an element wholly off screen, or bad numbers, give no box', () => {
  expect(cropBox({ x: 0, y: 900, width: 100, height: 50 }, 1000, { width: 1000, height: 800 })).toBeNull()
  expect(cropBox({ x: -200, y: 0, width: 100, height: 50 }, 1000, { width: 1000, height: 800 })).toBeNull()
  expect(cropBox({ x: NaN, y: 0, width: 100, height: 50 }, 1000, { width: 1000, height: 800 })).toBeNull()
  expect(cropBox({ x: 0, y: 0, width: 100, height: 50 }, 0, { width: 1000, height: 800 })).toBeNull()
  expect(cropBox({ x: 0, y: 0, width: 100, height: 50 }, 1000, { width: 0, height: 0 })).toBeNull()
})

import { BORN_MS, Effects, FADE_MS, FIRE_MS, pulse } from './live'
import { readPalette, type EdgeAttrs, type NodeAttrs } from './model'

const p = readPalette(() => '')
const attrs: NodeAttrs = { x: 0, y: 0, size: 4, color: '#000000', label: 'a', type: 'circle', slug: 'a', agent: 'shared', ghost: false, heat: 1 }
const edge: EdgeAttrs = { kind: 'topic', color: '#404040', size: 0.5 }

test('pulse rises fast and falls back to nothing', () => {
  expect(pulse(0)).toBe(0)
  expect(pulse(0.15)).toBe(1)
  expect(pulse(0.5)).toBeGreaterThan(pulse(0.9))
  expect(pulse(1)).toBe(0)
})

test('a fired node grows and glows, its edges light up, and it all ends after FIRE_MS', () => {
  const fx = new Effects()
  fx.fire(['a'], 1000)
  expect(fx.active(1000)).toBe(true)
  const peak = fx.node('a', attrs, 1000 + 0.15 * FIRE_MS, p)!
  expect(peak.size).toBeCloseTo(attrs.size * 1.9)
  expect(peak.color).not.toBe(attrs.color)
  expect(peak).toMatchObject({ forceLabel: true, highlighted: true })
  expect(fx.node('b', attrs, 1300, p)).toBeNull()
  expect(fx.edge('b', 'a', edge, 1300, p)?.color).not.toBe(edge.color)
  expect(fx.edge('b', 'c', edge, 1300, p)).toBeNull()
  expect(fx.ids()).toEqual(['a'])
  expect(fx.active(1000 + FIRE_MS)).toBe(false)
  expect(fx.node('a', attrs, 1000 + FIRE_MS, p)).toBeNull()
})

test('a born node starts large and settles; its edges fade in from nothing', () => {
  const fx = new Effects()
  fx.birth(['a'], 0)
  expect(fx.node('a', attrs, 0, p)!.size).toBeCloseTo(attrs.size * 3.2)
  expect(fx.node('a', attrs, BORN_MS - 1, p)!.size).toBeCloseTo(attrs.size, 1)
  expect(fx.edge('a', 'b', edge, 0, p)!.color).toBe(p.bg)
  expect(fx.edge('a', 'b', edge, 1200, p)!.color).toBe(edge.color)
  expect(fx.active(BORN_MS)).toBe(false)
})

test('a recoloured node fades from the old colour, and a second change starts from what shows', () => {
  const fx = new Effects()
  fx.recolour([{ id: 'a', from: '#000000', to: '#ffffff' }], 0)
  expect(fx.node('a', attrs, 0, p)!.color).toBe('#000000')
  expect(fx.node('a', attrs, FADE_MS / 2, p)!.color).toBe('#808080')
  fx.recolour([{ id: 'a', from: '#ffffff', to: '#000000' }], FADE_MS / 2)
  expect(fx.node('a', attrs, FADE_MS / 2, p)!.color).toBe('#808080')
  expect(fx.active(FADE_MS * 2)).toBe(false)
})

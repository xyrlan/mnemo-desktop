import { describe, expect, it } from 'vitest'
import { registerRightbarPanel, rightbarPanels } from './panels'

const mk = (id: string, order: number) => ({ id, title: id, icon: () => null, order, panel: () => null })

describe('registerRightbarPanel', () => {
  it('orders by order, replaces an id, and unregisters', () => {
    const a = registerRightbarPanel(mk('a', 2))
    const b = registerRightbarPanel(mk('b', 1))
    expect(rightbarPanels().map((p) => p.id)).toEqual(['b', 'a'])
    const a2 = registerRightbarPanel(mk('a', 0))
    expect(rightbarPanels().map((p) => p.id)).toEqual(['a', 'b'])
    a() // stale: must not remove the replacement
    expect(rightbarPanels().map((p) => p.id)).toEqual(['a', 'b'])
    a2()
    b()
    expect(rightbarPanels()).toEqual([])
  })
})

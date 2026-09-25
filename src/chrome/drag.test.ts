import { vi } from 'vitest'
import { dragStore, dropPane, dropZone, paneUnder, startPaneDrag, THRESHOLD } from './drag'

let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  host.innerHTML = '<div class="pane" data-pane="1"><div class="pane-bar"><span id="t1">x</span></div></div><div class="pane" data-pane="-2"><canvas id="t2"></canvas></div><div id="gap"></div>'
  document.body.appendChild(host)
})
afterEach(() => host.remove())

const $ = (sel: string) => host.querySelector(sel)!
const mouse = (type: string, target: Element | Window, x: number, y = 0) =>
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }))

/** Stubs `.pane[data-pane]`'s bounding rect, which jsdom otherwise reports as all zero. */
function stubRect(pane: Element, rect: { x: number; y: number; w: number; h: number }) {
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    width: rect.w,
    height: rect.h,
    right: rect.x + rect.w,
    bottom: rect.y + rect.h,
    toJSON: () => {},
  })
}

test('paneUnder finds the pane around any descendant', () => {
  expect(paneUnder($('#t1'))).toBe(1)
  expect(paneUnder($('#t2'))).toBe(-2)
  expect(paneUnder($('#gap'))).toBeNull()
  expect(paneUnder(null)).toBeNull()
})

describe('dropZone', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 }

  test('the middle 50% is center', () => {
    expect(dropZone(50, 50, rect)).toBe('center')
    expect(dropZone(25, 50, rect)).toBe('center')
    expect(dropZone(75, 50, rect)).toBe('center')
  })

  test('the outer 25% of each side is that side', () => {
    expect(dropZone(10, 50, rect)).toBe('left')
    expect(dropZone(90, 50, rect)).toBe('right')
    expect(dropZone(50, 10, rect)).toBe('up')
    expect(dropZone(50, 90, rect)).toBe('down')
  })

  test('a point outside the rect is null', () => {
    expect(dropZone(-1, 50, rect)).toBeNull()
    expect(dropZone(100, 50, rect)).toBeNull()
    expect(dropZone(50, -1, rect)).toBeNull()
    expect(dropZone(50, 100, rect)).toBeNull()
  })

  test('near a corner, the closer edge wins', () => {
    expect(dropZone(5, 10, rect)).toBe('left')
    expect(dropZone(10, 5, rect)).toBe('up')
  })

  test('an unmeasured (zero-area) rect is center throughout', () => {
    const empty = { x: 0, y: 0, w: 0, h: 0 }
    expect(dropZone(0, 0, empty)).toBe('center')
    expect(dropZone(500, 500, empty)).toBe('center')
  })
})

test('dragging onto the center of another pane highlights it and drops there on release', () => {
  stubRect($('.pane[data-pane="-2"]'), { x: 100, y: 0, w: 100, h: 100 })
  const drop = vi.fn()
  startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
  mouse('mousemove', $('#t1'), THRESHOLD + 1)
  expect(dragStore.getState()).toEqual({ from: 1, over: null, zone: null, row: null })
  expect(document.body.classList.contains('pane-dragging')).toBe(true)
  mouse('mousemove', $('#t2'), 150, 50)
  expect(dragStore.getState()).toEqual({ from: 1, over: -2, zone: 'center', row: null })
  mouse('mouseup', $('#t2'), 150, 50)
  expect(drop).toHaveBeenCalledWith(1, -2, 'center')
  expect(dragStore.getState()).toEqual({ from: null, over: null, zone: null, row: null })
  expect(document.body.classList.contains('pane-dragging')).toBe(false)
})

test('releasing over an edge zone drops there with that side', () => {
  stubRect($('.pane[data-pane="-2"]'), { x: 100, y: 0, w: 100, h: 100 })
  const drop = vi.fn()
  startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
  mouse('mousemove', $('#t1'), THRESHOLD + 1)
  mouse('mousemove', $('#t2'), 105, 50)
  expect(dragStore.getState()).toEqual({ from: 1, over: -2, zone: 'left', row: null })
  mouse('mouseup', $('#t2'), 195, 50)
  // The zone of the release point wins over the last move's.
  expect(drop).toHaveBeenCalledTimes(1)
  expect(drop).toHaveBeenCalledWith(1, -2, 'right')
  expect(dragStore.getState()).toEqual({ from: null, over: null, zone: null, row: null })
})

test("releasing on the dragged pane's own bar or body drops nothing, whatever its zone", () => {
  stubRect($('.pane[data-pane="1"]'), { x: 0, y: 0, w: 100, h: 100 })
  const drop = vi.fn()
  startPaneDrag(1, { clientX: 50, clientY: 50 }, drop)
  mouse('mousemove', $('#t1'), 95, 50)
  expect(dragStore.getState()).toEqual({ from: 1, over: null, zone: null, row: null })
  mouse('mouseup', $('#t1'), 95, 50)

  startPaneDrag(1, { clientX: 50, clientY: 50 }, drop)
  mouse('mousemove', $('#t1'), 50, 5)
  mouse('mouseup', $('.pane[data-pane="1"]'), 50, 5)
  expect(drop).not.toHaveBeenCalled()
})

test('dropPane swaps on the center and moves on an edge', () => {
  const panes = { swapPanes: vi.fn(), movePane: vi.fn() }
  dropPane(panes, 1, 2, 'center')
  expect(panes.swapPanes).toHaveBeenCalledWith(1, 2)
  expect(panes.movePane).not.toHaveBeenCalled()
  for (const side of ['left', 'right', 'up', 'down'] as const) dropPane(panes, 1, 2, side)
  expect(panes.movePane.mock.calls).toEqual([[1, 2, 'left'], [1, 2, 'right'], [1, 2, 'up'], [1, 2, 'down']])
  expect(panes.swapPanes).toHaveBeenCalledTimes(1)
})

test('a click without movement, a release over nothing, and Escape never drop', () => {
  const drop = vi.fn()
  startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
  mouse('mousemove', $('#t2'), THRESHOLD - 1)
  expect(dragStore.getState().from).toBeNull()
  mouse('mouseup', $('#t2'), THRESHOLD - 1)

  startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
  mouse('mousemove', $('#t2'), 100)
  mouse('mouseup', $('#gap'), 100)

  startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
  mouse('mousemove', $('#t2'), 100)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(dragStore.getState()).toEqual({ from: null, over: null, zone: null, row: null })
  mouse('mouseup', $('#t2'), 100)

  expect(drop).not.toHaveBeenCalled()
})

describe('with groups', () => {
  /** Two tab layers: tab-a holds panes 1 and 3, tab-b (another group's) holds pane 2; and a
   *  group's tab row with two tabs, 100px wide each. */
  beforeEach(() => {
    host.innerHTML = `
      <div data-tab-group-strip-id="group-2" id="row"><div data-tab-id="tab-b" id="tb"></div><div data-tab-id="tab-c" id="tc"></div></div>
      <div data-tab="tab-a"><div class="pane" data-pane="1"><span id="t1">x</span></div><div class="pane" data-pane="3"><span id="t3">x</span></div></div>
      <div data-tab="tab-b"><div class="pane" data-pane="2"><span id="t2">x</span></div></div>`
    stubRect($('.pane[data-pane="2"]'), { x: 300, y: 0, w: 100, h: 100 })
    stubRect($('.pane[data-pane="3"]'), { x: 100, y: 0, w: 100, h: 100 })
    stubRect($('#tb'), { x: 0, y: 0, w: 100, h: 36 })
    stubRect($('#tc'), { x: 100, y: 0, w: 100, h: 36 })
  })

  test("another tab's panes, shown in another group, are never a target", () => {
    const drop = vi.fn()
    startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
    mouse('mousemove', $('#t2'), 350, 50)
    expect(dragStore.getState()).toEqual({ from: 1, over: null, zone: null, row: null })
    mouse('mouseup', $('#t2'), 350, 50)
    expect(drop).not.toHaveBeenCalled()
    // Its own tab's are, as before.
    startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
    mouse('mousemove', $('#t3'), 150, 50)
    mouse('mouseup', $('#t3'), 150, 50)
    expect(drop).toHaveBeenCalledWith(1, 3, 'center')
  })

  test('over a tab row, the slot it would become a tab at; let go there, it detaches into that group', () => {
    const drop = vi.fn()
    const detach = vi.fn()
    startPaneDrag(1, { clientX: 0, clientY: 0 }, drop, { detach })
    mouse('mousemove', $('#tc'), 120, 10)
    expect(dragStore.getState()).toEqual({ from: 1, over: null, zone: null, row: { group: 'group-2', slot: 1 } })
    mouse('mousemove', $('#row'), 260, 10)
    expect(dragStore.getState().row).toEqual({ group: 'group-2', slot: 2 })
    mouse('mouseup', $('#tb'), 10, 10)
    expect(detach).toHaveBeenCalledWith('group-2', 0)
    expect(drop).not.toHaveBeenCalled()
    expect(dragStore.getState().row).toBeNull()
  })

  test("without `rows` (its tab's only pane), a tab row is not a target", () => {
    const drop = vi.fn()
    startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
    mouse('mousemove', $('#tc'), 120, 10)
    expect(dragStore.getState().row).toBeNull()
    mouse('mouseup', $('#tc'), 120, 10)
    expect(drop).not.toHaveBeenCalled()
  })
})

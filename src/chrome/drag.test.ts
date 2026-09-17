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
  expect(dragStore.getState()).toEqual({ from: 1, over: null, zone: null })
  expect(document.body.classList.contains('pane-dragging')).toBe(true)
  mouse('mousemove', $('#t2'), 150, 50)
  expect(dragStore.getState()).toEqual({ from: 1, over: -2, zone: 'center' })
  mouse('mouseup', $('#t2'), 150, 50)
  expect(drop).toHaveBeenCalledWith(1, -2, 'center')
  expect(dragStore.getState()).toEqual({ from: null, over: null, zone: null })
  expect(document.body.classList.contains('pane-dragging')).toBe(false)
})

test('releasing over an edge zone drops there with that side', () => {
  stubRect($('.pane[data-pane="-2"]'), { x: 100, y: 0, w: 100, h: 100 })
  const drop = vi.fn()
  startPaneDrag(1, { clientX: 0, clientY: 0 }, drop)
  mouse('mousemove', $('#t1'), THRESHOLD + 1)
  mouse('mousemove', $('#t2'), 105, 50)
  expect(dragStore.getState()).toEqual({ from: 1, over: -2, zone: 'left' })
  mouse('mouseup', $('#t2'), 195, 50)
  // The zone of the release point wins over the last move's.
  expect(drop).toHaveBeenCalledTimes(1)
  expect(drop).toHaveBeenCalledWith(1, -2, 'right')
  expect(dragStore.getState()).toEqual({ from: null, over: null, zone: null })
})

test("releasing on the dragged pane's own bar or body drops nothing, whatever its zone", () => {
  stubRect($('.pane[data-pane="1"]'), { x: 0, y: 0, w: 100, h: 100 })
  const drop = vi.fn()
  startPaneDrag(1, { clientX: 50, clientY: 50 }, drop)
  mouse('mousemove', $('#t1'), 95, 50)
  expect(dragStore.getState()).toEqual({ from: 1, over: null, zone: null })
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
  expect(dragStore.getState()).toEqual({ from: null, over: null, zone: null })
  mouse('mouseup', $('#t2'), 100)

  expect(drop).not.toHaveBeenCalled()
})

import { vi } from 'vitest'
import { dragStore, paneUnder, startPaneDrag, THRESHOLD } from './drag'

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

test('paneUnder finds the pane around any descendant', () => {
  expect(paneUnder($('#t1'))).toBe(1)
  expect(paneUnder($('#t2'))).toBe(-2)
  expect(paneUnder($('#gap'))).toBeNull()
  expect(paneUnder(null)).toBeNull()
})

test('dragging onto another pane highlights it and swaps on release', () => {
  const swap = vi.fn()
  startPaneDrag(1, { clientX: 0, clientY: 0 }, swap)
  mouse('mousemove', $('#t1'), THRESHOLD + 1)
  expect(dragStore.getState()).toEqual({ from: 1, over: null })
  expect(document.body.classList.contains('pane-dragging')).toBe(true)
  mouse('mousemove', $('#t2'), 200)
  expect(dragStore.getState()).toEqual({ from: 1, over: -2 })
  mouse('mouseup', $('#t2'), 200)
  expect(swap).toHaveBeenCalledWith(1, -2)
  expect(dragStore.getState()).toEqual({ from: null, over: null })
  expect(document.body.classList.contains('pane-dragging')).toBe(false)
})

test('a click without movement, a release over nothing, and Escape never swap', () => {
  const swap = vi.fn()
  startPaneDrag(1, { clientX: 0, clientY: 0 }, swap)
  mouse('mousemove', $('#t2'), THRESHOLD - 1)
  expect(dragStore.getState().from).toBeNull()
  mouse('mouseup', $('#t2'), THRESHOLD - 1)

  startPaneDrag(1, { clientX: 0, clientY: 0 }, swap)
  mouse('mousemove', $('#t2'), 100)
  mouse('mouseup', $('#gap'), 100)

  startPaneDrag(1, { clientX: 0, clientY: 0 }, swap)
  mouse('mousemove', $('#t2'), 100)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  expect(dragStore.getState()).toEqual({ from: null, over: null })
  mouse('mouseup', $('#t2'), 100)

  expect(swap).not.toHaveBeenCalled()
})

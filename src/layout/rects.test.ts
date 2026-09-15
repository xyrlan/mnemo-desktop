import { layoutRects, paneRects, workspaceRect } from './rects'
import type { Node } from './tree'

test('paneRects reads every .pane[data-pane] element', () => {
  const host = document.createElement('div')
  host.innerHTML = '<div class="pane" data-pane="3"></div><div class="pane" data-pane="-1"></div><div data-pane="9"></div>'
  const r = paneRects(host)
  expect([...r.keys()]).toEqual([3, -1])
  expect(r.get(3)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
})

test('workspaceRect unions the visible panes and ignores hidden ones', () => {
  const rects = new Map([
    [1, { x: 0, y: 30, w: 640, h: 770 }],
    [2, { x: 640, y: 30, w: 640, h: 385 }],
    [3, { x: 640, y: 415, w: 640, h: 385 }],
    [4, { x: 0, y: 0, w: 0, h: 0 }],
  ])
  expect(workspaceRect(rects)).toEqual({ x: 0, y: 30, w: 1280, h: 770 })
  expect(workspaceRect(new Map([[4, { x: 0, y: 0, w: 0, h: 0 }]]))).toBeNull()
})

test('layoutRects splits the box by direction and ratio', () => {
  const tree: Node = {
    kind: 'split',
    dir: 'row',
    ratio: 0.25,
    children: [
      { kind: 'leaf', pane: 1 },
      { kind: 'split', dir: 'col', ratio: 0.5, children: [{ kind: 'leaf', pane: 2 }, { kind: 'leaf', pane: 3 }] },
    ],
  }
  const r = layoutRects(tree, { x: 0, y: 10, w: 1200, h: 800 })
  expect(r.get(1)).toEqual({ x: 0, y: 10, w: 300, h: 800 })
  expect(r.get(2)).toEqual({ x: 300, y: 10, w: 900, h: 400 })
  expect(r.get(3)).toEqual({ x: 300, y: 410, w: 900, h: 400 })
})

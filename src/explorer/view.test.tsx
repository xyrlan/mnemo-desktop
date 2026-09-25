import { rightbarPanels } from '../rightbar/panels'
import '../rightbar/view'
import './view'

test('the Explorer tab registers itself in the right sidebar, right after Memory', () => {
  expect(rightbarPanels().map((p) => p.id).slice(0, 2)).toEqual(['memory', 'explorer'])
  expect(rightbarPanels().find((p) => p.id === 'explorer')?.title).toBe('Explorer')
})

test('a click opens a preview, a double click and Open to the Side keep the tab', async () => {
  const { store } = await import('../layout/app-store')
  const seen: unknown[][] = []
  const spy = vi.spyOn(store.getState(), 'openView').mockImplementation((...a) => void seen.push(a))
  const { openFile } = await import('./view')
  openFile('/r/a.ts', '/r', 'preview')
  openFile('/r/a.ts', '/r', 'keep')
  openFile('/r/a.ts', null, 'side')
  expect(seen).toEqual([
    ['editor', { path: '/r/a.ts', root: '/r' }, 'auto', 'a.ts', { preview: true }],
    ['editor', { path: '/r/a.ts', root: '/r' }, 'auto', 'a.ts', undefined],
    ['editor', { path: '/r/a.ts' }, 'split-row', 'a.ts', undefined],
  ])
  spy.mockRestore()
})

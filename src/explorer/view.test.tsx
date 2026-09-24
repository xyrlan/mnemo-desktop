import { rightbarPanels } from '../rightbar/panels'
import '../rightbar/view'
import './view'

test('the Explorer tab registers itself in the right sidebar, right after Memory', () => {
  expect(rightbarPanels().map((p) => p.id).slice(0, 2)).toEqual(['memory', 'explorer'])
  expect(rightbarPanels().find((p) => p.id === 'explorer')?.title).toBe('Explorer')
})

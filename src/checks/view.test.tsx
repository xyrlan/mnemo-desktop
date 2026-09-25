import { expect, test } from 'vitest'
import { all } from '../actions/registry'
import { rightbarPanels } from '../rightbar/panels'
import '../source-control/view'
import './view'

test('the Checks tab registers itself in the right sidebar, after Source Control', () => {
  const ids = rightbarPanels().map((p) => p.id)
  expect(ids).toContain('checks')
  expect(ids.indexOf('checks')).toBe(ids.indexOf('source-control') + 1)
  expect(rightbarPanels().find((p) => p.id === 'checks')?.title).toBe('Checks')
})

test('the palette can show it', () => {
  expect(all().find((a) => a.id === 'checks.show')?.title).toMatch(/^Checks/)
})

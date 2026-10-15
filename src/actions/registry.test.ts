import { all, claimAction, register, run } from './registry'

test('custom actions extend the registry', () => {
  let hit = 0
  register({ id: 'x', title: 'X', run: () => { hit++ } })
  run('x')
  run('missing')
  expect(hit).toBe(1)
  expect(all().find((a) => a.id === 'x')?.title).toBe('X')
})

test('the app registers no workbench action: ⌘W runs nothing of its own, only what claims it', () => {
  // `pane.close` and `tab.close` have chords and no action; the drawer claims them (#459).
  expect(all().map((a) => a.id)).not.toContain('pane.close')
  const claimed: string[] = []
  const unclaim = claimAction((id) => (claimed.push(id), id === 'pane.close'))
  run('pane.close')
  run('tab.close')
  unclaim()
  run('pane.close')
  expect(claimed).toEqual(['pane.close', 'tab.close'])
})

test('a claim that takes an action stops it from running', () => {
  let ran = 0
  register({ id: 'y', title: 'Y', run: () => { ran++ } })
  const unclaim = claimAction((id) => id === 'y')
  run('y')
  expect(ran).toBe(0)
  unclaim()
  run('y')
  expect(ran).toBe(1)
})

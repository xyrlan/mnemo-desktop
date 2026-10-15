import { afterEach, beforeEach, expect, test } from 'vitest'
import { store as appStore } from '../layout/app-store'
import { setFigures } from '../nexus/outside'
import { child } from './fixtures'
import { attachChild, openMissionPane } from './rows'

// What the Nexus was asked to open, and what the workbench was.
let nexus: string[]
let workbench: string[]
let known: (id: string) => boolean
let unset = () => {}
beforeEach(() => {
  nexus = []
  workbench = []
  known = () => true
  appStore.setState({
    panes: {},
    openView: (view: string, params: { cmd?: string; id?: string }) => void workbench.push(`${view} ${params.cmd ?? params.id}`),
  } as never)
  unset = setFigures({
    open: (id) => (known(id) ? (nexus.push(`open ${id}`), true) : false),
    attach: (c) => void nexus.push(`attach ${typeof c === 'string' ? c : c.id}`),
  })
})
afterEach(() => unset())

test('attaching a child opens it in the Nexus, never a workbench terminal', () => {
  attachChild(child({ id: 'c0ffee01' }), 'split-col')
  attachChild('c0ffee02')
  expect(nexus).toEqual(['attach c0ffee01', 'attach c0ffee02'])
  expect(workbench).toEqual([])
})

test('opening a child opens its robot in the Nexus; only a child the ship does not know falls back to its mission pane', () => {
  openMissionPane(child({ id: 'c0ffee01' }))
  known = () => false
  openMissionPane(child({ id: 'c0ffee02' }))
  expect(nexus).toEqual(['open c0ffee01'])
  expect(workbench).toEqual(['mission c0ffee02'])
})

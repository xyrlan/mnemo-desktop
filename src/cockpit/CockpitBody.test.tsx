import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

// The sidebar polls on mount and the pane asks git for its branch: serve the test's snapshot.
const served = vi.hoisted(() => ({ snap: null as unknown }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === 'mission_snapshot' ? served.snap : cmd === 'home_snapshot' ? { repos: [], clone_base: '', errors: [], protected: 0 } : cmd === 'chrome_branch' ? 'main' : {})),
}))

import Sidebar from '../mission/Sidebar'
import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { homeStore } from '../home/app-store'
import { paneView } from '../panes/registry'
import { snapshot } from '../mission/fixtures'
import type { ChromeClient } from '../chrome/client'
import type { Snapshot } from '../mission/types'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const chrome: ChromeClient = { repo: async () => null, branch: async () => null }

let side: HTMLDivElement
let pane: HTMLDivElement
let roots: Root[]

beforeEach(() => {
  side = document.createElement('div')
  pane = document.createElement('div')
  document.body.append(side, pane)
  roots = [createRoot(side), createRoot(pane)]
  homeStore.setState({ snapshot: { repos: [], clone_base: '', errors: [], protected: 0 }, loading: false })
  appStore.setState({ tabs: [], activeTab: '', panes: {} })
  serve(snapshot)
})

afterEach(() => {
  act(() => roots.forEach((r) => r.unmount()))
  side.remove()
  pane.remove()
})

function serve(snap: Snapshot) {
  served.snap = snap
  missionStore.setState({ snapshot: snap, lastError: null, sidebarOpen: true, drafts: {}, sent: {}, looked: {}, folds: {} })
}

/** The fixture without its blocked child: nothing needs you. */
function calm(): Snapshot {
  const m = snapshot.repos[0].missions[0]
  const vault = m.pieces[1]
  const working = { ...vault.child!, tempo: 'active', needs: null, suggested_reply: null, detail: '' }
  return { ...snapshot, repos: [{ ...snapshot.repos[0], missions: [{ ...m, pieces: [m.pieces[0], { ...vault, child: working }] }] }, ...snapshot.repos.slice(1)] }
}

async function renderBoth() {
  const View = paneView('cockpit')!
  await act(async () => {
    roots[0].render(<Sidebar chrome={chrome} />)
    roots[1].render(<View id={-1} props={{}} />)
  })
}

const fold = (host: HTMLElement, which: 'working' | 'done') => host.querySelector<HTMLButtonElement>(`.ck-section-${which} .ck-fold`)
const labels = (host: HTMLElement, which: 'working' | 'done') => [...host.querySelectorAll(`.ck-section-${which} .ck-row .ck-label`)].map((e) => e.textContent)

test('the sidebar renders the whole cockpit body: needs, andando, feito hoje', async () => {
  await renderBoth()
  expect([...side.querySelectorAll('.needs-list .nd-label')].map((e) => e.textContent)).toEqual(['vault'])
  expect(fold(side, 'working')?.textContent).toMatch(/^▸ andando: \d+$/)
  expect(fold(side, 'working')?.textContent).toBe(fold(pane, 'working')?.textContent)
  // Opened, the sidebar lists the same children as the pane, without the mission-map button.
  await act(async () => fold(side, 'working')!.click())
  expect(labels(side, 'working').length).toBeGreaterThan(0)
  expect(labels(side, 'working')).toEqual(labels(pane, 'working'))
  expect(side.querySelector('.ck-section .ck-mission')).toBeNull()
})

test('andando opens by itself when nothing needs you, on both surfaces', async () => {
  serve(calm())
  await renderBoth()
  for (const host of [side, pane]) {
    expect(fold(host, 'working')?.getAttribute('aria-expanded')).toBe('true')
    expect(labels(host, 'working').length).toBeGreaterThan(0)
  }
  expect(side.querySelector('.m-empty')?.textContent).toBe('nothing needs you')
})

test('a fold clicked in one surface is the fold in the other', async () => {
  await renderBoth()
  expect(fold(pane, 'working')?.getAttribute('aria-expanded')).toBe('false')
  await act(async () => fold(side, 'working')!.click())
  expect(fold(pane, 'working')?.getAttribute('aria-expanded')).toBe('true')
  await act(async () => fold(pane, 'working')!.click())
  expect(fold(side, 'working')?.getAttribute('aria-expanded')).toBe('false')
  expect(missionStore.getState().folds).toEqual({ working: false })
})

test('the vault slot docks after the body with its placeholder and the hook vault-level fills', async () => {
  await renderBoth()
  const bar = side.querySelector('.sidebar')!
  const slot = bar.lastElementChild as HTMLElement
  expect(slot.hasAttribute('data-vault-level-slot')).toBe(true)
  expect(slot.className).toBe('vault-level-slot sidebar-vault')
  expect(slot.previousElementSibling?.className).toBe('sidebar-body')
  expect(slot.querySelector('.vault-level-placeholder')).not.toBeNull()
  // vault-level marks the slot filled; a re-render of the sidebar leaves the mark alone.
  slot.classList.add('vl-filled')
  await act(async () => missionStore.getState().setFold('done', true))
  await act(async () => serve({ ...snapshot, at: new Date().toISOString() }))
  expect(slot.classList.contains('vl-filled')).toBe(true)
})

test('⤢ still expands into the cockpit pane', async () => {
  await act(async () => roots[0].render(<Sidebar chrome={chrome} />))
  await act(async () => side.querySelector<HTMLButtonElement>('.m-cockpit')!.click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'cockpit')).toBe(true)
})

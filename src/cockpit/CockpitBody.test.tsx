import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

// The sidebar polls on mount and the pane asks git for its branch: serve the test's snapshot.
const served = vi.hoisted(() => ({ snap: null as unknown }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === 'mission_snapshot' ? served.snap : cmd === 'home_snapshot' ? { repos: [], clone_base: '', errors: [], protected: 0 } : cmd === 'chrome_branch' ? 'main' : {})),
}))

import Sidebar from '../mission/Sidebar'
import VaultLevelSlot from './VaultLevelSlot'
import { missionStore } from '../mission/app-store'
import { store as appStore } from '../layout/app-store'
import { homeStore } from '../home/app-store'
import { paneView } from '../panes/registry'
import { snapshot } from '../mission/fixtures'
import { withPrs } from './fixtures'
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

test('the vault slot docks after the body, holding the square', async () => {
  await renderBoth()
  const bar = side.querySelector('.sidebar')!
  const slot = bar.lastElementChild as HTMLElement
  expect(slot.className).toBe('vault-level-slot sidebar-vault')
  expect(slot.previousElementSibling?.className).toBe('sidebar-body')
  expect(slot.querySelector('.vl-square')).not.toBeNull()
  expect(slot.querySelector('.vault-level-placeholder')).toBeNull()
})

test('children replace the placeholder', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<VaultLevelSlot className="sidebar-vault"><b className="square" /></VaultLevelSlot>))
  const slot = host.querySelector('.vault-level-slot')!
  expect(slot.querySelector('.square')).not.toBeNull()
  expect(slot.querySelector('.vault-level-placeholder')).toBeNull()
  act(() => root.unmount())
})

test('⤢ still expands into the cockpit pane', async () => {
  await act(async () => roots[0].render(<Sidebar chrome={chrome} />))
  await act(async () => side.querySelector<HTMLButtonElement>('.m-cockpit')!.click())
  expect(Object.values(appStore.getState().panes).some((p) => p.view === 'cockpit')).toBe(true)
})

/** The state a child row shows: the octopus's scene class and the screen-reader word. */
const marks = (rows: Element[]) =>
  rows.map((r) => {
    const svg = r.querySelector('.ck-mark svg.av')
    return { scene: [...(svg?.classList ?? [])].find((c) => /^av-(active|blocked-state|stalled|done|stopped)$/.test(c)), sr: r.querySelector('.ck-mark .ck-sr')?.textContent, pill: r.querySelector('.nd-word')?.textContent }
  })

test('a child row in the sidebar shows its animated state in place of the pill, the word kept for screen readers', async () => {
  serve(calm())
  await renderBoth()
  for (const host of [side, pane]) {
    const rows = [...host.querySelectorAll('.ck-section-working .ck-row')]
    expect(rows.length).toBeGreaterThan(0)
    for (const m of marks(rows)) {
      expect(m.sr).toMatch(/^(active|stalled)$/)
      expect(m.scene).toBe(`av-${m.sr}`)
      expect(m.pill).toBeUndefined()
    }
    expect(host.querySelector('.ck-mark svg')?.getAttribute('aria-hidden')).toBe('true')
  }
})

test('a blocked child shows the BLOCKED octopus on both surfaces; once replied, the replied pill instead', async () => {
  await renderBoth()
  expect(marks([...side.querySelectorAll('.needs-list .nd-blocked')])).toEqual([{ scene: 'av-blocked-state', sr: 'BLOCKED', pill: undefined }])
  expect(marks([...pane.querySelectorAll('.ck-row.ck-blocked')])).toEqual([{ scene: 'av-blocked-state', sr: 'BLOCKED', pill: undefined }])

  const id = pane.querySelector('.ck-row.ck-blocked')!.getAttribute('data-key')!.replace('blocked:', '')
  await act(async () => missionStore.setState({ sent: { [id]: [{ at: Date.now(), text: 'yes', original: 'yes' }] } }))
  expect(marks([...side.querySelectorAll('.needs-list .nd-blocked')])).toEqual([{ scene: undefined, sr: undefined, pill: 'replied' }])
  expect(marks([...pane.querySelectorAll('.ck-row.ck-blocked')])).toEqual([{ scene: undefined, sr: undefined, pill: 'replied' }])
})

test('rows that are not a child keep their pill and get no octopus', async () => {
  serve(withPrs)
  await renderBoth()
  const rows = [...pane.querySelectorAll('.ck-row.ck-ci, .ck-row.ck-ready, .ck-row.ck-land')]
  expect(rows.length).toBeGreaterThan(0)
  for (const m of marks(rows)) {
    expect(m.scene).toBeUndefined()
    expect(m.pill).toMatch(/^(CI ✗|ready|land)$/)
  }
  for (const m of marks([...side.querySelectorAll('.needs-list .nd:not(.nd-blocked)')])) {
    expect(m.scene).toBeUndefined()
    expect(m.pill).toMatch(/^(CI ✗|merge|land)$/)
  }
})

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({ lines: [], total: 0 })) }))

import { missionStore } from './app-store'
import { paneView } from '../panes/registry'
import { snapshot } from './fixtures'
import { allChildren } from './types'
import './view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no layout; the pane scrolls its tail into view on every update.
Element.prototype.scrollIntoView = () => {}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  missionStore.setState({ snapshot, lastError: null, looked: {}, drafts: {}, sent: {} })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

// Regression for the black screen: opening a child you never replied to (every
// active or done row) mounted a pane whose selector returned a fresh array on
// every store read, so React's external-store hook looped until it threw and
// unmounted the whole app. The pane must survive mount plus a poll tick.
test('mission pane survives a store notification for a child with no replies', async () => {
  const child = allChildren(snapshot).find((c) => c.state === 'done') ?? allChildren(snapshot)[0]
  expect(missionStore.getState().sent[child.id]).toBeUndefined()
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: child.id }} />)
  })
  // What the sidebar poll does three times every 3 s.
  await act(async () => {
    missionStore.setState({ polling: true })
    missionStore.setState({ snapshot: { ...snapshot, at: '2026-09-15T12:00:03Z' } })
    missionStore.setState({ polling: false })
  })
  expect(host.querySelector('.mission-pane')).not.toBeNull()
  expect(host.textContent).toContain(child.id)
})

test('a poll that changes nothing about the child does not re-mark it as looked', async () => {
  const child = allChildren(snapshot)[0]
  const markLooked = vi.fn(async () => {})
  missionStore.setState({ markLooked })
  const Pane = paneView('mission')!
  await act(async () => {
    root.render(<Pane id={1} props={{ id: child.id }} />)
  })
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      // Rust hands the frontend a new object graph on every snapshot, same content.
      missionStore.setState({ snapshot: JSON.parse(JSON.stringify(snapshot)) })
    })
  }
  expect(markLooked).toHaveBeenCalledTimes(1)
})

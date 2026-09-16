import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) =>
    cmd === 'app_build_info' ? { version: '0.1.0', sha: '9f3ab21', built_at: '2026-09-15 13:49 UTC' } : {},
  ),
}))

import Palette from './Palette'
import { store } from '../layout/app-store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// cmdk measures its list with ResizeObserver, which jsdom lacks.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  store.setState({ paletteOpen: true })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render() {
  await act(async () => root.render(<Palette />))
  // The build info is fetched in an effect; let its promise settle.
  await act(async () => {})
}

test('the about line says which build is running, so a stale bundle reads as stale', async () => {
  await render()
  expect(host.querySelector('.palette-about')?.textContent).toBe('mnemo 0.1.0 · 9f3ab21 · built 2026-09-15 13:49 UTC')
})

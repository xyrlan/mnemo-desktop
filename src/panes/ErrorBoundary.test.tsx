import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import ErrorBoundary from './ErrorBoundary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

let shouldThrow = true
function Bomb() {
  if (shouldThrow) throw new Error('boom from pane')
  return <span>pane ok</span>
}

test('a throwing view is replaced by its error, siblings stay mounted', () => {
  shouldThrow = true
  act(() => {
    root.render(
      <div>
        <span id="tabbar">tabs</span>
        <ErrorBoundary label="tab 1">
          <Bomb />
        </ErrorBoundary>
      </div>,
    )
  })
  expect(host.querySelector('#tabbar')?.textContent).toBe('tabs')
  expect(host.querySelector('.crashed-title')?.textContent).toBe('tab 1 crashed')
  expect(host.querySelector('.crashed-error')?.textContent).toBe('boom from pane')
})

test('retry renders the children again', () => {
  shouldThrow = true
  act(() => {
    root.render(
      <ErrorBoundary label="sidebar">
        <Bomb />
      </ErrorBoundary>,
    )
  })
  shouldThrow = false
  act(() => {
    ;(host.querySelector('.crashed button') as HTMLButtonElement).click()
  })
  expect(host.textContent).toBe('pane ok')
})

test('renders children when nothing throws', () => {
  function Counter() {
    const [n, set] = useState(0)
    return <button onClick={() => set(n + 1)}>{n}</button>
  }
  act(() => {
    root.render(
      <ErrorBoundary label="home">
        <Counter />
      </ErrorBoundary>,
    )
  })
  act(() => (host.querySelector('button') as HTMLButtonElement).click())
  expect(host.textContent).toBe('1')
})

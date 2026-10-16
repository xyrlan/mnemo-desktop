import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createStore } from 'zustand/vanilla'
import { FileWork } from './FileWork'
import type { Work } from './files'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const badges = () => [...document.querySelectorAll<HTMLElement>('[data-testid="voice-file-work"]')]

test('a drop being transcribed is shown over what it was dropped on, with the download bar while it runs', () => {
  const target = document.body.appendChild(document.createElement('aside'))
  target.getBoundingClientRect = () => ({ left: 600, top: 40, width: 400, height: 500, right: 1000, bottom: 540, x: 600, y: 40, toJSON: () => ({}) })
  const store = createStore<{ work: Work[] }>(() => ({ work: [{ id: 1, el: target, label: 'Downloading the speech model for files: 50%', download: 0.5 }] }))
  act(() => root.render(<FileWork store={store} />))
  const [badge] = badges()
  expect(badge.textContent).toBe('Downloading the speech model for files: 50%')
  expect(badge.getAttribute('role')).toBe('status')
  expect(badge.style.left).toBe('800px')
  expect(badge.style.top).toBe('48px')
  expect(badge.querySelector<HTMLElement>('[style*="width: 50%"]')).not.toBeNull()

  act(() => store.setState({ work: [{ id: 1, el: target, label: 'Transcribing a.opus 40%', download: null }] }))
  expect(badges()[0].textContent).toBe('Transcribing a.opus 40%')
  expect(badges()[0].querySelector('[style*="width"]')).toBeNull()

  // What it was dropped on went away: the work still shows, at the bottom of the window.
  target.remove()
  act(() => store.setState({ work: [{ id: 1, el: target, label: 'Transcribing a.opus 60%', download: null }] }))
  act(() => void new Promise((r) => requestAnimationFrame(r)))
  expect(badges()).toHaveLength(1)

  act(() => store.setState({ work: [] }))
  expect(badges()).toEqual([])
})

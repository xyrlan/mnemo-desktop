import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { Wordmark } from './Wordmark'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

test('renders the text mnemo', () => {
  act(() => root.render(<Wordmark />))
  expect(host.textContent).toBe('mnemo')
})

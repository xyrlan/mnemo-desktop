import { act } from 'react'
import { createRoot } from 'react-dom/client'
import ChildMark, { MARK_SIZE } from './ChildMark'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

test('the state marker is larger than the old 16px dot and still names the state for screen readers', async () => {
  const host = document.createElement('div')
  await act(async () => createRoot(host).render(<ChildMark child={{ state: 'running', tempo: 'active', live: true } as never} />))
  expect(MARK_SIZE).toBeGreaterThan(16)
  expect(host.querySelector('svg')!.getAttribute('width')).toBe(String(MARK_SIZE))
  expect(host.querySelector('.ck-sr')!.textContent).toBeTruthy()
})

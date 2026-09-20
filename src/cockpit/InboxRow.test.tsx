import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => ({})) }))

import InboxRow, { costLine } from './InboxRow'
import { child, desktop } from '../mission/fixtures'
import type { ChildRow } from './inbox'
import type { ChildSession } from '../mission/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const draw = async (c: ChildSession) => {
  const row: ChildRow = { kind: 'working', key: c.id, repo: desktop, child: c, label: 'a piece', mission: null }
  const host = document.createElement('div')
  document.body.append(host)
  await act(async () =>
    createRoot(host).render(<InboxRow row={row} selected={false} showRepo={false} narrow={false} armed={null} fire={() => true} onSelect={() => {}} />),
  )
  return host
}

test('a row says which model and effort its child runs on', async () => {
  const host = await draw(child({ id: 'aa000001', model: 'opus[1m]', effort: 'high' }))
  expect(host.querySelector('.ck-cost')!.textContent).toBe('opus[1m] · high effort')
})

test('a child dispatched without them reads as the default, never blank or null', async () => {
  for (const c of [child({ id: 'aa000002' }), child({ id: 'aa000003', model: null, effort: null })]) {
    const text = (await draw(c)).querySelector('.ck-cost')!.textContent!
    expect(text).toBe('default model · default effort')
    expect(text).not.toMatch(/null|undefined/)
  }
  expect(costLine({ model: 'sonnet', effort: null })).toBe('sonnet · default effort')
  expect(costLine({ model: null, effort: 'low' })).toBe('default model · low effort')
})

test('the first line keeps the label; the marker is bigger than 16', async () => {
  const host = await draw(child({ id: 'aa000004', model: 'sonnet', effort: 'high' }))
  expect(host.querySelector('.ck-row-head .ck-label')!.textContent).toBe('a piece')
  expect(Number(host.querySelector('.ck-mark svg')!.getAttribute('width'))).toBeGreaterThan(16)
})

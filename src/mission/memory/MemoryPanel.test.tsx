import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryPanel } from './MemoryPanel'
import type { ChildMemory } from './types'

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

const full: ChildMemory = {
  briefing: { path: 'bots/mnemo/briefings/sessions/second.md', at: Date.now() - 60_000 },
  injected: [
    { slug: 'run-the-tests', at: Date.now() - 120_000 },
    { slug: 'run-the-tests', at: Date.now() - 60_000 },
    { slug: 'bg-spare-pool-is-one-spare', at: Date.now() - 30_000 },
  ],
  friction: [{ rule_text: 'Ask before rewriting a whole file.', contradicts: ['some-stale-rule'], injected_in_session: [], at: Date.now() - 10_000 }],
  mcp_reads: ['stream-state-persist-with-overlay-not-swap'],
}

test('a child with no session yet says so and shows nothing else', () => {
  act(() => root.render(<MemoryPanel memory={null} hasSession={false} />))
  expect(host.textContent).toBe('memory: no session yet')
})

test('memory still loading renders nothing rather than a false empty state', () => {
  act(() => root.render(<MemoryPanel memory={null} hasSession={true} />))
  expect(host.textContent).toBe('')
})

test('the panel opens by default, showing the briefing, deduped rules, and pushback', () => {
  act(() => root.render(<MemoryPanel memory={full} hasSession={true} />))
  expect(host.querySelector('.mm-head')?.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('.mm-briefing')?.textContent).toContain('second.md')
  const slugs = [...host.querySelectorAll('.mm-slug')].map((e) => e.textContent)
  expect(slugs).toEqual(['bg-spare-pool-is-one-spare', 'run-the-tests', 'stream-state-persist-with-overlay-not-swap'])
  expect(host.querySelector('.mm-count')?.textContent).toBe('×2')
  expect(host.querySelector('.mm-rule-text')?.textContent).toBe('Ask before rewriting a whole file.')
  expect(host.querySelector('.mm-contradicts')?.textContent).toBe('against: some-stale-rule')
})

test('collapsing the panel hides the body but keeps the badge', () => {
  act(() => root.render(<MemoryPanel memory={full} hasSession={true} />))
  const head = host.querySelector<HTMLButtonElement>('.mm-head')!
  act(() => head.click())
  expect(head.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector('.mm-body')).toBeNull()
  expect(head.textContent).toContain('2 rules · 1 pushback')
})

test('mcp reads say "not recorded" when the log carries no session id, not an empty list', () => {
  act(() => root.render(<MemoryPanel memory={{ briefing: null, injected: [], friction: [], mcp_reads: null }} hasSession={true} />))
  expect(host.textContent).toContain('not recorded')
  expect(host.textContent).toContain('briefing')
})

test('a fresh child with rows nowhere reads as empty everywhere, never an error', () => {
  act(() => root.render(<MemoryPanel memory={{ briefing: null, injected: [], friction: [], mcp_reads: [] }} hasSession={true} />))
  const notes = [...host.querySelectorAll('.mm-none')].map((e) => e.textContent)
  expect(notes).toEqual(['not recorded', 'none yet', 'none yet', 'none yet'])
})

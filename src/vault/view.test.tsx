import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Agent, Page, RunResult } from './types'

const calls: [string, Record<string, unknown> | undefined][] = []
const dir = '/v/bots/mnemo-desktop/memory'
const info = {
  path: `${dir}/shared-target-dir.md`,
  slug: 'shared-target-dir',
  name: 'shared-target-dir',
  description: 'private CARGO_TARGET_DIR for parallel builds',
  type: 'project',
  confidence: 'observed',
  topics: ['build'],
  modified: 1789430400000,
  body: '**Why:** a cold build takes minutes.\n\n- see [[shared-target-dir]]',
}
const tree: Agent[] = [
  { name: 'shared', kind: 'shared', dir: '/v/shared', groups: [] },
  { name: 'mnemo-desktop', kind: 'repo', dir, groups: [{ type: 'project', pages: [info] }] },
  { name: 'bg-pytest-1', kind: 'other', dir: '/v/bots/bg-pytest-1/memory', groups: [{ type: 'user', pages: [{ ...info, path: '/v/bg/x.md', name: 'noise' }] }] },
]
const page: Page = { ...info, runtime: null, frontmatter: [{ key: 'metadata.type', value: 'project' }], error: null }

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === 'vault_tree') return tree
    if (cmd === 'vault_page') return page
    if (cmd === 'vault_run') return { stdout: 'disabled', stderr: '', code: 0 } satisfies RunResult
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const buttons = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].filter((b) => b.textContent === text)

test('the pane lists the tree, renders a page with its action bar, and confirms a destructive action', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView ??= () => {} // jsdom has none
  await import('./view')
  const { paneView } = await import('../panes/registry')
  const { all } = await import('../actions/registry')
  expect(all().some((a) => a.id === 'vault.open')).toBe(true)
  const Pane = paneView('vault')!

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()

  // Noise folds under `other`, shared (empty here) and repos stay out of it.
  expect([...host.querySelectorAll('.vt-agent-name')].map((e) => e.textContent)).toEqual(['shared', 'mnemo-desktop', 'other'])
  expect(host.textContent).not.toContain('noise')

  // No terminal open, so no current repo: only shared starts expanded.
  expect(host.querySelectorAll('.vt-row')).toHaveLength(0)
  await click([...host.querySelectorAll('.vt-agent-head')].find((b) => b.textContent?.includes('mnemo-desktop')))
  await click(host.querySelector('.vt-row'))
  await flush()
  expect(host.querySelector('.vt-title')?.textContent).toBe('shared-target-dir')
  expect(host.querySelector('.vt-md strong')?.textContent).toBe('Why:')
  expect(host.querySelector('.vt-md a.vt-wiki')?.textContent).toBe('shared-target-dir')
  expect(host.querySelector('.vt-meta')?.textContent).toContain('confidence observed')
  expect([...host.querySelectorAll('.vt-actions button')].map((b) => b.textContent)).toEqual([
    'Disable rule',
    'Why',
    'Reverify',
    'Rewrites',
    'Apply safe rewrites',
    'Extract now',
    'Status',
  ])

  await click(buttons(host, 'Disable rule')[0])
  expect(calls.some(([c]) => c === 'vault_run')).toBe(false)
  await click(buttons(host, 'really disable rule?')[0])
  await flush()
  expect(calls.filter(([c]) => c === 'vault_run')).toEqual([['vault_run', { action: 'disable-rule', args: ['shared-target-dir'], cwd: '' }]])
  expect(host.querySelector('.vt-log')?.textContent).toContain('$ mnemo disable-rule shared-target-dir')
  expect(host.querySelector('.vt-log pre')?.textContent).toBe('disabled')

  // Search narrows the tree to matching bodies and opens every agent with a match.
  const input = host.querySelector('.vt-bar input') as HTMLInputElement
  const search = (q: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, q)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  await search('COLD build')
  expect([...host.querySelectorAll('.vt-row-name')].map((e) => e.textContent)).toEqual(['shared-target-dir', 'noise'])
  await search('nothing-matches')
  expect(host.querySelectorAll('.vt-row')).toHaveLength(0)

  await act(async () => root.unmount())
})

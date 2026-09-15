import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { RepoRules, RuleSet } from './types'

const calls: [string, Record<string, unknown> | undefined][] = []
const set: RuleSet = {
  source: '/w/app', name: 'app', path: '/w/app/.mnemo-shared', description: 'Team rules.', rule_count: 4,
  types: { feedback: 3, project: 1 }, topics: ['workflow'], projects: ['app'], last_commit: '2026-09-10T12:00:00+00:00', error: null,
}
const rule = (slug: string, standing: RepoRules['rules'][number]['standing']) => ({ slug, page_type: 'feedback', description: `${slug} says`, rel: `feedback/${slug}.md`, standing })
let repo: RepoRules = {
  root: '/w/app', name: 'app', set, vault: '/v', default_branch: 'main', branch: 'main', uncommitted: true, error: null,
  rules: [rule('login-shell-path-for-clis', 'yours'), rule('no-silent-contract-changes', 'new'), rule('run-tests-before-commit', 'changed'), rule('shared-target-dir', 'same')],
}

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === 'marketplace_list') return []
    if (cmd === 'marketplace_repo') return repo
    if (cmd === 'marketplace_publish') return { output: 'published 1 rule', uncommitted: true }
    if (cmd === 'marketplace_open_pr') return { branch: 'team-rules/x', base: 'main', url: 'https://github.com/t/app/pull/9', output: '$ gh pr create' }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)

test('this repo lists badged rules, publishes, and opens a PR only after confirming', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await import('./view')
  const { paneView } = await import('../panes/registry')
  const { store } = await import('../layout/app-store')
  store.setState({
    tabs: [{ id: 't', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: -1 }, { kind: 'leaf', pane: 1 }] }, focused: -1 }],
    activeTab: 't',
    panes: { [-1]: { id: -1, view: 'marketplace' }, 1: { id: 1, view: 'terminal', cwd: '/w/app/src' } },
  })
  const Pane = paneView('marketplace')!
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()

  expect(calls).toContainEqual(['marketplace_repo', { cwd: '/w/app/src' }])
  const section = host.querySelector('.mk-repo') as HTMLElement
  expect(section.querySelector('.mk-repo-label')?.textContent).toBe('this repo')
  expect([...section.querySelectorAll('.mk-rule')].map((r) => [r.querySelector('.mk-badge')?.textContent, r.querySelector('.mk-rule-slug')?.textContent])).toEqual([
    ['yours', 'login-shell-path-for-clis'],
    ['new', 'no-silent-contract-changes'],
    ['changed', 'run-tests-before-commit'],
    ['same', 'shared-target-dir'],
  ])
  expect(section.textContent).toContain('1 new · 1 changed · 1 yours · 1 same')
  expect(button(section, 'Import all new')).toBeTruthy()
  expect(button(section, 'Import')).toBeTruthy()

  await click(button(section, 'Publish'))
  await flush()
  expect(calls).toContainEqual(['marketplace_publish', { root: '/w/app' }])
  expect(section.querySelector('.mk-output pre')?.textContent).toBe('published 1 rule')

  await click(button(section, 'Open PR'))
  expect(calls.some(([c]) => c === 'marketplace_open_pr')).toBe(false)
  expect(section.querySelector('.mk-confirm')?.textContent).toContain('from origin/main')
  await click(button(section, 'Confirm'))
  await flush()
  expect(calls.filter(([c]) => c === 'marketplace_open_pr')).toHaveLength(1)
  expect(button(section, 'https://github.com/t/app/pull/9')).toBeTruthy()

  // A repo with no tree: one line and its Publish button.
  repo = { ...repo, set: null, rules: [], uncommitted: false }
  await click(button(section, '↻'))
  await flush()
  expect(section.querySelector('.mk-repo-line')?.textContent).toBe('no team rules published yetPublish')
  expect(section.querySelectorAll('.mk-rule')).toHaveLength(0)

  await act(async () => root.unmount())
})

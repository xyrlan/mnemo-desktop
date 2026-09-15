import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createPulseStore } from '../../pulse/store'
import type { Renderer, RendererOptions } from './renderer'
import type { Born, Changed, Positions, VaultMap } from './types'

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: { path?: string }) => {
    if (cmd === 'vault_page') return { path: args?.path, slug: 'a', name: 'Rule A', description: '', type: 'feedback', confidence: 'verified', topics: [], modified: null, body: 'body', runtime: null, frontmatter: [], error: null }
    if (cmd === 'vault_ego') return { center: args?.path, nodes: [], edges: [], total: 0, error: null }
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const { MapView, RELOAD_MS } = await import('./MapView')
const { mapStore } = await import('./store')
const { vault } = await import('../app-store')

const whole: VaultMap = {
  nodes: [
    { path: '/v/shared/a.md', slug: 'a', name: 'Rule A', confidence: 'verified', heat: 2, type: 'feedback', agent: 'shared', fires: 4, ghost: false },
    { path: '/v/bots/repo/memory/b.md', slug: 'b', name: 'b', confidence: null, heat: 0, type: 'project', agent: 'repo', fires: 0, ghost: false },
    { path: '/v/shared/_inbox/a.md', slug: 'a', name: 'Rule A v2', confidence: null, heat: 0, type: 'feedback', agent: 'shared', fires: 0, ghost: true },
  ],
  edges: [
    { source: '/v/bots/repo/memory/b.md', target: '/v/shared/a.md', kind: 'link' },
    { source: '/v/shared/_inbox/a.md', target: '/v/shared/a.md', kind: 'rewrite' },
  ],
  error: null,
}

const flush = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))))

function fakes() {
  const calls: string[] = []
  const saved: [string, Positions][] = []
  let born: ((b: Born) => void) | undefined
  let changed: ((c: Changed) => void) | undefined
  const renderers: (Renderer & { opts: RendererOptions; map: VaultMap; positions: Positions; log: unknown[][] })[] = []
  let answer: VaultMap = whole
  const deps = {
    client: {
      map: async (scope: string) => (calls.push(`map ${scope}`), answer),
      positions: async (scope: string): Promise<Positions> => (calls.push(`positions ${scope}`), { '/v/shared/a.md': [1, 2] }),
      savePositions: async (scope: string, p: Positions) => void saved.push([scope, p]),
      onBorn: async (h: (b: Born) => void) => ((born = h), () => calls.push('off born')),
      onChanged: async (h: (c: Changed) => void) => ((changed = h), () => calls.push('off changed')),
    },
    createRenderer: async (_host: HTMLElement, map: VaultMap, positions: Positions, opts: RendererOptions) => {
      const log: unknown[][] = []
      const r = {
        opts,
        map,
        positions,
        log,
        update: (m: VaultMap) => void log.push(['update', m]),
        fire: (s: readonly string[]) => void log.push(['fire', [...s]]),
        select: (p: string | null) => void log.push(['select', p]),
        relayout: () => void log.push(['relayout']),
        resize: () => {},
        destroy: () => void log.push(['destroy']),
      }
      renderers.push(r)
      return r
    },
    pulses: createPulseStore(),
    readVar: () => '',
  }
  return { deps, calls, saved, renderers, born: (b: Born) => born!(b), changed: (c: Changed) => changed!(c), answer: (m: VaultMap) => (answer = m) }
}

test('the map reads its scope, fires, reloads on born pages, opens a clicked rule, and saves positions', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const f = fakes()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<MapView cwd={undefined} current="repo" deps={f.deps} />))
  await flush()

  expect(f.calls).toEqual(['map ', 'positions '])
  expect(f.renderers).toHaveLength(1)
  const r = f.renderers[0]
  expect(r.map).toBe(whole)
  expect(r.positions).toEqual({ '/v/shared/a.md': [1, 2] })
  expect(r.opts.palette.ok).toMatch(/^#[0-9a-f]{6}$/)
  expect(host.querySelector('.vm-bar .vt-count')?.textContent).toBe('2 rules · 1 links · 1 proposals')
  // The whole-vault map names the scopes to offer, the current repo right after shared.
  expect([...host.querySelectorAll('.vm-bar option')].map((o) => o.textContent)).toEqual(['every agent', 'shared', 'repo'])

  // A pulse naming a rule flashes it; one that arrived before the map opened does not replay.
  act(() => f.deps.pulses.getState().push({ at: 1, kind: 'reflex', project: 'repo', agent: 'repo', slugs: ['a', 'b'] }))
  expect(r.log.filter(([k]) => k === 'fire')).toEqual([['fire', ['a', 'b']]])

  // A click opens the rule and its neighbourhood beside the map; a proposal has no neighbourhood.
  await act(async () => r.opts.onSelect('/v/shared/a.md', false))
  await flush()
  expect(host.querySelector('.vr-side .vt-title')?.textContent).toBe('Rule A')
  expect(host.querySelector('.vr-side .ve')).toBeTruthy()
  expect(r.log.at(-1)).toEqual(['select', '/v/shared/a.md'])
  await act(async () => r.opts.onSelect('/v/shared/_inbox/a.md', true))
  await flush()
  expect(host.querySelector('.vr-side .ve')).toBeNull()

  // Born pages, several at once, re-read the map once and hand it to the renderer.
  const grown: VaultMap = { ...whole, nodes: [...whole.nodes, { ...whole.nodes[1], path: '/v/shared/new.md', slug: 'new', name: 'new' }] }
  f.answer(grown)
  f.born({ path: '/v/shared/new.md', slug: 'new' })
  f.changed({ paths: ['/v/shared/a.md'] })
  await flush(RELOAD_MS + 50)
  expect(f.calls.filter((c) => c === 'map ')).toHaveLength(2)
  expect(r.log.filter(([k]) => k === 'update')).toEqual([['update', grown]])
  expect(host.querySelector('.vm-bar .vt-count')?.textContent).toBe('3 rules · 1 links · 1 proposals')

  // Positions wait for things to settle; leaving writes what is pending at once.
  act(() => r.opts.onPositions({ '/v/shared/a.md': [5, 6] }))
  expect(f.saved).toEqual([])
  await click([...host.querySelectorAll('.vm-bar button')].find((b) => b.textContent === 'Re-layout'))
  expect(r.log.at(-1)).toEqual(['relayout'])

  // Another scope is another renderer; the old one goes, its positions saved under its scope.
  await act(async () => mapStore.getState().setScope('agent:repo'))
  await flush()
  expect(f.saved).toEqual([['', { '/v/shared/a.md': [5, 6] }]])
  expect(r.log.at(-1)).toEqual(['destroy'])
  expect(f.calls.filter((c) => c.endsWith('agent:repo'))).toEqual(['map agent:repo', 'positions agent:repo'])
  expect(f.renderers).toHaveLength(2)

  await act(async () => root.unmount())
  expect(f.renderers[1].log.at(-1)).toEqual(['destroy'])
  expect(f.calls).toContain('off born')
  vault.setState({ selected: null, page: null })
  mapStore.setState({ scope: '' })
})

test('a vault error shows instead of a map', async () => {
  const f = fakes()
  f.answer({ nodes: [], edges: [], error: 'no mnemo vault found' })
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(<MapView cwd={undefined} current={undefined} deps={f.deps} />))
  await flush()
  expect(host.querySelector('.vm-canvas .vt-error')?.textContent).toBe('no mnemo vault found')
  expect(f.renderers).toHaveLength(0)
  await act(async () => root.unmount())
})

const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())

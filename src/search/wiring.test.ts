import type { RepoNode } from '../fleet/store'
import { registerPanel, searchRoot, type RightbarPanel } from './wiring'

const repo = (root: string, worktrees: { path: string; kind: 'main' | 'workspace' }[]): RepoNode => ({ root, name: root, worktrees }) as unknown as RepoNode

describe('the search panel wiring', () => {
  it('registers through the right sidebar’s registry, and waits quietly until it lands', () => {
    const got: RightbarPanel[] = []
    const off = vi.fn()
    const item: RightbarPanel = { id: 'search', title: 'Search', icon: () => null, order: 20, panel: () => null }
    expect(registerPanel(item, { registerRightbarPanel: (i) => (got.push(i), off) })).toBe(off)
    expect(got).toEqual([item])
    expect(() => registerPanel(item, undefined)()).not.toThrow()
  })

  it('searches the worktree on screen, else the first repo’s main checkout', () => {
    const repos = [repo('/code/a', [{ path: '/code/a-wt', kind: 'workspace' }, { path: '/code/a', kind: 'main' }]), repo('/code/b', [])]
    expect(searchRoot('/code/b', repos)).toBe('/code/b')
    expect(searchRoot(null, repos)).toBe('/code/a')
    expect(searchRoot(null, [repo('/code/c', [])])).toBe('/code/c')
    expect(searchRoot(null, [])).toBeNull()
  })
})

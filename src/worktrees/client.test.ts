import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }))

import { createWorktree, listWorktrees, removeWorktree, type WorktreeInfo } from './client'

const tree: WorktreeInfo = {
  path: '/x/repo-wt-a',
  branch: 'a',
  head: 'f'.repeat(40),
  isMain: false,
  dispatched: false,
  dirty: false,
  setupJob: null,
}

describe('worktrees client', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('lists through worktree_list', async () => {
    invoke.mockResolvedValue([tree])
    expect(await listWorktrees('/x/repo')).toEqual([tree])
    expect(invoke).toHaveBeenCalledWith('worktree_list', { repo: '/x/repo' })
  })

  it('creates with every argument the command takes, absent ones as null', async () => {
    invoke.mockResolvedValue(tree)
    expect(await createWorktree('/x/repo', 'a')).toEqual(tree)
    expect(invoke).toHaveBeenLastCalledWith('worktree_create', { repo: '/x/repo', name: 'a', base: null, setup: null })
    await createWorktree('/x/repo', 'a', { base: 'main', setup: 'pnpm install' })
    expect(invoke).toHaveBeenLastCalledWith('worktree_create', { repo: '/x/repo', name: 'a', base: 'main', setup: 'pnpm install' })
  })

  it('removes without force unless asked', async () => {
    invoke.mockResolvedValue(undefined)
    await removeWorktree('/x/repo-wt-a')
    expect(invoke).toHaveBeenLastCalledWith('worktree_remove', { path: '/x/repo-wt-a', force: false })
    await removeWorktree('/x/repo-wt-a', true)
    expect(invoke).toHaveBeenLastCalledWith('worktree_remove', { path: '/x/repo-wt-a', force: true })
  })

  it("passes the backend's refusal through", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error('the main checkout is not removed')))
    await expect(removeWorktree('/x/repo')).rejects.toThrow('the main checkout is not removed')
  })
})

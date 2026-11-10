import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('how the roster is grouped', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  test('is by attention until asked otherwise', async () => {
    const { groupStore } = await import('./group')
    expect(groupStore.getState().group).toBe('attention')
  })

  test('is kept from one launch to the next', async () => {
    const first = await import('./group')
    first.toggleGroup()
    expect(first.groupStore.getState().group).toBe('project')
    vi.resetModules()
    const next = await import('./group')
    expect(next.groupStore).not.toBe(first.groupStore)
    expect(next.groupStore.getState().group).toBe('project')
    next.toggleGroup()
    vi.resetModules()
    expect((await import('./group')).groupStore.getState().group).toBe('attention')
  })

  test('anything else that was kept is read as by attention', async () => {
    localStorage.setItem('mnemo.roster.group', 'size')
    expect((await import('./group')).groupStore.getState().group).toBe('attention')
  })
})

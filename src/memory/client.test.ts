import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMemoryFeed } from './client'
import type { MemoryFeed } from './types'

// A plain stand-in, not a spy: the core's refusal is a bare string, and a `vi.fn()` reset in
// `beforeEach` that then rejected with one failed the test as "Unknown Error" under vitest 5,
// though the client caught it.
const core = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, answer: (): Promise<unknown> => Promise.resolve(null) }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => {
    core.calls.push([cmd, args])
    return core.answer()
  },
}))

const feed: MemoryFeed = {
  project: 'mnemo-desktop',
  briefing: { sessionId: 's0', date: '2026-09-24', tldr: 'Did it.', path: '/v/bots/mnemo-desktop/briefings/sessions/s0.md' },
  fired: [{ slug: 'x', name: 'X', at: 2, source: 'denial' }],
  learned: [{ slug: 'y', name: 'Y', at: 1 }],
  inbox: [{ key: 'feedback/z', type: 'feedback', title: 'Z', excerpt: 'z' }],
}

describe('getMemoryFeed', () => {
  beforeEach(() => {
    core.calls = []
  })

  it('asks the core for the cwd and session, in its argument names', async () => {
    core.answer = async () => feed
    await expect(getMemoryFeed('/r', 's1')).resolves.toEqual(feed)
    expect(core.calls).toEqual([['memory_feed', { cwd: '/r', sessionId: 's1' }]])
  })

  it('sends no session as null', async () => {
    core.answer = async () => ({ ...feed, briefing: null })
    await getMemoryFeed('/r')
    expect(core.calls).toEqual([['memory_feed', { cwd: '/r', sessionId: null }]])
  })

  it("passes the core's refusal on as an Error", async () => {
    core.answer = async () => {
      throw 'no mnemo vault found'
    }
    const err = await getMemoryFeed('/r').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('no mnemo vault found')
  })

  it('refuses an answer of another shape', async () => {
    core.answer = async () => ({ project: 'p' })
    await expect(getMemoryFeed('/r')).rejects.toThrow(/cannot read/)
  })
})

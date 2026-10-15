import { child, parent } from '../mission/fixtures'
import type { Pr, Snapshot } from '../mission/types'
import { asksFrom, makeShipClient } from './ship-client'

const pr = (n: number): Pr => ({ number: n, url: `https://github.com/o/r/pull/${n}`, state: 'OPEN', head: `b${n}`, ci: 'pass' })

const snap: Snapshot = {
  at: '1',
  errors: [],
  repos: [
    {
      root: '/r',
      name: 'r',
      parents: [parent({ session_id: 'p1', cwd: '/r', account: 'work' }), parent({ session_id: 'p2', cwd: '/r' })],
      children: [child({ id: 'c1', session_id: 's1', cwd: '/r-wt-1', pr: pr(1) }), child({ id: 'c0', session_id: null, cwd: '/r-wt-0' })],
      missions: [
        {
          feature: 'f',
          contract_path: '/r/c.md',
          landable: false,
          pieces: [
            { name: 'a', branch: 'feat/f/a', child: child({ id: 'c2', session_id: 's2', cwd: '/r-wt-a', pr: pr(7) }), pr: pr(2) },
            { name: 'b', branch: 'feat/f/b', child: null, pr: null },
          ],
        },
      ],
    },
  ],
}

test('asks once per live parent and per child with a session, a piece’s PR over its child’s', () => {
  expect(asksFrom(snap)).toEqual([
    { key: 'p1', sessionId: 'p1', cwd: '/r', account: 'work', jobId: null, prUrl: null },
    { key: 'p2', sessionId: 'p2', cwd: '/r', account: 'default', jobId: null, prUrl: null },
    { key: 'c1', sessionId: 's1', cwd: '/r-wt-1', account: 'default', jobId: 'c1', prUrl: pr(1).url },
    { key: 'c2', sessionId: 's2', cwd: '/r-wt-a', account: 'default', jobId: 'c2', prUrl: pr(2).url },
  ])
})

test('the client asks `nexus_feed` with the asks', async () => {
  const calls: Array<[string, unknown]> = []
  const client = makeShipClient(async <T,>(cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    return { sessions: {}, prs: {}, rate: null, at: 1 } as T
  })
  await client.feed(asksFrom(snap))
  expect(calls[0][0]).toBe('nexus_feed')
  expect((calls[0][1] as { asks: unknown[] }).asks).toHaveLength(4)
})

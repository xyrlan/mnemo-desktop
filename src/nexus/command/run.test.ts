import { child, MNEMO, pr, ROOT, ship } from './fixtures'
import { act, type Outcome, type Paths } from './run'

type Call = [string, ...unknown[]]

/** Paths that record each call and answer as told. */
function paths(over: Partial<Paths> = {}) {
  const calls: Call[] = []
  const ok: Outcome = { ok: true, why: '' }
  const p: Paths = {
    answerQuestion: async (c, i) => void calls.push(['answerQuestion', c.id, i]),
    answerQuestionOther: async (c, t) => void calls.push(['answerQuestionOther', c.id, t]),
    answerPrompt: async (c, choice) => (calls.push(['answerPrompt', c.id, choice]), ok),
    merge: async (root, pr) => (calls.push(['merge', root, pr.number]), ok),
    land: async (root, m) => (calls.push(['land', root, m.contract_path]), ok),
    stop: async (root, cs) => (calls.push(['stop', root, ...cs.map((c) => c.id)]), { ok: true, why: '(typed in a terminal tab)' }),
    reply: async (id, text) => void calls.push(['reply', id, text]),
    paneOf: (sessionId) => (sessionId.startsWith('cap-1') ? 7 : null),
    prompt: async (pane, text) => void calls.push(['prompt', pane, text]),
    dispatch: async (root, issues) => (calls.push(['dispatch', root, ...issues]), ok),
    now: () => 5_000,
    ...over,
  }
  return { p, calls }
}

test('a question is answered by its option, its number, or in words, on the child', async () => {
  const { p, calls } = paths()
  const s = ship()
  const r = await act(p, { kind: 'answer', robotId: '101', text: 'drop it' }, s)
  expect(r).toMatchObject({ ok: true, say: '↩ #101: Drop it' })
  expect(r.log).toEqual([expect.objectContaining({ kind: 'you', at: 5_000, robotId: '101', text: 'you answered #101: Drop it' })])
  await act(p, { kind: 'answer', robotId: '101', text: '1' }, s)
  await act(p, { kind: 'answer', robotId: '101', text: 'neither, wait for me' }, s)
  expect(calls).toEqual([
    ['answerQuestion', '101', 1],
    ['answerQuestion', '101', 0],
    ['answerQuestionOther', '101', 'neither, wait for me'],
  ])
})

test('a permission takes yes, always or no and nothing else', async () => {
  const { p, calls } = paths()
  const s = ship()
  expect(await act(p, { kind: 'answer', robotId: '102', text: 'no' }, s)).toMatchObject({ ok: true, say: '↩ #102: denied' })
  expect(await act(p, { kind: 'answer', robotId: '102', text: 'always' }, s)).toMatchObject({ ok: true, say: '↩ #102: approved, and not asked again' })
  expect(await act(p, { kind: 'answer', robotId: '102', text: 'maybe' }, s)).toEqual({ ok: false, say: '#102 asks a permission: answer yes, always or no', log: [] })
  expect(calls).toEqual([
    ['answerPrompt', '102', 'no'],
    ['answerPrompt', '102', 'always'],
  ])
})

test('an answer refused says why and logs nothing', async () => {
  const { p } = paths({ answerQuestion: async () => Promise.reject(new Error('101 is not asking a question now: nothing was typed')) })
  expect(await act(p, { kind: 'answer', robotId: '101', text: 'Keep it' }, ship())).toEqual({ ok: false, say: '#101: 101 is not asking a question now: nothing was typed', log: [] })
  expect(await act(p, { kind: 'answer', robotId: '103', text: 'yes' }, ship())).toMatchObject({ ok: false, say: '#103 is not waiting for an answer: nothing was sent' })
  expect(await act(p, { kind: 'answer', robotId: 'gone', text: 'yes' }, ship())).toMatchObject({ ok: false, say: 'gone is not on the ship any more: nothing was sent' })
})

test('a merge goes one PR at a time, in the deck’s repo, and reports each', async () => {
  const order: number[] = []
  const { p } = paths({
    merge: async (root, pr) => {
      expect(root).toBe(ROOT)
      order.push(pr.number)
      return pr.number === 206 ? { ok: false, why: '1 check failed: windows' } : { ok: true, why: '' }
    },
  })
  const r = await act(p, { kind: 'merge', robotIds: ['105', '206' as string, '106', '103'] }, ship())
  expect(order).toEqual([205, 206])
  expect(r.ok).toBe(false)
  expect(r.say).toBe('✈ merged PR #205 (#105) · not merged: 206 (not on the ship any more) · PR #206 (#106): 1 check failed: windows · #103 (no PR)')
  expect(r.log.map((e) => e.text)).toEqual(['you merged PR #205 (#105)'])
})

test('land runs on the landable mission only', async () => {
  const { p, calls } = paths()
  expect(await act(p, { kind: 'land', root: ROOT, feature: 'nexus-v2' }, ship())).toMatchObject({ ok: true, say: '⇪ mission nexus-v2 landed' })
  expect(calls).toEqual([['land', ROOT, 'docs/superpowers/contracts/2026-10-15-nexus-v2.md']])
  expect(await act(p, { kind: 'land', root: MNEMO, feature: 'nexus-v2' }, ship())).toMatchObject({ ok: false, say: 'mission nexus-v2 is not landable now: nothing was run' })
  const failed = paths({ land: async () => ({ ok: false, why: 'stopped at feed: nothing was landed.' }) })
  expect(await act(failed.p, { kind: 'land', root: ROOT, feature: 'nexus-v2' }, ship())).toMatchObject({ ok: false, say: 'mission nexus-v2 did not land: stopped at feed: nothing was landed.' })
})

test('stop reaches only running children, and logs each', async () => {
  const { p, calls } = paths()
  const r = await act(p, { kind: 'stop', robotIds: ['103', '105', '107'] }, ship())
  expect(calls).toEqual([['stop', ROOT, '103', '107']])
  expect(r.say).toBe('■ claude stop for #103 #107 (typed in a terminal tab) — each keeps its conversation')
  expect(r.log.map((e) => [e.robotId, e.text])).toEqual([
    ['103', 'you stopped #103'],
    ['107', 'you stopped #107'],
  ])
  expect(await act(p, { kind: 'stop', robotIds: ['105'] }, ship())).toMatchObject({ ok: false, say: 'none of them is running: nothing was stopped' })
})

test('a child is written to through its inbox, a captain in the pane it runs in', async () => {
  const { p, calls } = paths({
    reply: async (id, text) => {
      if (id === '104b') throw 'no inbox socket found for 104b'
      calls.push(['reply', id, text])
    },
  })
  const r = await act(p, { kind: 'message', ids: ['103', 'cap-1-0000-4000-8000-000000000000', '104b'], text: ' rebase ' }, ship())
  expect(calls).toEqual([
    ['reply', '103', 'rebase'],
    ['prompt', 7, 'rebase'],
  ])
  expect(r).toMatchObject({ ok: false, say: '✉ sent to #103, ◆ fleet lead · not sent: #104·b: no inbox socket found for 104b' })
  expect(r.log.map((e) => [e.robotId, e.captainId, e.text])).toEqual([
    ['103', 'cap-1-0000-4000-8000-000000000000', 'you wrote to #103: rebase'],
    [null, 'cap-1-0000-4000-8000-000000000000', 'you wrote to ◆ fleet lead: rebase'],
  ])
})

test('a captain in no pane is tried as a background session, and refused clearly when it is not one', async () => {
  const roster = new Set(['cap-3-00'])
  const { p, calls } = paths({
    reply: async (id, text) => {
      if (!roster.has(id)) throw new Error(`${id} is not in the daemon roster`)
      calls.push(['reply', id, text])
    },
  })
  const r = await act(p, { kind: 'message', ids: ['cap-2-0000-4000-8000-000000000000', 'cap-3-0000-4000-8000-000000000000'], text: 'hi' }, ship())
  expect(calls).toEqual([['reply', 'cap-3-00', 'hi']])
  expect(r.say).toBe('✉ sent to ▲ mnemo main · not sent: ● reviewer: not open in a pane here, and not a background session with an inbox: nothing was sent')
})

test('dispatch runs in the repo and names it', async () => {
  const { p, calls } = paths()
  expect(await act(p, { kind: 'dispatch', root: MNEMO, issues: [12, 13] }, ship())).toMatchObject({ ok: true, say: '⇣ dispatched #12 #13 in mnemo' })
  expect(calls).toEqual([['dispatch', MNEMO, 12, 13]])
  const refused = paths({ dispatch: async () => ({ ok: false, why: 'issue #12 is closed' }) })
  expect(await act(refused.p, { kind: 'dispatch', root: MNEMO, issues: [12] }, ship())).toEqual({ ok: false, say: '#12 not dispatched in mnemo: issue #12 is closed', log: [] })
})

test('opening is the view’s, never an action', async () => {
  const { p, calls } = paths()
  expect(await act(p, { kind: 'open', id: '103' }, ship())).toMatchObject({ ok: false })
  expect(calls).toEqual([])
})

test('two of the same thing you did are two milestones', async () => {
  const { p } = paths()
  const a = await act(p, { kind: 'message', ids: ['103'], text: 'hi' }, ship())
  const b = await act(p, { kind: 'message', ids: ['103'], text: 'hi' }, ship())
  expect(a.log[0].id).not.toBe(b.log[0].id)
})

test('a merge runs in the child’s own repo, not its captain’s, and refuses a PR of another repo', async () => {
  const s = ship()
  // A mnemo-desktop child dispatched by a captain of mnemo stands on mnemo's deck.
  s.decks[0] = { ...s.decks[0], root: MNEMO, name: 'mnemo' }
  s.docks = [{ root: ROOT, name: 'mnemo-desktop', captains: [] }]
  const roots: string[] = []
  const { p } = paths({ merge: async (root) => (roots.push(root), { ok: true, why: '' }) })
  expect(await act(p, { kind: 'merge', robotIds: ['105'] }, s)).toMatchObject({ ok: true })
  expect(roots).toEqual([ROOT])
  const stray = ship()
  stray.decks[0].hangar[0] = { ...stray.decks[0].hangar[0], pr: pr(205, { url: 'https://github.com/you/mnemo/pull/205' }) }
  const r = await act(p, { kind: 'merge', robotIds: ['105'] }, stray)
  expect(r).toMatchObject({ ok: false, say: 'not merged: PR #205 (#105): PR #205 is in you/mnemo, not in mnemo-desktop' })
  expect(roots).toHaveLength(1)
})

test('land runs where its pieces work, and refuses a piece whose PR is in another repo', async () => {
  const s = ship()
  const x = s.bridge.exceptions.find((e) => e.kind === 'land')!
  if (x.kind !== 'land') throw new Error('no land row')
  x.mission.pieces = [{ name: 'feed', branch: 'feat/x/feed', child: child('f1', { cwd: `${ROOT}/.claude/worktrees/feed` }), pr: pr(301) }]
  const { p, calls } = paths()
  await act(p, { kind: 'land', root: ROOT, feature: 'nexus-v2' }, s)
  expect(calls[0].slice(0, 2)).toEqual(['land', ROOT])
  x.mission.pieces[0].pr = pr(301, { url: 'https://github.com/you/mnemo/pull/301' })
  expect(await act(p, { kind: 'land', root: ROOT, feature: 'nexus-v2' }, s)).toMatchObject({ ok: false, say: 'mission nexus-v2 did not land: PR #301 is in you/mnemo, not in mnemo-desktop' })
  expect(calls).toHaveLength(1)
})

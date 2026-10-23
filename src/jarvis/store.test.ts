import type { ParentRef } from './parent'
import { addLine, approvals, createJarvisStore, foldParent, MAX_LINES, parentLine } from './store'

const ref = (sessionId: string): ParentRef => ({ sessionId, project: 'tasklist', root: '/Users/you/code/tasklist', request: 'corrige', host: 'claude', startedAt: 0 })

test('the panel keeps the last lines', () => {
  const store = createJarvisStore()
  for (let i = 0; i < MAX_LINES + 5; i++) addLine(store, { who: 'james', text: `${i}` }, i)
  const lines = store.getState().lines
  expect(lines).toHaveLength(MAX_LINES)
  expect(lines[0].text).toBe('5')
  expect(new Set(lines.map((l) => l.id)).size).toBe(MAX_LINES)
})

test("a parent's events fold into its row, newest parent first", () => {
  let ps = foldParent([], { kind: 'opened', parent: ref('a') })
  ps = foldParent(ps, { kind: 'opened', parent: ref('b') })
  expect(ps.map((p) => [p.ref.sessionId, p.state])).toEqual([
    ['b', 'starting'],
    ['a', 'starting'],
  ])
  ps = foldParent(ps, { kind: 'asking', parent: ref('a'), question: 'Qual branch?' })
  ps = foldParent(ps, { kind: 'approval', parent: ref('b'), question: 'Rodar gh pr create?' })
  expect(ps.map((p) => [p.ref.sessionId, p.state, p.question])).toEqual([
    ['b', 'approval', 'Rodar gh pr create?'],
    ['a', 'asking', 'Qual branch?'],
  ])
  ps = foldParent(ps, { kind: 'turn-ended', parent: ref('b'), summary: 'Abri o PR.' })
  expect(ps[0]).toMatchObject({ state: 'idle', summary: 'Abri o PR.', question: null })
  ps = foldParent(ps, { kind: 'exited', parent: ref('a') })
  expect(ps.map((p) => p.ref.sessionId)).toEqual(['b'])
})

test('an event from a parent not yet seen adds it', () => {
  expect(foldParent([], { kind: 'turn-ended', parent: ref('x'), summary: 'Pronto.' })).toEqual([{ ref: ref('x'), state: 'idle', summary: 'Pronto.', question: null }])
})

test('the approvals waiting, oldest first', () => {
  let ps = foldParent([], { kind: 'approval', parent: ref('a'), question: 'q1' })
  ps = foldParent(ps, { kind: 'approval', parent: ref('b'), question: 'q2' })
  ps = foldParent(ps, { kind: 'opened', parent: ref('c') })
  expect(approvals({ parents: ps }).map((p) => p.ref.sessionId)).toEqual(['a', 'b'])
})

test('each event has its line', () => {
  expect(parentLine({ kind: 'turn-ended', parent: ref('a'), summary: 'Abri o PR #12.' })).toBe('Abri o PR #12.')
  expect(parentLine({ kind: 'asking', parent: ref('a'), question: 'Qual?' })).toBe('Pergunta: Qual?')
  expect(parentLine({ kind: 'approval', parent: ref('a'), question: 'Push?' })).toBe('Espera aprovação: Push?')
  expect(parentLine({ kind: 'exited', parent: ref('a') })).toBe('Parent encerrado.')
})

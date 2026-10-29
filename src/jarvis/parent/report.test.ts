import type { ParentEvent, ParentRef } from './index'
import { reportOf, SAY_MAX } from './report'

const parent: ParentRef = { sessionId: 'parent-1', project: 'tasklist', root: '/work/tasklist', request: 'corrige o teste de upload', host: 'claude', startedAt: 0 }
const LAST = 'Corrigi o teste de upload: o timeout era de 1.5 s. Abri o PR 12. O CI do Windows ainda roda; os outros passaram.'

test('a turn that ended: two sentences of its last message said, the whole message told with the request', () => {
  const r = reportOf({ kind: 'turn-ended', parent, summary: 'Corrigi o teste de upload: o timeout era de 1.5 s.', last: LAST })
  expect(r).toEqual({
    say: 'O parent do tasklist terminou: Corrigi o teste de upload: o timeout era de 1.5 s. Abri o PR 12.',
    tell: `O parent do tasklist (pedido «corrige o teste de upload») terminou a vez. A última mensagem dele:\n${LAST}`,
  })
})

test('a turn that ended: what is said is bounded, the summary stands in for a message not carried, and no words are said as such', () => {
  const long = reportOf({ kind: 'turn-ended', parent, summary: 'x', last: 'y'.repeat(2000) })!
  expect(long.say!.length).toBeLessThanOrEqual('O parent do tasklist terminou: '.length + SAY_MAX)
  expect(reportOf({ kind: 'turn-ended', parent, summary: 'Pronto.' })).toEqual({
    say: 'O parent do tasklist terminou: Pronto.',
    tell: 'O parent do tasklist (pedido «corrige o teste de upload») terminou a vez: Pronto.',
  })
  expect(reportOf({ kind: 'turn-ended', parent, summary: 'Terminou a vez sem dizer nada.', last: '' })).toEqual({
    say: 'O parent do tasklist terminou a vez sem dizer nada.',
    tell: 'O parent do tasklist (pedido «corrige o teste de upload») terminou a vez sem dizer nada.',
  })
})

test('a question or a permission prompt is said, since only the maintainer can answer it; the brain is told what waits', () => {
  expect(reportOf({ kind: 'asking', parent, question: 'Which branch?' })).toEqual({
    say: 'O parent do tasklist pergunta: Which branch?',
    tell: 'O parent do tasklist (pedido «corrige o teste de upload») parou numa pergunta e espera a resposta do usuário: Which branch?',
  })
  const approval = reportOf({ kind: 'approval', parent, question: 'Bash: git push origin fix' })!
  expect(approval.say).toBe('O parent do tasklist pede aprovação: Bash: git push origin fix')
  expect(approval.tell).toContain('aprovar ou negar')
  expect(approval.tell).toContain('Bash: git push origin fix')
})

test('an exit is told only; an opening is no report; a long request is cut in what is told', () => {
  expect(reportOf({ kind: 'exited', parent })).toEqual({ say: null, tell: 'O parent do tasklist (pedido «corrige o teste de upload») encerrou.' })
  expect(reportOf({ kind: 'opened', parent })).toBeNull()
  const e: ParentEvent = { kind: 'exited', parent: { ...parent, request: 'z'.repeat(500) } }
  expect(reportOf(e)!.tell.length).toBeLessThan(200)
})

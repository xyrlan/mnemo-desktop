import { MNEMO, ROOT, ship } from './fixtures'
import { parseCommand, parseNew, suggest, VERBS } from './parse'

const s = ship()
const err = (line: string) => {
  const p = parseCommand(line, s)
  if (!('error' in p)) throw new Error(`${line} parsed as ${JSON.stringify(p)}`)
  return p.error
}

test('anything that is not a verb is a hint, never an action', () => {
  expect(err('merge everything')).toMatch(/^start with \//)
  expect(err('')).toMatch(/^start with \//)
  expect(err('/deploy prod')).toBe('unknown /deploy — use /new, /dispatch, /msg, /merge green, /stop all or /land')
})

test('/dispatch names a repo on the ship and one or more issues', () => {
  expect(parseCommand('/dispatch mnemo #123', s)).toEqual({ action: { kind: 'dispatch', root: MNEMO, issues: [123] } })
  expect(parseCommand('/dispatch MNEMO-desktop #12 #13, 14 #12', s)).toEqual({ action: { kind: 'dispatch', root: ROOT, issues: [12, 13, 14] } })
  expect(err('/dispatch elsewhere #1')).toBe('no repo called elsewhere on the ship — repos: mnemo-desktop, mnemo')
  expect(err('/dispatch mnemo')).toMatch(/^usage: \/dispatch/)
  expect(err('/dispatch mnemo #x')).toMatch(/^usage: \/dispatch/)
})

test('a long /dispatch with a stray word is refused at once', () => {
  const line = `/dispatch mnemo ${Array.from({ length: 40 }, (_, i) => `#${i + 1}`).join(' ')} please`
  const t = performance.now()
  expect(err(line)).toMatch(/^usage: \/dispatch/)
  expect(performance.now() - t).toBeLessThan(50)
})

test('/msg writes to one issue, all its twins, one twin, a piece, a captain', () => {
  expect(parseCommand('/msg #103 rebase on main', s)).toEqual({ action: { kind: 'message', ids: ['103'], text: 'rebase on main' } })
  expect(parseCommand('/msg #104 both of you', s)).toEqual({ action: { kind: 'message', ids: ['104a', '104b'], text: 'both of you' } })
  expect(parseCommand('/msg #104·b only you', s)).toEqual({ action: { kind: 'message', ids: ['104b'], text: 'only you' } })
  expect(parseCommand('/msg feed check the types', s)).toEqual({ action: { kind: 'message', ids: ['feed1'], text: 'check the types' } })
  expect(parseCommand('/msg fleet lead dispatch #9 please', s)).toEqual({ action: { kind: 'message', ids: ['cap-1-0000-4000-8000-000000000000'], text: 'dispatch #9 please' } })
  expect(parseCommand('/msg reviewer look at #205', s)).toEqual({ action: { kind: 'message', ids: ['cap-2-0000-4000-8000-000000000000'], text: 'look at #205' } })
  expect(err('/msg #999 hello')).toBe('nobody called #999 on the ship right now')
  expect(err('/msg #103')).toBe('usage: /msg <#issue | captain | all> <text>')
})

test('the batch verbs ask for /yes first', () => {
  const all = parseCommand('/msg all wrap up', s)
  expect(all).toEqual({
    confirm: { kind: 'message', ids: ['103', '104a', '104b', 'feed1', '107'], text: 'wrap up' },
    prompt: 'message 5 children: #103 #104·a #104·b feed #107 — type /yes within 20 s to confirm',
  })
  expect(parseCommand('/merge green', s)).toEqual({ confirm: { kind: 'merge', robotIds: ['105'] }, prompt: 'merge 1 green PR: #105 — type /yes within 20 s to confirm' })
  const stop = parseCommand('/stop all', s)
  expect(stop).toEqual({
    confirm: { kind: 'stop', robotIds: ['101', '102', '103', '104a', '104b', 'feed1', '107'] },
    prompt: 'stop 7 running children: #101 #102 #103 #104·a #104·b feed #107 — type /yes within 20 s to confirm',
  })
  expect(parseCommand('/yes', s)).toEqual({ yes: true })
  expect(err('/merge red')).toMatch(/^usage: \/merge green/)
  expect(err('/stop #103')).toMatch(/^usage: \/stop all/)
})

test('a batch with nobody to act on says so instead of asking', () => {
  const calm = { ...ship(), bridge: { exceptions: [], blocked: [] } }
  calm.decks = calm.decks.map((d) => ({ ...d, flight: [], hangar: d.hangar.filter((r) => r.ci !== 'green'), stranded: [] }))
  expect(parseCommand('/merge green', calm)).toEqual({ error: 'no green PR waiting for merge right now' })
  expect(parseCommand('/stop all', calm)).toEqual({ error: 'no child is running right now' })
  expect(parseCommand('/msg all hi', calm)).toEqual({ error: 'no child is running right now' })
})

test('/land takes a landable mission by its feature', () => {
  expect(parseCommand('/land nexus-v2', s)).toEqual({ action: { kind: 'land', root: ROOT, feature: 'nexus-v2' } })
  expect(err('/land other')).toBe('mission other is not landable — landable now: nexus-v2')
  expect(err('/land')).toBe('usage: /land <feature> — landable now: nexus-v2')
})

test('/new names a repo on the ship as /dispatch does; any other line is not it', () => {
  expect(parseNew('/new mnemo', s)).toEqual({ root: MNEMO, name: 'mnemo' })
  expect(parseNew('  /NEW Mnemo-Desktop ', s)).toEqual({ root: ROOT, name: 'mnemo-desktop' })
  expect(parseNew(`/new ${ROOT}`, s)).toEqual({ root: ROOT, name: 'mnemo-desktop' })
  expect(parseNew('/new elsewhere', s)).toEqual({ error: 'no repo called elsewhere on the ship — repos: mnemo-desktop, mnemo' })
  expect(parseNew('/new', s)).toEqual({ error: 'usage: /new <repo> — starts claude in that repo' })
  expect(parseNew('/new mnemo now', s)).toEqual({ error: 'usage: /new <repo> — starts claude in that repo' })
  expect(parseNew('/newer mnemo', s)).toBeNull()
  expect(parseNew('/dispatch mnemo #1', s)).toBeNull()
  // A repo PROJECTS lists but the ship does not (no session in it yet) starts too.
  const known = [{ root: '/Users/you/code/notes', name: 'notes' }]
  expect(parseNew('/new notes', s, known)).toEqual({ root: '/Users/you/code/notes', name: 'notes' })
  expect(parseNew('/new mnemo', s, known)).toEqual({ root: MNEMO, name: 'mnemo' })
  expect(parseNew('/new elsewhere', s, known)).toEqual({ error: 'no repo called elsewhere — open PROJECTS to add it' })
})

test('every verb the command line suggests is one the parser takes', () => {
  const s = ship()
  for (const v of VERBS) {
    const p = parseNew(v.fill, s) ?? parseCommand(v.fill, s)
    expect('error' in p ? p.error : '').not.toMatch(/^unknown|^start with/)
  }
})

test('suggest: the verbs a line is the start of, then, inside one, that verb alone', () => {
  const syntax = (t: string) => suggest(t).map((v) => v.syntax)
  expect(syntax('/')).toHaveLength(VERBS.length)
  expect(syntax('/M')).toEqual(['/msg all <text>', '/msg <#issue | captain> <text>', '/merge green'])
  expect(syntax('/msg all')).toEqual(['/msg all <text>', '/msg <#issue | captain> <text>'])
  expect(syntax('/msg all hi')).toEqual(['/msg all <text>'])
  expect(syntax('/msg #12 hi')).toEqual(['/msg <#issue | captain> <text>'])
  expect(syntax('/dispatch mnemo #1')).toEqual(['/dispatch <repo> #<issue>'])
  expect(syntax('/x')).toEqual([])
  expect(syntax('')).toEqual([])
  expect(syntax('msg')).toEqual([])
})

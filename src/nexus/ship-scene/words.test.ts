import { captain, mission, pr, robot, ship } from './fixtures'
import { ago, captainHover, bridgeStatus, doingOf, exceptionRow, logTone, lookOf, particlesOf, poseOf, rateChip, relation, robotLine, robotMore, robotName, SLEEP_MS, tokensWord, toneOf } from './words'

test('ago reads like the prototype', () => {
  expect(ago(40_000)).toBe('40s')
  expect(ago(48 * 60_000)).toBe('48 min')
  expect(ago(5.1 * 3_600_000)).toBe('5.1 h')
  expect(ago(2 * 3_600_000)).toBe('2 h')
})

test('the rate chip: calls and output a minute, input and cache share on hover, no cost', () => {
  const r = rateChip({ callsPerMin: 4.4, outPerMin: 2_300, inPerMin: 1_200_000, cacheShare: 0.93 })
  expect(r.text).toBe('⚡ 4 calls/min · 2k out tok/min')
  expect(r.title).toContain('input: 1.2M tok/min, 93% read from cache')
  expect(r.title).not.toMatch(/\$\d/)
  expect(rateChip(null).text).toBe('⚡ —')
})

test('a twin is named with its suffix once', () => {
  expect(robotName({ label: '#404', twin: 'a' })).toBe('#404·a')
  expect(robotName({ label: '#404·a', twin: 'a' })).toBe('#404·a')
  expect(robotName({ label: 'scene', twin: null })).toBe('scene')
})

test('what a robot says: its line and act; a finished one its PR and CI; a stopped one that it can resume', () => {
  expect(robotLine(robot('1', { line: 'fixing tests', act: 'Bash · pnpm test' }))).toEqual({ say: 'fixing tests', act: 'Bash · pnpm test' })
  expect(robotLine(robot('1', { line: '', act: 'idle for 6 min' }))).toEqual({ say: 'idle for 6 min', act: '' })
  expect(robotLine(robot('1', { state: 'done', pr: pr(382), ci: 'green', line: 'On Windows you can now choose' })).say).toBe('✓ PR #382 · CI green · waiting for merge — On Windows you can now choose')
  expect(robotLine(robot('1', { state: 'done', pr: null, line: '' })).say).toBe('✓ finished')
  expect(robotLine(robot('1', { state: 'stopped' })).say).toMatch(/^■ stopped/)
})

/** The issue's table (#473): every state, its pose, prop, prop motion, particles and halo, its
 *  body's motion, and the words its name and hover say instead of the old badge. */
const STATES: [string, Partial<Parameters<typeof robot>[1]>, ReturnType<typeof lookOf>, string][] = [
  ['working · read', { action: 'read' }, { pose: 'working', prop: 'read', motion: 'scan', particles: 'pages', halo: 'working', body: 'bob' }, 'reading'],
  ['working · edit', { action: 'edit' }, { pose: 'working', prop: 'edit', motion: 'weld', particles: 'sparks', halo: 'working', body: 'bob' }, 'editing'],
  ['working · test', { action: 'test' }, { pose: 'working', prop: 'test', motion: 'swirl', particles: 'bubbles', halo: 'working', body: 'bob' }, 'testing'],
  ['working · ship', { action: 'ship' }, { pose: 'working', prop: 'ship', motion: 'lift', particles: 'radar', halo: 'working', body: 'bob' }, 'shipping'],
  ['working · run', { action: 'run' }, { pose: 'working', prop: 'run', motion: 'flip', particles: 'radar', halo: 'working', body: 'bob' }, 'running a long command'],
  ['need', { state: 'need', zone: 'bridge', action: null }, { pose: 'waiting', prop: 'need', motion: 'wave', particles: null, halo: 'need', body: null }, 'waits for you'],
  ['stopped', { state: 'stopped', action: null }, { pose: 'sleeping', prop: null, motion: null, particles: null, halo: null, body: null }, 'stopped'],
  ['done · CI green', { state: 'done', zone: 'hangar', action: null, ci: 'green' }, { pose: 'idle', prop: 'green', motion: 'flag', particles: null, halo: 'done', body: 'breathe' }, 'finished, CI green'],
  ['done · CI red', { state: 'done', zone: 'hangar', action: null, ci: 'red' }, { pose: 'idle', prop: 'red', motion: 'smoke', particles: 'smoke', halo: 'need', body: 'breathe' }, 'finished, CI red'],
  ['done · CI running', { state: 'done', zone: 'hangar', action: null, ci: 'run' }, { pose: 'idle', prop: 'run', motion: 'flip-slow', particles: null, halo: 'working', body: 'breathe' }, 'finished, CI running'],
  ['idle', { state: 'idle', action: null, idleMs: 60_000 }, { pose: 'idle', prop: null, motion: null, particles: null, halo: null, body: 'breath' }, 'idle'],
  ['stranded', { state: 'idle', zone: 'stranded', action: null, idleMs: 20 * 60_000 }, { pose: 'sleeping', prop: null, motion: null, particles: 'zz', halo: null, body: 'breath-slow' }, 'stranded'],
]

test.each(STATES)('%s: its pose, prop, motion, particles and halo (#473)', (_, over, look, doing) => {
  const r = robot('1', over)
  expect(lookOf(r)).toEqual(look)
  expect(poseOf(r)).toBe(look.pose)
  expect(particlesOf(r)).toBe(look.particles)
  expect(doingOf(r)).toBe(doing)
})

test('the rest of the states fall where their nearest row does', () => {
  // CI queued reads as CI running; a finished robot with no CI as CI green.
  expect(lookOf(robot('1', { state: 'done', action: null, ci: 'wait' }))).toMatchObject({ prop: 'run', motion: 'flip-slow', halo: 'working' })
  expect(doingOf(robot('1', { state: 'done', action: null, ci: 'wait' }))).toBe('finished, CI queued')
  expect(lookOf(robot('1', { state: 'done', action: null, ci: null }))).toMatchObject({ prop: 'green', halo: 'done' })
  expect(doingOf(robot('1', { state: 'done', action: null, ci: null }))).toBe('finished')
  // Working with no action known reads.
  expect(lookOf(robot('1', { action: null }))).toMatchObject({ prop: 'read', motion: 'scan', particles: 'pages' })
  // Ten minutes idle and it sleeps, still with no prop.
  expect(lookOf(robot('1', { state: 'idle', action: null, idleMs: SLEEP_MS + 1 }))).toMatchObject({ pose: 'sleeping', prop: null, body: 'breath' })
})

test('the hover lists title, model and context, contract, twin and rules', () => {
  const r = robot('1', { contract: { feature: 'nexus-v2', piece: 'scene', consumes: ['ship'] }, twin: 'a', injected: ['merge-requires-admin'] })
  r.child.name = 'draw the ship'
  expect(robotMore(r)).toEqual([
    'draw the ship',
    'claude-opus-4-1 · context 42k',
    'contract nexus-v2 · piece scene · writes against ship (does not wait)',
    'A/B twin — independent by design',
    '◈ rules: merge-requires-admin',
  ])
  expect(robotMore(robot('2', { model: null, context: null }))).toEqual(['model ?'])
})

test('relations: the piece one writes against, the other way round, and twins; never blocking', () => {
  const scene = robot('1', { contract: { feature: 'f', piece: 'scene', consumes: ['ship'] } })
  const shipR = robot('2', { contract: { feature: 'f', piece: 'ship', consumes: [] } })
  expect(relation(scene, shipR)).toBe('consumes ship')
  expect(relation(shipR, scene)).toBe('scene consumes')
  expect(relation(robot('3', { label: '#404·a', twin: 'a' }), robot('4', { label: '#404·b', twin: 'b' }))).toBe('twin')
  expect(relation(robot('3', { label: '#404·a', twin: 'a' }), robot('4', { label: '#404·b', twin: 'b', captainId: 'other' }))).toBeNull()
})

test('the bridge’s tone and status', () => {
  const need = { kind: 'need' as const, robotId: '1', need: { kind: 'question' as const, text: 'which?', options: [] } }
  const ready = { kind: 'ready' as const, robotId: '2', pr: pr(1), waitingMs: 60_000 }
  expect(toneOf(ship())).toBe('calm')
  expect(toneOf(ship({ bridge: { exceptions: [ready], blocked: [] } }))).toBe('lilac')
  expect(toneOf(ship({ bridge: { exceptions: [ready, need], blocked: [] } }))).toBe('red')
  expect(toneOf(ship({ bridge: { exceptions: [{ kind: 'red', robotId: '3', pr: pr(2, { ci: 'fail' }) }], blocked: [] } }))).toBe('red')
  expect(bridgeStatus(ship())).toBe('nothing needs you — the fleet flies itself')
  expect(bridgeStatus(ship({ bridge: { exceptions: [ready], blocked: [] } }))).toBe('1 thing waits for you')
  expect(bridgeStatus(ship({ bridge: { exceptions: [ready, need], blocked: [] } }))).toBe('2 things wait for you')
})

test('each exception says what waits and offers what settles it', () => {
  const q = exceptionRow({ kind: 'need', robotId: '1', need: { kind: 'question', text: 'move it?', options: ['yes', 'no'] } })
  expect(q).toMatchObject({ icon: '❓', text: 'move it?', robotId: '1' })
  expect(q.buttons).toEqual([{ label: 'answer · Tab', go: true, triage: true }])
  expect(exceptionRow({ kind: 'need', robotId: '1', need: { kind: 'permission', text: 'Bash · git push', options: [] } }).text).toBe('wants to run: Bash · git push')
  expect(exceptionRow({ kind: 'red', robotId: '2', pr: pr(9, { ci: 'fail', failing: ['test (windows)'] }) }).text).toBe('PR #9 · CI red: test (windows)')
  const ready = exceptionRow({ kind: 'ready', robotId: '3', pr: pr(372), waitingMs: 48 * 60_000 })
  expect(ready.text).toBe('PR #372 · CI green · waiting 48 min')
  // A draft says so: the merge marks it ready first.
  const draft = exceptionRow({ kind: 'ready', robotId: '3', pr: pr(372, { draft: true }), waitingMs: 48 * 60_000 })
  expect(draft.text).toBe('PR #372 · draft · CI green · waiting 48 min')
  expect(draft.buttons[0]).toEqual({ label: 'merge', go: true, action: { kind: 'merge', robotIds: ['3'] } })
  expect(ready.buttons[0]).toEqual({ label: 'merge', go: true, action: { kind: 'merge', robotIds: ['3'] } })
  const land = exceptionRow({ kind: 'land', root: '/r', mission: mission('nexus-v2', 4, 4) })
  expect(land).toMatchObject({ robotId: null, text: 'mission nexus-v2 · 4/4 green → land' })
  expect(land.buttons[0]).toMatchObject({ action: { kind: 'land', root: '/r', feature: 'nexus-v2' } })
  const stranded = exceptionRow({ kind: 'stranded', robotId: '4', idleMs: 23 * 60_000 })
  expect(stranded.text).toBe('idle for 23 min')
  expect(stranded.buttons.map((b) => b.label)).toEqual(['open', 'stop'])
})

test('log rows are coloured by state only, lilac for a warning and magenta for you', () => {
  expect(logTone('ci-green')).toBe('ok')
  expect(logTone('merged')).toBe('ok')
  expect(logTone('ci-red')).toBe('bad')
  expect(logTone('stranded')).toBe('warn')
  expect(logTone('you')).toBe('you')
  expect(logTone('dispatched')).toBeNull()
})

test('token counts read at a glance', () => {
  expect([812, 42_300, 1_000_000, 1_340_000].map(tokensWord)).toEqual(['812', '42k', '1M', '1.3M'])
})

test('a captain waiting on you: a red bridge, a row that says what it waits on and opens it', () => {
  const perm = { kind: 'captain' as const, captainId: 'cap-1', waitsOn: 'permission' as const, question: null, since: null, lines: [] }
  expect(toneOf(ship({ bridge: { exceptions: [perm], blocked: [] } }))).toBe('red')
  expect(exceptionRow(perm)).toEqual({
    key: 'captain:cap-1',
    kind: 'captain',
    robotId: null,
    captainId: 'cap-1',
    icon: '🔒',
    text: 'waits on a permission',
    buttons: [{ label: 'open', go: true, open: 'cap-1' }],
  })
  expect(exceptionRow({ ...perm, waitsOn: 'question', question: 'Which schema?' })).toMatchObject({ icon: '❓', text: 'Which schema?' })
  expect(exceptionRow({ ...perm, waitsOn: 'question' })).toMatchObject({ icon: '❓', text: 'waits on a question' })
})

test('a read that failed is a lilac row with nothing to press, the backend line on hover', () => {
  const x = { kind: 'snapshot', source: 'prs', text: 'Pull requests could not be read: gh is not logged in.', detail: 'gh pr list: gh auth login' } as const
  expect(exceptionRow(x)).toEqual({ key: `snapshot:${x.text}`, kind: 'snapshot', robotId: null, icon: '⚠', text: x.text, title: x.detail, buttons: [] })
  expect(toneOf(ship({ bridge: { exceptions: [x], blocked: [] } }))).toBe('lilac')
})

test("a captain's hover: its whole name, then its latest prompt", () => {
  const long = 'Name each captain by its session AI title, readable on the deck and in the dock'
  expect(captainHover(captain('c', { name: long, topic: '[Pasted text #1 +12 lines]' }))).toBe(`${long}\n“[Pasted text #1 +12 lines]”`)
  expect(captainHover(captain('c', { name: 'Subscriber cohort analysis', topic: null }))).toBe('Subscriber cohort analysis')
  expect(captainHover(captain('c', { pose: 'empty' }))).toMatch(/^no parent/)
})

test("an idle or sleeping captain's hover says how long it has been still", () => {
  expect(captainHover(captain('c', { name: 'Checkout', topic: 'ship it', pose: 'asleep', idleMs: 5.1 * 3_600_000 }))).toBe('Checkout\n“ship it”\nasleep for 5.1 h')
  expect(captainHover(captain('c', { name: 'Checkout', topic: null, pose: 'idle', idleMs: 12 * 60_000 }))).toBe('Checkout\nidle for 12 min')
})

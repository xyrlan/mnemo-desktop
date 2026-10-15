import { mission, pr, robot, ship } from './fixtures'
import { ago, bridgeStatus, chips, exceptionRow, glyph, logTone, particlesOf, poseOf, rateChip, relation, robotLine, robotMore, robotName, SLEEP_MS, toneOf } from './words'

test('ago reads like the prototype', () => {
  expect(ago(40_000)).toBe('40s')
  expect(ago(48 * 60_000)).toBe('48 min')
  expect(ago(5.1 * 3_600_000)).toBe('5.1 h')
  expect(ago(2 * 3_600_000)).toBe('2 h')
})

test('chips count, with one robot that needs you in the singular', () => {
  expect(chips({ working: 2, need: 1, ready: 12 })).toEqual({ working: '⚙ 2 working', need: '! 1 needs you', ready: '✓ 12 ready' })
  expect(chips({ working: 0, need: 3, ready: 0 }).need).toBe('! 3 need you')
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

test('the action badge, the particles and the pose follow state and action', () => {
  expect(glyph(robot('1', { action: 'read' }))).toBe('⌕')
  expect(glyph(robot('1', { action: 'test' }))).toBe('⚗')
  expect(glyph(robot('1', { action: 'run' }))).toBe('⧗')
  expect(glyph(robot('1', { state: 'need' }))).toBe('!')
  expect(glyph(robot('1', { state: 'done', ci: 'red' }))).toBe('✗')
  expect(glyph(robot('1', { state: 'done', ci: 'run' }))).toBe('⧗')
  expect(glyph(robot('1', { state: 'done', ci: 'green' }))).toBe('✓')
  expect(glyph(robot('1', { state: 'idle', zone: 'stranded' }))).toBe('⏸')
  expect(glyph(robot('1', { state: 'stopped' }))).toBe('■')
  expect(particlesOf(robot('1', { action: 'edit' }))).toBe('sparks')
  expect(particlesOf(robot('1', { action: 'test' }))).toBe('bubbles')
  expect(particlesOf(robot('1', { action: 'read' }))).toBe('pages')
  expect(particlesOf(robot('1', { action: 'ship' }))).toBe('radar')
  expect(particlesOf(robot('1', { state: 'idle', zone: 'stranded' }))).toBe('zz')
  expect(particlesOf(robot('1', { state: 'done' }))).toBeNull()
  expect(poseOf(robot('1', { state: 'idle', idleMs: SLEEP_MS + 1 }))).toBe('sleeping')
  expect(poseOf(robot('1', { state: 'need' }))).toBe('waiting')
  expect(poseOf(robot('1', { state: 'done' }))).toBe('idle')
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

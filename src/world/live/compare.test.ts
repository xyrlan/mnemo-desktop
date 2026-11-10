import { sampleWorld } from '../sample'
import type { Session, World } from '../types'
import { buildWorld } from './build'
import { compareWorlds, report, whyState } from './compare'
import { inputFromWorld } from './backwards'

const sample = sampleWorld()
type Input = ReturnType<typeof inputFromWorld>
/** The live world of the synthetic fleet: what the core would have answered for it, built. */
const live = (over: (input: Input) => Input = (i) => i) => buildWorld(over(inputFromWorld(sample)), null)
/** The same fleet read by a core whose insight, trail and vault pulse answer nothing yet. */
const bareCore = (i: Input): Input => ({ ...i, insights: {}, trails: {}, vault: null })
const fields = (c: ReturnType<typeof compareWorlds>) => [...new Set(c.differences.map((d) => d.field))].sort()

describe('the live world against the capture of the same fleet', () => {
  test('with everything the core will answer, they differ only in what the snapshot does not carry', () => {
    const c = compareWorlds(live(), sample)
    expect(c.both).toBe(sample.sessions.length)
    expect(c.differences.map((d) => [d.field, d.capture, d.live])).toEqual([['advisor', 'claude-opus-5-5', 'null']])
    expect(c.differences[0].why).toBe('the snapshot does not carry a child’s advisor')
    expect(c.same).toBeGreaterThan(300)
  })

  test('they wait for the same things, in the same order, with the same choices', () => {
    const world = live()
    expect(world.pending.map((p) => [p.session, p.kind])).toEqual(sample.pending.map((p) => [p.session, p.kind]))
    expect(world.pending.map((p) => p.choices)).toEqual(sample.pending.map((p) => p.choices))
    // Newest activity first, as the capture lists them; two of the same moment may swap.
    expect(world.sessions.map((s) => s.lastAt)).toEqual(sample.sessions.map((s) => s.lastAt))
    expect(world.sessions.map((s) => s.id).sort()).toEqual(sample.sessions.map((s) => s.id).sort())
  })

  test('before the core wave answers, the world is still right about who is there, in what state, under whom', () => {
    const c = compareWorlds(live(bareCore), sample)
    const right = ['state', 'role', 'live', 'parent', 'children', 'abandoned', 'project', 'account', 'session', 'accounts', 'plan windows', 'projects with a session']
    expect(c.differences.filter((d) => right.includes(d.field))).toEqual([])
    // What differs is what only a transcript or mnemo's logs say, and each says so.
    for (const d of c.differences) expect(d.why).not.toBe('')
    const insight = c.differences.filter((d) => ['tokens', 'turns', 'calls', 'effort'].includes(d.field))
    expect(insight.length).toBeGreaterThan(0)
    expect(insight.every((d) => d.why.includes('session insight answers nothing'))).toBe(true)
    const heldBack = c.differences.filter((d) => d.field === 'rules held back')
    expect(heldBack.length).toBeGreaterThan(0)
    expect(heldBack.every((d) => d.why.includes('memory trail answers nothing'))).toBe(true)
    expect(fields(c)).toContain('vault rules')
  })

  test('a session only one side has is said, with why', () => {
    const child = sample.sessions.find((s) => s.role === 'child' && !s.live)!
    const parent = sample.sessions.find((s) => s.role === 'parent' && s.live)!
    const without = (w: World, id: string): World => ({ ...w, sessions: w.sessions.filter((s) => s.id !== id) })
    const world = live()

    const missing = compareWorlds(without(world, child.id), sample).differences.find((d) => d.field === 'session')!
    expect(missing).toMatchObject({ session: child.short, live: 'absent', capture: `child, ${child.state}` })
    expect(missing.why).toContain('the snapshot leaves out a finished job whose worktree is gone')

    // Live in the capture and not here: an interactive session and a background job say why differently.
    expect(compareWorlds(without(world, parent.id), sample).differences.find((d) => d.field === 'session')!.why).toContain('a headless `claude` the snapshot leaves out')
    const job = sample.sessions.find((s) => s.role === 'child' && s.live)!
    expect(compareWorlds(without(world, job.id), sample).differences.find((d) => d.field === 'session')!.why).toContain('a background job `claude agents` still lists')

    const extra = compareWorlds(world, without(sample, parent.id)).differences.find((d) => d.field === 'session')!
    expect(extra).toMatchObject({ session: parent.short, capture: 'absent', live: `parent, ${parent.state}` })
    expect(extra.why).toContain('it started between the two readings')
  })

  test('what waits for a different kind of answer on the two sides is said', () => {
    const world = live()
    const merge = world.pending.find((p) => p.kind === 'merge')!
    const c = compareWorlds({ ...world, pending: world.pending.filter((p) => p !== merge) }, sample)
    expect(c.differences.filter((d) => d.field === 'waiting').map((d) => [d.session, d.capture, d.live])).toEqual([[merge.session.slice(0, 8), 'merge', 'nothing']])
    expect(c.differences.find((d) => d.field === 'waiting')!.why).toContain('CI is red')
  })

  test('a state the two call differently is said with what each road reads', () => {
    const s = { live: true } as Session
    expect(whyState('working', 'stalled', s)).toContain('an action in the last 150 s or a tool call still awaiting its result')
    expect(whyState('idle', 'stalled', s)).toContain('quiet for more than 15 min with nothing running')
    expect(whyState('ended', 'stalled', { live: false } as Session)).toContain('its job never said done or stopped')
    expect(whyState('need', 'idle', s)).toContain('a dialog the maintainer opened himself')
    expect(whyState('ended', 'ready', s)).toContain('its pull request is open')
    expect(whyState('idle', 'working', s)).toContain('a tool call still awaiting its result is work')
  })

  test('a child the capture calls working is still working twenty minutes into its command, and stalled when it never answers', () => {
    const states = (ms: number) => compareWorlds(live((i) => ({ ...i, now: i.now + ms })), sample).differences.filter((d) => d.field === 'state')
    expect(states(20 * 60_000)).toEqual([])
    const moved = states(4 * 60 * 60_000)
    expect(moved.map((d) => [d.capture, d.live])).toEqual([['working', 'stalled']])
    expect(moved[0].why).toContain("the ship's thresholds")
  })
})

describe('the report', () => {
  const bare = compareWorlds(live(bareCore), sample)

  test('says each kind of difference once, with why and the sessions it is seen on', () => {
    const text = report(bare)
    expect(text.split('\n')[0]).toBe(`live world against capture: 15 sessions in both, ${bare.same} readings the same, ${bare.differences.length} different`)
    const tokens = bare.differences.filter((d) => d.field === 'tokens')
    expect(text).toContain(`tokens: ${tokens.length}\n  why: the core's session insight answers nothing in this build`)
    expect(text).toContain(`  ${tokens[0].session}  capture ${tokens[0].capture} -> live 0`)
    expect(text.split('\n').filter((line) => line.startsWith('tokens: '))).toHaveLength(1)
  })

  test('never prints a title, a prompt, a path, a project or an account', () => {
    const text = report(bare)
    for (const s of sample.sessions) {
      // (`main` is a branch and an account in the sample, and a word of the report's own.)
      for (const secret of [s.title, s.project, s.cwd, s.branch, s.lastPrompt, s.intent]) if (secret && secret !== 'main') expect(text).not.toContain(secret)
    }
    expect(sample.accounts.map((a) => a.label)).toEqual(['main', 'second'])
    expect(text).not.toContain('second')
    expect(text).not.toMatch(/main(?!-chain)/)
    expect(text).toContain('title: ')
  })

  test('says that a project, a branch or an account differs, never what it is', () => {
    const world = live()
    const renamed = { ...world, sessions: world.sessions.map((s) => ({ ...s, project: 'a-private-project', account: 'someone@example.com', branch: 'feat/a-private-branch' })) }
    const text = report(compareWorlds(renamed, sample))
    expect(text).toContain('project: 15')
    expect(text).toContain('account: 15')
    for (const secret of ['a-private-project', 'someone@example.com', 'a-private-branch', ...sample.sessions.map((s) => s.project!)]) expect(text).not.toContain(secret)
  })

  test('says when the two were read far apart', () => {
    expect(report(compareWorlds(live(), sample))).toContain('read 0 s apart')
    expect(report(compareWorlds({ ...live(), at: sample.at + 10 * 60_000 }, sample))).toContain('read 600 s apart (more than two minutes')
    expect(report({ liveAt: 0, captureAt: 0, both: 0, differences: [], same: 0 })).toContain('nothing differs')
  })
})

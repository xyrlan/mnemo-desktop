import { sampleWorld } from '../world/sample'
import { SHOWN_ENDED_MS, childrenOf, rosterOrder, sessionOf } from '../world/store'
import type { Session, SessionState, World } from '../world/types'
import { nowOf, plan, projectMarks, rootsIn, shownOrder, wordOf, type Block } from './model'

// The sample's one ended child ended five hours ago and has left the present. Here it ended
// a minute ago, so that what the roster does with an ended child can be told.
const sample = sampleWorld()
const world: World = { ...sample, sessions: sample.sessions.map((s) => (s.state === 'ended' ? { ...s, lastAt: sample.at - 60_000 } : s)) }
const titled = (w: World, text: string): Session => {
  const hit = w.sessions.find((s) => s.title.startsWith(text))
  if (!hit) throw new Error(`no session titled ${text}`)
  return hit
}
/** The sample with some sessions changed, by the start of their title. */
const withSessions = (patch: Record<string, Partial<Session>>): World => ({
  ...world,
  sessions: world.sessions.map((s) => {
    const key = Object.keys(patch).find((k) => s.title.startsWith(k))
    return key ? { ...s, ...patch[key] } : s
  }),
})
type Entry = Extract<Block, { kind: 'entry' }>
const entries = (blocks: Block[]) => blocks.filter((b): b is Entry => b.kind === 'entry')
const entryOf = (blocks: Block[], text: string) => {
  const hit = entries(blocks).find((b) => b.root.title.startsWith(text))
  if (!hit) throw new Error(`no entry titled ${text}`)
  return hit
}
const bands = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { kind: 'band' }> => b.kind === 'band')

describe('the order the roster shows', () => {
  test('by attention it is the world’s roster order', () => {
    expect(shownOrder(world)).toEqual(rosterOrder(world))
    expect(shownOrder(world, 'attention')).toEqual(rosterOrder(world))
  })

  test('by project it is the same sessions, a project at a time, a child still under its parent', () => {
    const order = shownOrder(world, 'project')
    expect(new Set(order)).toEqual(new Set(rosterOrder(world)))
    expect(order.length).toBe(rosterOrder(world).length)
    // the projects come as the world lists them, and no project comes back once left
    const run = order.filter((s) => s.role === 'parent').map((s) => s.project)
    expect([...new Set(run)]).toEqual(world.projects.map((p) => p.name))
    expect(run).toEqual([...run].sort((a, b) => world.projects.findIndex((p) => p.name === a) - world.projects.findIndex((p) => p.name === b)))
    for (const s of order) {
      if (s.role !== 'child') continue
      const parent = sessionOf(world, s.parent) as Session
      const between = order.slice(order.indexOf(parent) + 1, order.indexOf(s))
      expect(between.every((x) => x.parent === parent.id)).toBe(true)
    }
  })

  test('inside a project the order of attention holds', () => {
    const lumen = rootsIn(world, 'project').filter((s) => s.project === 'lumen-web').map((s) => s.title)
    const byAttention = rootsIn(world, 'attention').filter((s) => s.project === 'lumen-web').map((s) => s.title)
    expect(lumen).toEqual(byAttention)
    expect(lumen[0]).toMatch(/^Optimistic updates/)
  })

  test('a session with no project comes after every project', () => {
    const w = withSessions({ 'Why is the bundle': { project: null } })
    const roots = rootsIn(w, 'project')
    expect(roots[roots.length - 1].title).toMatch(/^Why is the bundle/)
    expect(bands(plan(w, { group: 'project' })).at(-1)?.label).toBe('No project')
  })
})

describe('the bands', () => {
  test('are waiting, working, your turn, with how many roots each holds and what waits', () => {
    const heads = bands(plan(world))
    expect(heads.map((b) => [b.label, b.count])).toEqual([
      ['Waiting for you', 3],
      ['Working', 1],
      ['Your turn', 5],
    ])
    expect(heads[0].waiting).toBe(world.pending.length)
    expect(heads[1].waiting).toBe(0)
  })

  test('a parent whose turn it is stands in the waiting band while a child of its waits', () => {
    expect(entryOf(plan(world), 'Optimistic updates').band).toBe(0)
    expect(titled(world, 'Optimistic updates').state).toBe('idle')
  })

  test('every root is under the heading of its own band, in roster order', () => {
    const blocks = plan(world)
    let band: number | null = null
    const seen: string[] = []
    for (const b of blocks) {
      if (b.kind === 'band') band = b.band
      else if (b.kind === 'entry') {
        expect(b.band).toBe(band)
        seen.push(b.root.id)
      }
    }
    expect(seen).toEqual(rosterOrder(world).filter((s) => s.role === 'parent').map((s) => s.id))
  })

  test('by project the headings are the projects, each with its mark and its roots', () => {
    const heads = bands(plan(world, { group: 'project' }))
    expect(heads.map((b) => [b.mark, b.label, b.count])).toEqual([
      ['ATL', 'atlas-api', 2],
      ['LUM', 'lumen-web', 3],
      ['HAR', 'harbor-cli', 2],
      ['TES', 'tessera', 2],
    ])
    expect(heads.every((b) => b.waiting === 0)).toBe(true)
  })
})

describe('a family', () => {
  test('is on stage when the session on stage is its root or one of its children', () => {
    const child = titled(world, 'Webhook signature check')
    expect(entries(plan(world, { here: child })).filter((b) => b.on).map((b) => b.root.title)).toEqual([expect.stringMatching(/^Idempotent retries/)])
    const root = titled(world, 'Idempotent retries')
    expect(entryOf(plan(world, { here: root }), 'Idempotent').on).toBe(true)
    expect(entries(plan(world)).some((b) => b.on)).toBe(false)
  })

  test('lists its children most urgent first', () => {
    const kids = entryOf(plan(world), 'Idempotent').kids
    expect(kids).toEqual(childrenOf(world, titled(world, 'Idempotent retries')))
    expect(kids.map((c) => c.state)).toEqual(['need', 'stalled', 'ready', 'working'])
  })

  test('keeps an ended child behind its count until the family is on stage', () => {
    const quiet = entryOf(plan(world), 'Release 2.4')
    expect(quiet.kids).toEqual([])
    expect(quiet.hidden).toBe(1)
    const staged = entryOf(plan(world, { here: titled(world, 'Release 2.4') }), 'Release 2.4')
    expect(staged.kids.map((c) => c.title)).toEqual([expect.stringMatching(/^Shell completions/)])
    expect(staged.hidden).toBe(0)
  })

  test('an ended child leaves the roster once its last sign of life is old, and an ended family with it', () => {
    // as the sample has it: the child ended five hours ago
    const quiet = entryOf(plan(sample), 'Release 2.4')
    expect([quiet.kids, quiet.hidden]).toEqual([[], 0])
    expect(shownOrder(sample).map((s) => s.title)).not.toContainEqual(expect.stringMatching(/^Shell completions/))
    // its parent ended too, long ago: nothing of the family is left to show
    const gone: World = { ...sample, sessions: sample.sessions.map((s) => (s.title.startsWith('Release 2.4') ? { ...s, state: 'ended' as SessionState, live: false, lastAt: sample.at - SHOWN_ENDED_MS - 1 } : s)) }
    expect(shownOrder(gone).map((s) => s.title)).not.toContainEqual(expect.stringMatching(/^Release 2\.4/))
    // while the child is still fresh, its ended parent stays above it
    const kept: World = { ...gone, sessions: gone.sessions.map((s) => (s.title.startsWith('Shell completions') ? { ...s, lastAt: gone.at - SHOWN_ENDED_MS } : s)) }
    expect(shownOrder(kept).map((s) => s.title.split(' ')[0])).toEqual(expect.arrayContaining(['Release', 'Shell']))
  })

  test('an ended child that still has something waiting is drawn', () => {
    const w = withSessions({ 'Cursor pagination': { state: 'ended' } })
    expect(entryOf(plan(w), 'Idempotent').kids.map((c) => c.title)).toContainEqual(expect.stringMatching(/^Cursor pagination/))
  })
})

describe('the densities', () => {
  const tight = (blocks: Block[]) => entries(blocks).filter((b) => b.tight).map((b) => b.root.title.split(' ')[0])
  const here = titled(world, 'Design the plugin')

  test('as designed, nothing is tight', () => {
    expect(tight(plan(world, { density: 0 }))).toEqual([])
  })

  test('first the quiet entries go to two rows, never the one on stage', () => {
    expect(tight(plan(world, { density: 1 }))).toEqual(['Design', 'Release', 'Dark', 'Flaky', 'Notes'])
    expect(tight(plan(world, { density: 1, here }))).toEqual(['Release', 'Dark', 'Flaky', 'Notes'])
  })

  test('then every entry not on stage', () => {
    expect(tight(plan(world, { density: 2 })).length).toBe(9)
    const staged = plan(world, { density: 2, here: titled(world, 'Tenant in every') })
    expect(tight(staged).length).toBe(8)
    expect(entryOf(staged, 'Idempotent').tight).toBe(false)
  })

  test('an entry given its room back is whole again', () => {
    const roomy = new Set([titled(world, 'Order status').id])
    const blocks = plan(world, { density: 2, roomy })
    expect(entryOf(blocks, 'Order status').tight).toBe(false)
    expect(tight(blocks).length).toBe(8)
  })

  test('an ended root is one line, at every density, unless it is on stage', () => {
    const w = withSessions({ 'Notes for the 2.5': { state: 'ended', live: false, lastAt: world.at } })
    const notes = titled(w, 'Notes for the 2.5')
    for (const density of [0, 1, 2] as const) {
      const blocks = plan(w, { density })
      expect(blocks.filter((b) => b.kind === 'fold').map((b) => b.kind === 'fold' && b.root)).toEqual([notes])
      expect(bands(blocks).at(-1)?.label).toBe('Ended')
    }
    expect(plan(w, { here: notes }).some((b) => b.kind === 'fold')).toBe(false)
    expect(entryOf(plan(w, { here: notes }), 'Notes').on).toBe(true)
  })

  test('at the tightest, the ended roots share one line and the one on stage stays whole', () => {
    const ended: Partial<Session> = { state: 'ended' as SessionState, live: false, lastAt: world.at }
    const w = withSessions({ 'Notes for the 2.5': ended, 'Flaky snapshot': ended, 'Dark theme': ended })
    const blocks = plan(w, { density: 3 })
    const heaps = blocks.filter((b): b is Extract<Block, { kind: 'heap' }> => b.kind === 'heap')
    expect(heaps.length).toBe(1)
    expect(heaps[0].roots.map((r) => r.title.split(' ')[0]).sort()).toEqual(['Dark', 'Flaky', 'Notes'])
    expect(blocks.some((b) => b.kind === 'fold')).toBe(false)
    // at density 2 they are still a line each
    expect(plan(w, { density: 2 }).filter((b) => b.kind === 'fold').length).toBe(3)

    const flaky = titled(w, 'Flaky snapshot')
    const staged = plan(w, { density: 3, here: flaky })
    expect(staged.find((b) => b.kind === 'heap' && b.roots.includes(flaky))).toBeUndefined()
    expect(entryOf(staged, 'Flaky').on).toBe(true)
    // by project there is no one place for them: each stays a line in its project
    expect(plan(w, { density: 3, group: 'project' }).some((b) => b.kind === 'heap')).toBe(false)
  })

  test('at the tightest, the family on stage keeps its ended children behind their count, but not the one on stage', () => {
    const root = titled(world, 'Release 2.4')
    const child = titled(world, 'Shell completions')
    expect(entryOf(plan(world, { density: 2, here: root }), 'Release').kids).toEqual([child])
    const tightest = entryOf(plan(world, { density: 3, here: root }), 'Release')
    expect(tightest.kids).toEqual([])
    expect(tightest.hidden).toBe(1)
    expect(entryOf(plan(world, { density: 3, here: child }), 'Release').kids).toEqual([child])
  })
})

describe('a project’s mark', () => {
  test('is three letters of its name', () => {
    expect(Object.fromEntries(projectMarks(world))).toEqual({ 'atlas-api': 'ATL', 'lumen-web': 'LUM', 'harbor-cli': 'HAR', tessera: 'TES' })
  })

  test('is unique: a second project that would take the same letters takes its next ones', () => {
    const w: World = { ...world, projects: [...world.projects, { name: 'atlas-web', root: null, sessions: [] }, { name: 'atlas', root: null, sessions: [] }, { name: 'tesseract', root: null, sessions: [] }] }
    const marks = projectMarks(w)
    expect(marks.get('atlas-api')).toBe('ATL')
    expect(marks.get('atlas-web')).toBe('ATW')
    expect(marks.get('atlas')).toBe('ATA')
    expect(marks.get('tesseract')).toBe('TEE')
    expect(new Set(marks.values()).size).toBe(marks.size)
  })

  test('a project only a session names still has one', () => {
    const w = withSessions({ 'Why is the bundle': { project: 'quill' } })
    expect(projectMarks(w).get('quill')).toBe('QUI')
  })
})

describe('the line that says what a session is doing', () => {
  const base = titled(world, 'Idempotent retries')
  const call = { at: 1, tool: 'Edit', kind: 'edit' as const, target: 'src/a.ts', running: false, ok: true, ms: 10 }
  const bare: Session = { ...base, activity: [], recap: null, said: null, intent: null, detail: null, needs: null, lastPrompt: null, role: 'parent' }

  test('is the running tool before anything it said', () => {
    expect(nowOf(base)).toEqual({ kind: 'running', tool: 'Edit', text: 'src/lib/cache.ts' })
    const s = { ...bare, recap: { at: 1, text: 'a recap' }, activity: [call, { ...call, tool: 'Bash', target: 'pnpm  test\n--run', running: true }] }
    expect(nowOf(s)).toEqual({ kind: 'running', tool: 'Bash', text: 'pnpm test --run' })
  })

  test('else its own recap, else what it last said', () => {
    expect(nowOf({ ...bare, recap: { at: 1, text: ' the recap ' }, said: { at: 2, text: 'said' }, activity: [call] })).toEqual({ kind: 'recap', tool: null, text: 'the recap' })
    expect(nowOf({ ...bare, said: { at: 2, text: 'said' }, activity: [call] })).toEqual({ kind: 'said', tool: null, text: 'said' })
  })

  test('a child says what it waits for, or mnemo’s status of it, before what it said', () => {
    const child: Session = { ...bare, role: 'child', said: { at: 2, text: 'said' }, detail: 'tests running', needs: 'a permission' }
    expect(nowOf(child)).toEqual({ kind: 'status', tool: null, text: 'a permission' })
    expect(nowOf({ ...child, needs: null })?.text).toBe('tests running')
    expect(nowOf({ ...child, role: 'parent' })?.kind).toBe('said')
  })

  test('else what it was asked to do, its last call, the last prompt, and nothing when there is nothing', () => {
    expect(nowOf({ ...bare, intent: 'fix it', activity: [call] })?.kind).toBe('asked to')
    expect(nowOf({ ...bare, activity: [call], lastPrompt: 'go' })).toEqual({ kind: 'last', tool: 'Edit', text: 'src/a.ts' })
    expect(nowOf({ ...bare, lastPrompt: 'go' })).toEqual({ kind: 'prompt', tool: null, text: 'go' })
    expect(nowOf(bare)).toBeNull()
  })
})

describe('a state’s word', () => {
  const s = titled(world, 'Order status')
  test('is the state’s own, or the more exact one the session earned', () => {
    expect(wordOf(s)).toBe('needs you')
    expect(wordOf({ ...s, abandoned: true })).toBe('gave up waiting')
    expect(wordOf({ ...s, state: 'idle', abandoned: true })).toBe('your turn')
    const merged = { number: 1, url: '', repo: '', state: 'merged' as const, draft: false, title: null, ci: null, mergeable: null }
    expect(wordOf({ ...s, state: 'ended', live: false, prs: [merged] })).toBe('merged')
    expect(wordOf({ ...s, state: 'ended', live: false, prs: [{ ...merged, state: 'closed' }] })).toBe('ended')
    expect(wordOf({ ...s, state: 'working', prs: [merged] })).toBe('working')
  })
})

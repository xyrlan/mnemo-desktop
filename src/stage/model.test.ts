import { sampleWorld } from '../world/sample'
import { sessionOf } from '../world/store'
import type { Pending, Session, ToolCall, World } from '../world/types'
import { TAIL, clock, duration, factsOf, familyOf, familyStep, modelName, nowOf, pulseOf, statusOf, transcriptOf, type Line } from './model'

const sample = sampleWorld()
const titled = (world: World, start: string): Session => {
  const hit = world.sessions.find((s) => s.title.startsWith(start))
  if (!hit) throw new Error(`no session titled ${start}`)
  return hit
}

const T0 = Date.parse('2026-03-02T10:00:00Z')
const MIN = 60_000
const call = (minute: number, tool: string, patch: Partial<ToolCall> = {}): ToolCall => ({ at: T0 + minute * MIN, tool, kind: 'shell', target: `${tool} ${minute}`, running: false, ok: true, ms: 100, ...patch })

/** A session with nothing in it but what `patch` gives, in a world of its own. */
function alone(patch: Partial<Session>, pending: Pending[] = []): { world: World; s: Session } {
  const base = titled(sample, 'Notes for the 2.5 roadmap')
  const s: Session = { ...base, id: 'solo-session-id', short: 'solo-ses', parent: null, children: [], role: 'parent', state: 'idle', recap: null, said: null, lastPrompt: null, intent: null, detail: null, needs: null, activity: [], activityTotal: 0, activityCounts: {}, timeline: [], ...patch }
  return { world: { ...sample, at: T0 + 120 * MIN, sessions: [s], pending }, s }
}

const kinds = (lines: Line[]) => lines.map((l) => l.kind)
const tools = (lines: Line[]) => lines.flatMap((l) => (l.kind === 'call' ? [l.tool] : []))

describe('the family on stage', () => {
  const parent = titled(sample, 'Idempotent retries')

  test('is the parent, then its children most urgent first, whoever of them is on stage', () => {
    const family = familyOf(sample, parent)
    expect(family.map((s) => s.title.split(' ')[0])).toEqual(['Idempotent', 'Webhook', 'Forward-only', 'Cursor', 'Tenant'])
    expect(family.map((s) => s.state)).toEqual(['working', 'need', 'stalled', 'ready', 'working'])
    for (const member of family) expect(familyOf(sample, member).map((s) => s.id)).toEqual(family.map((s) => s.id))
  })

  test('right and left walk it and wrap at both ends', () => {
    const family = familyOf(sample, parent)
    expect(familyStep(sample, parent, 1)).toBe(family[1])
    expect(familyStep(sample, family[1], -1)).toBe(parent)
    expect(familyStep(sample, parent, -1)).toBe(family[4])
    expect(familyStep(sample, family[4], 1)).toBe(parent)
  })

  test('a session with no family has nowhere to walk', () => {
    const solo = titled(sample, 'Order status history')
    expect(familyOf(sample, solo)).toEqual([solo])
    expect(familyStep(sample, solo, 1)).toBeNull()
  })

  test('a child of a child stands right after its own parent', () => {
    const [root, kid, other] = familyOf(sample, parent)
    const grand: Session = { ...other, id: 'grandchild-id', short: 'grandchi', parent: kid.id, children: [], state: 'idle' }
    const world: World = { ...sample, sessions: [...sample.sessions.map((s) => (s.id === kid.id ? { ...s, children: [grand.id] } : s)), grand] }
    const family = familyOf(world, sessionOf(world, grand.id) as Session)
    expect(family.slice(0, 3).map((s) => s.id)).toEqual([root.id, kid.id, grand.id])
    expect(family).toHaveLength(6)
  })

  test('a child the world links only one way is still in its own family', () => {
    const kid = titled(sample, 'Tenant in every cache key')
    // its parent is not in the world at all: a family of one
    expect(familyOf({ ...sample, sessions: [kid] }, kid)).toEqual([kid])
    // its parent is there but does not list it: it stands last, and can be walked to
    const unlisted: World = { ...sample, sessions: sample.sessions.map((s) => (s.id === parent.id ? { ...s, children: s.children.filter((id) => id !== kid.id) } : s)) }
    const family = familyOf(unlisted, kid)
    expect(family.map((s) => s.title.split(' ')[0])).toEqual(['Idempotent', 'Webhook', 'Forward-only', 'Cursor', 'Tenant'])
    expect(familyStep(unlisted, kid, 1)?.id).toBe(parent.id)
  })
})

describe('what it is doing now', () => {
  test('a call still running says more than the recap', () => {
    const { s } = alone({ recap: { at: T0, text: 'a recap' }, activity: [call(1, 'Read'), call(2, 'Edit', { running: true, target: ' src/a.ts\n' })] })
    expect(nowOf(s)).toEqual({ kind: 'running', text: null, tool: 'Edit', target: 'src/a.ts', at: T0 + 2 * MIN })
  })

  test('then the recap, a child status, its last words, what it was sent to do, its last call, its last prompt', () => {
    const all: Partial<Session> = { recap: { at: T0, text: 'recap' }, role: 'child', needs: 'needs', detail: 'detail', said: { at: T0 + MIN, text: 'said' }, intent: 'intent', activity: [call(3, 'Bash')], lastPrompt: 'prompt' }
    const now = (patch: Partial<Session>) => nowOf(alone({ ...all, ...patch }).s)
    expect(now({})?.kind).toBe('recap')
    expect(now({ recap: null })).toMatchObject({ kind: 'status', text: 'needs' })
    expect(now({ recap: null, needs: null })).toMatchObject({ kind: 'status', text: 'detail' })
    // a parent has no status line: mnemo writes one for children only
    expect(now({ recap: null, role: 'parent' })).toMatchObject({ kind: 'said', text: 'said' })
    expect(now({ recap: null, needs: null, detail: null, said: null })).toMatchObject({ kind: 'asked to', text: 'intent' })
    expect(now({ recap: null, needs: null, detail: null, said: null, intent: null })).toMatchObject({ kind: 'last', tool: 'Bash' })
    expect(now({ recap: null, needs: null, detail: null, said: null, intent: null, activity: [] })).toMatchObject({ kind: 'prompt', text: 'prompt' })
    expect(now({ recap: null, needs: null, detail: null, said: null, intent: null, activity: [], lastPrompt: null })).toBeNull()
  })

  test('words just sent from the stage are what is new, until the session says or does something after them', () => {
    const sent = [{ at: T0 + 5 * MIN, text: 'first' }, { at: T0 + 10 * MIN, text: ' do the\nother half ' }]
    const heard = alone({ recap: { at: T0, text: 'recap' } }).s
    expect(nowOf(heard, sent)).toEqual({ kind: 'you said', text: 'do the other half', tool: null, target: null, at: T0 + 10 * MIN })
    const answered = alone({ recap: { at: T0 + 11 * MIN, text: 'on it' } }).s
    expect(nowOf(answered, sent)).toMatchObject({ kind: 'recap', text: 'on it' })
    const busy = alone({ recap: { at: T0, text: 'recap' }, activity: [call(1, 'Bash', { running: true })] }).s
    expect(nowOf(busy, sent)?.kind).toBe('running')
    expect(nowOf(alone({}).s, sent)?.kind).toBe('you said')
  })
})

describe('the pulse', () => {
  test('counts the calls, names the kinds it called most, and scales to the busiest five minutes', () => {
    const { s } = alone({
      activityTotal: 12,
      activityCounts: { read: 2, shell: 7, edit: 3, memory: 0 },
      timeline: [
        { t: T0, kinds: { shell: 1, read: 1 } },
        { t: T0 + 5 * MIN, kinds: { shell: 6, edit: 2 } },
        { t: T0 + 30 * MIN, kinds: { edit: 1, read: 1 } },
      ],
    })
    const pulse = pulseOf(s)
    expect(pulse?.total).toBe(12)
    expect(pulse?.kinds).toEqual([['shell', 7], ['edit', 3], ['read', 2]])
    expect(pulse?.bars.map((b) => b.calls)).toEqual([2, 8, 2])
    expect(pulse?.bars.map((b) => b.height)).toEqual([25, 100, 25])
    // a short session still spans an hour, so three bars are not a wall
    expect((pulse?.to ?? 0) - (pulse?.from ?? 0)).toBe(60 * MIN)
    expect(pulse?.bars[1].left).toBeCloseTo((5 / 60) * 100)
  })

  test('keeps the seven kinds called most', () => {
    const s = titled(sample, 'Idempotent retries')
    expect(pulseOf(s)?.kinds.map(([k]) => k)).toEqual(['shell', 'read', 'edit', 'search-code', 'browser', 'write', 'web-fetch'])
  })

  test('is not drawn for a session that called nothing', () => {
    expect(pulseOf(alone({}).s)).toBeNull()
  })
})

describe('the facts of the head', () => {
  test('say branch, model and effort, account by its label, when it started and its turns', () => {
    const s = titled(sample, 'Idempotent retries')
    expect(factsOf(sample, s).map((f) => f.text)).toEqual(['main', 'opus 5.5 · high', 'second', 'started 5h ago', '8 prompts · 1h 22m in turns', 'process live'])
    // the account is said by its label ("main"), not by its id ("default")
    const other = titled(sample, 'Why is the bundle')
    expect(other.account).toBe('default')
    expect(factsOf(sample, other).find((f) => f.key === 'account')?.text).toBe('main')
  })

  test('leave out what the world does not know, and say one prompt as one', () => {
    const { world, s } = alone({ branch: null, model: null, effort: null, advisor: 'claude-fable-5-2', account: 'nobody', startedAt: null, turns: 1, turnMs: 0, live: false })
    expect(factsOf(world, s).map((f) => f.text)).toEqual(['advisor fable 5.2', 'nobody', '1 prompt', 'no process'])
  })

  test('a model is named as people say it', () => {
    expect(modelName('claude-opus-5-5')).toBe('opus 5.5')
    expect(modelName('claude-haiku-5-5-20260301')).toBe('haiku 5.5')
    expect(modelName('claude-sonnet-5')).toBe('sonnet 5')
    expect(modelName('claude-opus-5-5[1m]')).toBe('opus 5.5 [1m]')
    expect(modelName('grok-4')).toBe('grok-4')
    expect(modelName(null)).toBe('')
  })

  test('a duration reads at the size it has', () => {
    expect([692, 1500, 18_000, 245_000, 4_938_306, null].map(duration)).toEqual(['692ms', '1.5s', '18s', '4m 05s', '1h 22m', ''])
  })

  test('the status line says how the session runs', () => {
    expect(statusOf(titled(sample, 'Idempotent retries'))).toBe('bypassPermissions  ·  opus 5.5  ·  high  ·  31% context')
  })
})

describe('the transcript drawn from the world', () => {
  test('a child opens with what it was sent to do, and what waits closes it', () => {
    const kid = titled(sample, 'Webhook signature check')
    const lines = transcriptOf(sample, kid)
    expect(lines[0]).toMatchObject({ kind: 'prompt', tag: 'sent', text: kid.intent })
    const last = lines[lines.length - 1]
    expect(last.kind === 'pending' && last.pending.kind).toBe('permission')
    expect(lines.filter((l) => l.kind === 'pending')).toHaveLength(1)
  })

  test('draws only the newest calls and says how many came before', () => {
    const s = titled(sample, 'Optimistic updates')
    const lines = transcriptOf(sample, s)
    expect(tools(lines)).toHaveLength(TAIL)
    expect(lines[0]).toMatchObject({ kind: 'note', text: `· · · ${s.activityTotal - TAIL} earlier tool calls` })
    expect(tools(lines).at(-1)).toBe(s.activity.filter((a) => !a.running).at(-1)?.tool)
  })

  test('the last prompt stands where the newest burst of calls begins', () => {
    const { world, s } = alone({ lastPrompt: 'do the thing', activity: [call(0, 'Read'), call(1, 'Grep'), call(20, 'Edit'), call(21, 'Bash')] })
    const lines = transcriptOf(world, s)
    expect(lines.map((l) => (l.kind === 'call' ? l.tool : l.kind))).toEqual(['Read', 'Grep', 'prompt', 'Edit', 'Bash'])
  })

  test('with no silence between the calls, or no call at all, the prompt comes first', () => {
    const steady = alone({ lastPrompt: 'go', activity: [call(0, 'Read'), call(2, 'Grep'), call(4, 'Edit')] })
    expect(kinds(transcriptOf(steady.world, steady.s))).toEqual(['prompt', 'call', 'call', 'call'])
    const bare = alone({ lastPrompt: 'go', said: { at: T0, text: 'on it' } })
    expect(kinds(transcriptOf(bare.world, bare.s))).toEqual(['prompt', 'words'])
  })

  test('words stand at their own time among the calls, and a recap that only repeats the last words is dropped', () => {
    const { world, s } = alone({
      activity: [call(0, 'Read'), call(10, 'Edit')],
      recap: { at: T0 + 5 * MIN, text: 'Half way there.' },
      said: { at: T0 + 11 * MIN, text: 'Done.' },
    })
    expect(transcriptOf(world, s).map((l) => (l.kind === 'call' ? l.tool : l.kind === 'words' ? (l.label ?? 'said') : l.kind))).toEqual(['Read', 'recap', 'Edit', 'said'])
    const same = alone({ recap: { at: T0, text: 'Done.  ' }, said: { at: T0 + MIN, text: 'Done.' } })
    expect(transcriptOf(same.world, same.s)).toMatchObject([{ kind: 'words', label: null, text: 'Done.' }])
  })

  test('what was said from the stage stands after what was there, and the last prompt is not drawn twice', () => {
    const before = alone({ lastPrompt: 'the old prompt', activity: [call(0, 'Read')], said: { at: T0 + MIN, text: 'ok' } })
    const sent = [{ at: T0 + 2 * MIN, text: 'now do the other half' }]
    expect(transcriptOf(before.world, before.s, sent).map((l) => (l.kind === 'prompt' ? `${l.tag}:${l.text}` : l.kind))).toEqual(['null:the old prompt', 'call', 'words', 'you:now do the other half'])
    // the world caught up: its last prompt is the words sent from here
    const after = alone({ lastPrompt: 'now do the other half', activity: [call(0, 'Read'), call(3, 'Edit')], said: { at: T0 + MIN, text: 'ok' } })
    expect(transcriptOf(after.world, after.s, sent).map((l) => (l.kind === 'prompt' ? `${l.tag}:${l.text}` : l.kind === 'call' ? l.tool : l.kind))).toEqual(['Read', 'words', 'you:now do the other half', 'Edit'])
  })

  test('a call still running comes after everything that finished, with how long it has run', () => {
    const { world, s } = alone({ state: 'working', activity: [call(0, 'Read'), call(1, 'Bash', { running: true, ms: null }), call(2, 'Grep')], said: { at: T0 + 3 * MIN, text: 'checking' } })
    const lines = transcriptOf(world, s)
    expect(kinds(lines)).toEqual(['call', 'call', 'words', 'running'])
    expect(lines.at(-1)).toMatchObject({ tool: 'Bash', since: '2h' })
  })

  test('a session at work with no call running still says it works; one that is not, does not', () => {
    const busy = alone({ state: 'working', activity: [call(0, 'Read')] })
    expect(kinds(transcriptOf(busy.world, busy.s))).toEqual(['call', 'working'])
    const idle = alone({ state: 'idle', activity: [call(0, 'Read')] })
    expect(kinds(transcriptOf(idle.world, idle.s))).toEqual(['call'])
  })

  test('a minute is printed once, and a failed call says so', () => {
    const { world, s } = alone({ activity: [call(0, 'Read'), call(0.5, 'Grep', { ok: false, ms: 1500 }), call(1, 'Edit')] })
    const lines = transcriptOf(world, s).filter((l) => l.kind === 'call')
    expect(lines.map((l) => l.time)).toEqual([clock(T0), null, clock(T0 + MIN)])
    expect(lines.map((l) => [l.failed, l.took])).toEqual([[false, '100ms'], [true, '1.5s'], [false, '100ms']])
  })

  test('every item that waits on the session is at its foot, oldest first, and no other session\'s is', () => {
    const base = sample.pending[0]
    const mine = (id: string, since: number): Pending => ({ ...base, id, session: 'solo-session-id', since })
    const { world, s } = alone({ state: 'need', activity: [call(0, 'Read')] }, [mine('first', T0), { ...base, id: 'other', session: 'someone-else' }, mine('second', T0 + MIN)])
    const lines = transcriptOf(world, s)
    expect(lines.map((l) => (l.kind === 'pending' ? l.pending.id : l.kind))).toEqual(['call', 'first', 'second'])
  })

  test('a session with nothing recorded says so instead of standing empty', () => {
    const { world, s } = alone({})
    expect(transcriptOf(world, s)).toMatchObject([{ kind: 'note', text: 'Nothing recorded for this session yet.' }])
  })
})

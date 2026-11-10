import type { Hosted } from '../runtime'
import { sampleWorld } from '../world/sample'
import { pendingOf } from '../world/store'
import type { Pending, Project, PullRequest, Session, World } from '../world/types'
import { edgeItem, keyOf, letterItem, menuOf, mergeBlock, projectItems, projectOf, pullOf, sessionItems, stepItem, targetFrom, terminalItems, type Item } from './model'

const sample = sampleWorld()
const titled = (start: string, world: World = sample): Session => world.sessions.find((s) => s.title.startsWith(start))!

/** The sample with one session changed, and what waits on it kept or dropped. */
function withSession(id: string, patch: Partial<Session>, pending?: (p: Pending) => Pending | null): World {
  return {
    ...sample,
    sessions: sample.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    pending: sample.pending.flatMap((p) => (p.session === id && pending ? ((next) => (next ? [next] : []))(pending(p)) : [p])),
  }
}

const ids = (items: Item[]) => items.map((i) => i.id)
const item = (items: Item[], id: string) => items.find((i) => i.id === id)

describe('a session’s menu', () => {
  test('a session the app hosts: what the spec lists, in its order, and nothing that does not apply', () => {
    const s = titled('Why is the bundle')
    expect(ids(sessionItems(sample, s))).toEqual(['open', 'close', 'changes', 'new-session', 'new-shell', 'copy', 'folder'])
  })

  test('a child that runs and waits: Answer…, Stop and Message…, and no Close (the app does not host it)', () => {
    const s = titled('Webhook signature check')
    expect(ids(sessionItems(sample, s))).toEqual(['open', 'answer', 'stop', 'message', 'changes', 'new-session', 'new-shell', 'copy', 'folder'])
    expect(item(sessionItems(sample, s), 'answer')?.hint).toBe('permission')
  })

  test('Answer… is there only while something waits, and says how many when more than one does', () => {
    const s = titled('Order status history')
    expect(ids(sessionItems(sample, s))).toContain('answer')
    const quiet = withSession(s.id, {}, () => null)
    expect(ids(sessionItems(quiet, titled('Order status history', quiet)))).not.toContain('answer')
    const first = pendingOf(sample, s.id)[0]
    const twice: World = { ...sample, pending: [...sample.pending, { ...first, id: first.id + '-again' }] }
    expect(item(sessionItems(twice, s), 'answer')?.hint).toBe('2 wait')
  })

  test('what ends something asks first: Close, Stop and Merge carry their question', () => {
    expect(item(sessionItems(sample, titled('Why is the bundle')), 'close')?.ask).toBe('Close it, and end what runs in it?')
    expect(item(sessionItems(sample, titled('Tenant in every cache key')), 'stop')?.ask).toBe('Stop it where it stands?')
    expect(item(sessionItems(sample, titled('Cursor pagination')), 'merge')?.ask).toBe('Merge #412?')
    // and what only goes somewhere does not
    expect(item(sessionItems(sample, titled('Why is the bundle')), 'open')?.ask).toBeUndefined()
    expect(item(sessionItems(sample, titled('Why is the bundle')), 'changes')?.ask).toBeUndefined()
  })

  test('a session another terminal runs keeps Close, switched off, with the reason', () => {
    const s = titled('Why is the bundle')
    const world = withSession(s.id, { hosted: false })
    const close = item(sessionItems(world, titled('Why is the bundle', world)), 'close')
    expect(close?.off).toBe('runs outside this app')
    expect(close?.ask).toBeUndefined()
  })

  test('an ended session nobody hosts has no Close at all', () => {
    const s = titled('Notes for the 2.5')
    const world = withSession(s.id, { state: 'ended', live: false, hosted: false })
    expect(ids(sessionItems(world, titled('Notes for the 2.5', world)))).not.toContain('close')
  })

  test('Resume here is for an ended session the maintainer talked to, with a folder to resume it in', () => {
    const s = titled('Notes for the 2.5')
    const ended = withSession(s.id, { state: 'ended', live: false, hosted: false })
    expect(ids(sessionItems(ended, titled('Notes for the 2.5', ended)))).toEqual(['open', 'resume', 'changes', 'new-session', 'new-shell', 'copy', 'folder'])
    expect(item(sessionItems(ended, titled('Notes for the 2.5', ended)), 'resume')?.off).toBeUndefined()

    const nowhere = withSession(s.id, { state: 'ended', live: false, hosted: false, cwd: null, root: null })
    expect(item(sessionItems(nowhere, titled('Notes for the 2.5', nowhere)), 'resume')?.off).toBe('its folder is not known')

    // a live one is not resumed, and neither is an ended child
    expect(ids(sessionItems(sample, s))).not.toContain('resume')
    expect(ids(sessionItems(sample, titled('Shell completions for fish')))).not.toContain('resume')
  })

  test('Stop and Message… are for a child that runs: not an ended child, not a parent', () => {
    expect(ids(sessionItems(sample, titled('Tenant in every cache key')))).toEqual(expect.arrayContaining(['stop', 'message']))
    const ended = ids(sessionItems(sample, titled('Shell completions for fish')))
    expect(ended).not.toContain('stop')
    expect(ended).not.toContain('message')
    const parent = ids(sessionItems(sample, titled('Idempotent retries')))
    expect(parent).not.toContain('stop')
    expect(parent).not.toContain('message')
    // a child whose process is gone does not run either
    const s = titled('Tenant in every cache key')
    const gone = withSession(s.id, { live: false })
    expect(ids(sessionItems(gone, titled('Tenant in every cache key', gone)))).not.toContain('stop')
  })

  test('Merge is its merge card’s first choice when the pull request is open and green', () => {
    const s = titled('Cursor pagination')
    const merge = item(sessionItems(sample, s), 'merge')
    expect(merge).toMatchObject({ hint: '#412' })
    expect(merge?.off).toBeUndefined()
  })

  test('a merge that waits on its checks is there, switched off, and says why', () => {
    expect(item(sessionItems(sample, titled('Empty state for the orders table')), 'merge')?.off).toBe('checks still running')
    const pr = (patch: Partial<PullRequest>): PullRequest => ({ number: 7, url: 'https://example.org/pr/7', repo: 'a/b', state: 'open', draft: false, title: null, ci: 'green', mergeable: null, ...patch })
    expect(mergeBlock(pr({}))).toBeNull()
    expect(mergeBlock(pr({ ci: 'red' }))).toBe('checks are red')
    expect(mergeBlock(pr({ ci: 'running' }))).toBe('checks still running')
    expect(mergeBlock(pr({ ci: null }))).toBe('no checks yet')
    expect(mergeBlock(pr({ draft: true }))).toBe('still a draft')
  })

  test('no Merge without a merge card, or once the pull request is merged or closed', () => {
    const s = titled('Cursor pagination')
    const answered = withSession(s.id, {}, () => null)
    expect(ids(sessionItems(answered, titled('Cursor pagination', answered)))).not.toContain('merge')
    for (const state of ['merged', 'closed'] as const) {
      const done = withSession(s.id, {}, (p) => ({ ...p, pr: p.pr && { ...p.pr, state } }))
      expect(ids(sessionItems(done, titled('Cursor pagination', done)))).not.toContain('merge')
    }
    // the pull request is still there to open
    expect(ids(sessionItems(answered, titled('Cursor pagination', answered)))).toContain('pr')
  })

  test('Open pull request is about the one that waits to merge, else an open one, else the newest', () => {
    const s = titled('Cursor pagination')
    expect(pullOf(sample, s)?.number).toBe(412)
    const pr = (number: number, state: PullRequest['state']): PullRequest => ({ number, url: `https://example.org/pr/${number}`, repo: 'a/b', state, draft: false, title: null, ci: null, mergeable: null })
    const quiet = titled('Why is the bundle')
    expect(pullOf(sample, quiet)).toBeNull()
    expect(pullOf(sample, { ...quiet, prs: [pr(1, 'merged'), pr(2, 'open'), pr(3, 'closed')] })?.number).toBe(2)
    expect(pullOf(sample, { ...quiet, prs: [pr(1, 'merged'), pr(3, 'closed')] })?.number).toBe(3)
    expect(ids(sessionItems(sample, quiet))).not.toContain('pr')
  })

  test('a session with no folder has no Changes and no Open folder, and Copy offers no folder', () => {
    const s = titled('Why is the bundle')
    const items = sessionItems(sample, { ...s, cwd: null })
    expect(ids(items)).not.toContain('changes')
    expect(ids(items)).not.toContain('folder')
    expect(item(items, 'copy')?.parts?.map((p) => p.id)).toEqual(['id', 'resume'])
  })

  test('New session and New shell need a project root, and name the project', () => {
    const s = titled('Why is the bundle')
    expect(item(sessionItems(sample, s), 'new-session')?.label).toBe('New session in lumen-web')
    expect(item(sessionItems(sample, s), 'new-shell')?.label).toBe('New shell in lumen-web')
    const rootless = ids(sessionItems(sample, { ...s, root: null }))
    expect(rootless).not.toContain('new-session')
    expect(rootless).not.toContain('new-shell')
    // with a root and no project, the folder names the place
    expect(item(sessionItems(sample, { ...s, project: null, root: '/Users/you/work/lumen-web' }), 'new-shell')?.label).toBe('New shell in lumen-web')
  })

  test('Copy is always there, a row of three; the resume line is Claude Code’s', () => {
    const s = titled('Why is the bundle')
    expect(item(sessionItems(sample, s), 'copy')?.parts?.map((p) => p.id)).toEqual(['id', 'resume', 'folder'])
    expect(item(sessionItems(sample, { ...s, agent: 'grok' }), 'copy')?.parts?.map((p) => p.id)).toEqual(['id', 'folder'])
    expect(ids(sessionItems(sample, { ...s, agent: 'grok', cwd: null, root: null }))).toEqual(['open', 'close', 'copy'])
  })

  test('the parts of the menu come in one run each, so a hairline can stand between them', () => {
    for (const s of sample.sessions) {
      const groups = sessionItems(sample, s).map((i) => i.group)
      const runs = groups.filter((g, i) => g !== groups[i - 1])
      expect(new Set(runs).size).toBe(runs.length)
    }
  })
})

describe('a project’s menu', () => {
  const lumen = sample.projects.find((p) => p.name === 'lumen-web') as Project

  test('holds New session here, New shell here, Dispatch… and Projects', () => {
    expect(ids(projectItems(lumen))).toEqual(['new-session', 'new-shell', 'dispatch', 'projects'])
    expect(projectItems(lumen).every((i) => !i.off)).toBe(true)
  })

  test('a project with no folder keeps the two, switched off: they would fail', () => {
    const items = projectItems({ ...lumen, root: null })
    expect(item(items, 'new-session')?.off).toBe('its folder is not known')
    expect(item(items, 'new-shell')?.off).toBe('its folder is not known')
    expect(item(items, 'dispatch')?.off).toBeUndefined()
  })

  test('a project the world does not list yet is put together from the sessions that name it', () => {
    const s = titled('Why is the bundle')
    const world: World = { ...sample, projects: [], sessions: sample.sessions.map((x) => (x.id === s.id ? { ...x, project: 'fresh', root: '/Users/you/work/fresh' } : x)) }
    expect(projectOf(world, 'fresh')).toEqual({ name: 'fresh', root: '/Users/you/work/fresh', sessions: [s.id] })
    expect(projectOf(world, 'nobody')).toBeNull()
    expect(projectOf(sample, 'lumen-web')).toBe(lumen)
  })
})

describe('a held terminal’s menu', () => {
  const shell: Hosted = { id: 'tab-7', kind: 'session', label: '', cwd: '/Users/you/work/atlas-api', sessionId: null, pty: 7 }

  test('it can be put on stage, ended (asked first) and found on disk', () => {
    const items = terminalItems(shell)
    expect(ids(items)).toEqual(['open', 'close', 'copy', 'folder'])
    expect(item(items, 'close')).toMatchObject({ label: 'End terminal', ask: 'End it, and what runs in it?' })
    expect(ids(terminalItems({ ...shell, cwd: null }))).toEqual(['open', 'close'])
  })
})

describe('what a menu is on', () => {
  const shell: Hosted = { id: 'tab-7', kind: 'session', label: '', cwd: null, sessionId: null, pty: 7 }

  test('a session by its id, or by its first eight characters', () => {
    const s = titled('Why is the bundle')
    expect(menuOf(sample, { kind: 'session', id: s.id }, [])).toMatchObject({ title: s.title, sub: 'lumen-web', session: s, target: { kind: 'session', id: s.id } })
    expect(menuOf(sample, { kind: 'session', id: s.short }, [])?.target).toEqual({ kind: 'session', id: s.id })
  })

  test('nothing that is not in the world: the menu does not open', () => {
    expect(menuOf(sample, { kind: 'session', id: 'gone' }, [])).toBeNull()
    expect(menuOf(sample, { kind: 'project', name: 'nobody' }, [])).toBeNull()
    expect(menuOf(sample, { kind: 'terminal', id: 'tab-7' }, [])).toBeNull()
  })

  test('a project says how many sessions it has', () => {
    expect(menuOf(sample, { kind: 'project', name: 'tessera' }, [])).toMatchObject({ title: 'tessera', sub: '2 sessions', session: null })
    const one: World = { ...sample, sessions: sample.sessions.filter((s) => s.project !== 'tessera' || s.title.startsWith('Design')) }
    expect(menuOf(one, { kind: 'project', name: 'tessera' }, [])?.sub).toBe('1 session')
  })

  test('a held terminal, until the world lists it as a session', () => {
    expect(menuOf(sample, { kind: 'terminal', id: 'tab-7' }, [shell], () => 'atlas-api')).toMatchObject({ title: 'atlas-api', sub: 'terminal' })
    const s = titled('Why is the bundle')
    expect(menuOf(sample, { kind: 'terminal', id: 'tab-7' }, [{ ...shell, sessionId: s.id }])).toBeNull()
    expect(menuOf(sample, { kind: 'terminal', id: s.id }, [{ ...shell, id: s.id }])).toBeNull()
  })

  test('a target is one word on an element, and comes back from it whole', () => {
    for (const t of [{ kind: 'session', id: 'abc' }, { kind: 'project', name: 'a:b c' }, { kind: 'terminal', id: 'tab-7' }] as const) expect(targetFrom(keyOf(t))).toEqual(t)
    for (const bad of [null, undefined, '', 'session', 'session:', ':abc', 'window:abc']) expect(targetFrom(bad)).toBeNull()
  })
})

describe('walking the menu', () => {
  const list = (...rows: [string, boolean?][]): Item[] => rows.map(([label, off], i) => ({ id: String(i), group: 'go', label, off: off ? 'no' : undefined, run: () => ({ ok: true }) }))
  const items = list(['Open on stage'], ['Close session', true], ['Changes'], ['Copy'], ['Open folder'], ['Stop'])

  test('down and up pass over what is switched off, and wrap', () => {
    expect(stepItem(items, 0, 1)).toBe(2)
    expect(stepItem(items, 2, -1)).toBe(0)
    expect(stepItem(items, 5, 1)).toBe(0)
    expect(stepItem(items, 0, -1)).toBe(5)
    expect(stepItem(list(['a', true], ['b', true]), 0, 1)).toBe(-1)
    expect(stepItem([], 0, 1)).toBe(-1)
  })

  test('Home and End are the first and the last that can be chosen', () => {
    expect(edgeItem(items, false)).toBe(0)
    expect(edgeItem(items, true)).toBe(5)
    expect(edgeItem(list(['a', true], ['b'], ['c', true]), false)).toBe(1)
    expect(edgeItem(list(['a', true], ['b'], ['c', true]), true)).toBe(1)
    expect(edgeItem(list(['a', true]), false)).toBe(-1)
  })

  test('a first letter goes to the next item that starts with it, round and round', () => {
    expect(letterItem(items, 0, 'c')).toEqual({ at: 2, only: false })
    expect(letterItem(items, 2, 'C')).toEqual({ at: 3, only: false })
    expect(letterItem(items, 3, 'c')).toEqual({ at: 2, only: false })
    // an item that is switched off is not one of them
    expect(letterItem(items, 0, 'c')?.at).not.toBe(1)
  })

  test('a letter only one item starts with chooses it; one none starts with does nothing', () => {
    expect(letterItem(items, 0, 's')).toEqual({ at: 5, only: true })
    expect(letterItem(items, 5, 's')).toEqual({ at: 5, only: true })
    expect(letterItem(items, 0, 'z')).toBeNull()
  })
})

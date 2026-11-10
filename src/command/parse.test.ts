import { sampleWorld } from '../world/sample'
import { rosterOrder } from '../world/store'
import type { Session, World } from '../world/types'
import { greenPulls, parse, runningChildren, sessionCalled, type Command } from './parse'

const world = sampleWorld()
const titled = (start: string, w: World = world): Session => w.sessions.find((s) => s.title.startsWith(start))!
const rootOf = (project: string) => world.projects.find((p) => p.name === project)!.root!

const command = (line: string, w: World = world): Command => {
  const parsed = parse(line, w)
  if (!('command' in parsed)) throw new Error(`"${line}" did not parse: ${parsed.error}`)
  return parsed.command
}
const error = (line: string, w: World = world): string => {
  const parsed = parse(line, w)
  if ('command' in parsed) throw new Error(`"${line}" parsed to ${parsed.command.kind}`)
  return parsed.error
}

/** The sample, with two pieces of one contract and a child on an issue: what `land`, a piece's
 *  name and `#412` are read against. */
function withContract(): World {
  const base = sampleWorld()
  const a = titled('Tenant in every cache key', base)
  const b = titled('Webhook signature check', base)
  const c = titled('Cursor pagination', base)
  return {
    ...base,
    sessions: base.sessions.map((s) => (s.id === a.id ? { ...s, contract: { feature: 'cache-keys', piece: 'tenant' } } : s.id === b.id ? { ...s, contract: { feature: 'cache-keys', piece: 'signature' } } : s.id === c.id ? { ...s, issue: 412 } : s)),
  }
}

describe('starting something', () => {
  test('new starts a session in the project named, with the rest of the line as its first prompt', () => {
    expect(command('new atlas-api make the billing webhook safe to retry')).toEqual({ kind: 'new', root: rootOf('atlas-api'), project: 'atlas-api', prompt: 'make the billing webhook safe to retry', agent: null })
    expect(command('new lumen-web')).toMatchObject({ kind: 'new', project: 'lumen-web', prompt: null })
  })

  test('agent= is read only as the first word after the project', () => {
    expect(command('new atlas-api agent=grok why is x=1 slow')).toMatchObject({ agent: 'grok', prompt: 'why is x=1 slow' })
    expect(command('new atlas-api why is agent=grok slow')).toMatchObject({ agent: null, prompt: 'why is agent=grok slow' })
  })

  test('a project is named whole, or by a start only one project has', () => {
    expect(command('shell lum')).toEqual({ kind: 'shell', root: rootOf('lumen-web'), project: 'lumen-web' })
    expect(error('shell nowhere')).toMatch(/No project called nowhere.*atlas-api/)
    const two = { ...world, projects: [...world.projects, { name: 'atlas-web', root: '/Users/you/atlas-web', sessions: [] }] }
    expect(error('shell atlas', two)).toMatch(/No project called atlas/)
  })

  test('a project with no folder starts nothing, and says so', () => {
    const lost = { ...world, projects: world.projects.map((p) => (p.name === 'tessera' ? { ...p, root: null } : p)) }
    expect(error('new tessera hello', lost)).toMatch(/no folder/)
  })

  test('the sign people type from habit is not part of the verb', () => {
    expect(command('/shell atlas-api').kind).toBe('shell')
    expect(command(':shell atlas-api').kind).toBe('shell')
    expect(command('  ; shell atlas-api').kind).toBe('shell')
  })
})

describe('dispatch', () => {
  test('issues, each once, with model, effort and may', () => {
    expect(command('dispatch atlas-api #12 14, #12 model=opus-5.5 effort=HIGH may=pr')).toEqual({
      kind: 'dispatch',
      root: rootOf('atlas-api'),
      project: 'atlas-api',
      issues: [12, 14],
      options: { model: 'opus-5.5', effort: 'high', may: 'pr' },
    })
  })

  test('a word that is no issue is a contract file', () => {
    expect(command('dispatch atlas-api contracts/2026-11-10-billing.md may=none')).toEqual({ kind: 'contract', root: rootOf('atlas-api'), project: 'atlas-api', path: 'contracts/2026-11-10-billing.md', options: { may: 'none' } })
  })

  test('what it says reads the options back', () => {
    const parsed = parse('dispatch atlas-api #12 #14 model=opus-5.5 may=pr', world)
    expect('says' in parsed && parsed.says).toBe('Dispatch 2 children in atlas-api for #12 #14 (model opus-5.5, may pr)')
    expect('batch' in parsed && parsed.batch).toBe(false)
  })

  test('refuses what it cannot read, in words', () => {
    expect(error('dispatch atlas-api #12 may=maybe')).toMatch(/may= is one of pr, push, none/)
    expect(error('dispatch atlas-api #12 colour=red')).toMatch(/No option called colour/)
    expect(error('dispatch atlas-api #12 model=')).toMatch(/model= needs a value/)
    expect(error('dispatch atlas-api')).toMatch(/which issues/)
    expect(error('dispatch atlas-api #12 contracts/a.md')).toMatch(/^dispatch <project>/)
  })
})

describe('the batch verbs are asked about', () => {
  const live = runningChildren(world)

  test('the sample has two children running', () => {
    expect(live.map((s) => s.title)).toEqual(['Webhook signature check before parsing', 'Tenant in every cache key'])
  })

  test('stop all names every running child, in roster order', () => {
    const parsed = parse('stop all', world)
    expect(parsed).toMatchObject({ batch: true, command: { kind: 'stop', sessions: live.map((s) => s.id) } })
    expect('says' in parsed && parsed.says).toBe('Stop 2 running children: Webhook signature check before parsing · Tenant in every cache key')
  })

  test('message all reaches them through one action', () => {
    expect(parse('message all rebase on main before you push', world)).toMatchObject({ batch: true, command: { kind: 'message', to: 'all', text: 'rebase on main before you push' } })
    expect(error('message all')).toMatch(/what should the 2 running children hear/)
  })

  test('merge green counts the open pull requests whose checks are green, and no other', () => {
    expect(greenPulls(world).map((p) => p.number)).toEqual([412])
    const parsed = parse('merge green', world)
    expect(parsed).toMatchObject({ batch: true, command: { kind: 'merge-green' } })
    expect('says' in parsed && parsed.says).toBe('Merge 1 green pull request: #412')
    expect(error('merge')).toMatch(/merge green/)
  })

  test('a green pull request that conflicts is not one merge green would merge', () => {
    const conflicted = { ...world, pending: [], sessions: world.sessions.map((s) => ({ ...s, prs: s.prs.map((p) => ({ ...p, mergeable: 'CONFLICTING' })) })) }
    expect(greenPulls(conflicted)).toEqual([])
  })

  test('with nothing to reach, a batch verb says so instead of asking', () => {
    const quiet = { ...world, pending: [], sessions: world.sessions.map((s) => ({ ...s, live: false, prs: [] })) }
    expect(error('stop all', quiet)).toBe('No child is running right now.')
    expect(error('message all hello', quiet)).toBe('No child is running right now.')
    expect(error('merge green', quiet)).toBe('No open pull request has green checks right now.')
  })

  test('one session is not a batch', () => {
    const child = titled('Tenant in every cache key')
    expect(parse(`stop ${child.short}`, world)).toMatchObject({ batch: false, command: { kind: 'stop', sessions: [child.id] } })
    expect(parse(`msg ${child.short} hello`, world)).toMatchObject({ batch: false, command: { kind: 'message', to: child.id, text: 'hello' } })
  })
})

describe('naming a session', () => {
  test('by its id, its first 8 characters, its issue, or its piece', () => {
    const w = withContract()
    const tenant = titled('Tenant in every cache key', w)
    expect(sessionCalled(tenant.id, w)).toBe(tenant)
    expect(sessionCalled(tenant.short.toUpperCase(), w)).toBe(tenant)
    expect(sessionCalled('tenant', w)).toBe(tenant)
    expect(sessionCalled('#412', w)?.title).toBe('Cursor pagination for /orders')
    expect(sessionCalled('#999', w)).toBeNull()
  })

  test('two sessions on one issue: the running one is meant', () => {
    const w = withContract()
    const [a, b] = rosterOrder(w).filter((s) => s.role === 'child')
    const twice = { ...w, sessions: w.sessions.map((s) => (s.id === a.id ? { ...s, issue: 7, live: true } : s.id === b.id ? { ...s, issue: 7, live: false } : { ...s, issue: null })) }
    expect(sessionCalled('#7', twice)?.id).toBe(a.id)
  })

  test('a session named outright is put on stage', () => {
    const s = titled('Order status history')
    expect(command(s.short)).toEqual({ kind: 'go', session: s.id })
    expect(command(`go ${s.short}`)).toEqual({ kind: 'go', session: s.id })
  })

  test('a session that is not running is not stopped', () => {
    expect(error(`stop ${titled('Cursor pagination').short}`)).toBe('Cursor pagination for /orders is not running.')
  })

  test('a word that names nobody is refused, never guessed', () => {
    expect(error('message nobody hello')).toMatch(/No session called nobody/)
    expect(error('launch atlas-api')).toMatch(/No verb called launch/)
  })
})

describe('land', () => {
  test('lands a feature of a contract the fleet is working on, from its root', () => {
    const w = withContract()
    expect(command('land cache-keys', w)).toEqual({ kind: 'land', root: titled('Tenant in every cache key', w).root, feature: 'cache-keys' })
    expect(error('land other', w)).toMatch(/No feature called other. There is: cache-keys/)
  })

  test('with no contract in the fleet there is nothing to land', () => {
    expect(error('land')).toMatch(/No contract is in the fleet/)
  })
})

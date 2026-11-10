import type { Snapshot } from '../mission/types'
import type { Session, World } from '../world/types'
import { createActions, GONE, NOT_WAITING, NOTHING, type ActionPaths, type Did } from './actions'
import { liveWorld, snapshotOf, titled } from './testing'

const RULE = '─'.repeat(60)
const EMPTY_BOX = ['● Done.', RULE, '❯ ', RULE, '  ? for shortcuts']

/** The actions over paths that only write down what was asked of them. `fail`: what a path
 *  answers instead of doing it (a `Did` for a job, a string to reject with). */
function bench() {
  const state: { world: World; snapshot: Snapshot } = { world: liveWorld(), snapshot: snapshotOf(liveWorld()) }
  const did: string[] = []
  const fail: Record<string, string> = {}
  const panes = new Map<string, number>()
  const screens = new Map<number, string[]>()
  const staged: string[] = []
  const job = async (line: string, key: string): Promise<Did> => {
    did.push(line)
    return fail[key] ? { ok: false, why: fail[key] } : { ok: true, why: '' }
  }
  const act = async (line: string, key: string) => {
    if (fail[key]) throw new Error(fail[key])
    did.push(line)
  }
  let opened = 0
  const paths: ActionPaths = {
    world: () => state.world,
    snapshot: () => state.snapshot,
    hosting: {
      open: async (id) => (did.push(`open ${id}`), { ok: true }),
      close: async (id) => (did.push(`close ${id}`), { ok: true }),
      paneOf: (id) => panes.get(id) ?? null,
    },
    stage: (id) => void staged.push(id),
    child: {
      answerQuestion: (c, i) => act(`question ${c.id} ${i}`, 'question'),
      answerQuestionOther: (c, t) => act(`question ${c.id} "${t}"`, 'question'),
      answerPrompt: (c, choice) => job(`prompt ${c.id} ${choice}`, 'prompt'),
      asMe: (c, t) => act(`as me ${c.id} "${t}"`, 'asMe'),
      inbox: (id, t) => act(`inbox ${id} "${t}"`, `inbox ${id}`),
    },
    pane: {
      screen: async (pane) => screens.get(pane),
      runsClaude: async () => true,
      write: async (pane, data) => void did.push(`write ${pane} ${JSON.stringify(data)}`),
      prompt: async (pane, text) => void did.push(`typed ${pane} "${text}"`),
      sleep: async () => {},
    },
    merge: (root, pr) => job(`merge ${root} #${pr.number}`, `merge ${pr.number}`),
    land: (root, m) => job(`land ${root} ${m.feature}`, 'land'),
    dispatch: (root, issues, o) => job(`dispatch ${root} ${issues.join(',')} ${JSON.stringify(o)}`, 'dispatch'),
    dispatchContract: (root, path, o) => job(`contract ${root} ${path} ${JSON.stringify(o)}`, 'dispatch'),
    stop: (root, c) => job(`stop ${root} ${c.id}`, 'stop'),
    async openSession(spec) {
      if (fail.start) throw new Error(fail.start)
      did.push(`start ${JSON.stringify(spec)}`)
      const id = spec.kind === 'claude' ? `fresh-${++opened}` : `session:${++opened}`
      if (spec.kind === 'claude') {
        panes.set(id, 40 + opened)
        screens.set(40 + opened, EMPTY_BOX)
      }
      return id
    },
    activeKind: () => 'claude',
    async shot(ask, id) {
      if (fail.shot) throw new Error(fail.shot)
      did.push(`shot ${ask.sessionId} ${ask.account} ${id}`)
      return 'AAAA'
    },
    page: (url) => act(`page ${url}`, 'page'),
    file: (path) => act(`file ${path}`, 'file'),
  }
  const session = (text: string) => titled(state.world, text)
  return {
    actions: createActions(paths),
    did,
    fail,
    staged,
    state,
    session,
    waiting: (s: Session) => state.world.pending.find((p) => p.session === s.id)!,
    /** One of the app's terminals runs `s`, showing `lines`. */
    inPane(s: Session, pane: number, lines: string[]) {
      panes.set(s.id, pane)
      screens.set(pane, lines)
    },
    setChild(short: string, over: Record<string, unknown>) {
      state.snapshot = { ...state.snapshot, repos: state.snapshot.repos.map((r) => ({ ...r, children: r.children.map((c) => (c.id === short ? { ...c, ...over } : c)) })) }
    },
  }
}

describe('answering what waits', () => {
  test("a child's permission is pressed through its own attach, by the card's choice", async () => {
    const b = bench()
    const child = b.session('Webhook signature check')
    const item = b.waiting(child)
    expect(item.choices.map((c) => c.label)).toEqual(['Allow once', 'Always allow', 'Deny'])
    expect(await b.actions.answer(item.id, 1)).toEqual({ ok: true, note: 'Allow once' })
    await b.actions.answer(item.id, 2)
    await b.actions.answer(item.id, 3)
    expect(b.did).toEqual([`prompt ${child.short} yes`, `prompt ${child.short} always`, `prompt ${child.short} no`])
  })

  test('a guard that stops it is said as it is', async () => {
    const b = bench()
    const item = b.waiting(b.session('Webhook signature check'))
    b.fail.prompt = "the prompt on 650506f6's screen is not the one this card shows, nothing was pressed"
    expect(await b.actions.answer(item.id, 1)).toEqual({ ok: false, why: b.fail.prompt })
  })

  test("a question in one of the app's terminals is answered there, when it is the one on screen", async () => {
    const b = bench()
    const s = b.session('Order status history')
    const item = b.waiting(s)
    const dialog = [RULE, ` ${item.text}`, '', ...item.choices.map((c) => `   ${c.key}. ${c.label}`), `   ${item.choices.length + 1}. Type something.`]
    b.inPane(s, 12, dialog)
    expect(await b.actions.answer(item.id, 2)).toEqual({ ok: true, note: item.choices[1].label })
    expect(b.did).toEqual(['write 12 "2"'])

    b.inPane(s, 12, [RULE, ' Another question?', '   1. Rename it', '   2. Leave it', '   3. Type something.'])
    const o = await b.actions.answer(item.id, 2)
    expect(o).toEqual({ ok: false, why: expect.stringContaining('not the one this card shows') })
    expect(b.did).toEqual(['write 12 "2"'])
  })

  test('a session that runs outside the app is answered in its own terminal', async () => {
    const b = bench()
    const item = b.waiting(b.session('Order status history'))
    expect(await b.actions.answer(item.id, 1)).toEqual({ ok: false, why: expect.stringContaining('outside the app') })
    expect(b.did).toEqual([])
  })

  test("a merge runs the checks-gated merge in the child's own repo", async () => {
    const b = bench()
    const child = b.session('Cursor pagination')
    const item = b.waiting(child)
    expect(await b.actions.answer(item.id, 1)).toEqual({ ok: true, note: 'Merged #412.' })
    expect(b.did).toEqual(['merge ~/work/atlas-api #412'])
    // "Send back" needs words: nothing runs.
    expect(await b.actions.answer(item.id, 2)).toEqual({ ok: false, why: expect.stringContaining('in your words') })
    expect(b.did).toHaveLength(1)
  })

  test("a merge refused says GitHub's reason, and one in another repo is not tried", async () => {
    const b = bench()
    const item = b.waiting(b.session('Empty state for the orders table'))
    b.fail['merge 233'] = 'not merged: 2 checks not finished: test, lint'
    expect(await b.actions.answer(item.id, 1)).toEqual({ ok: false, why: b.fail['merge 233'] })

    b.setChild(b.session('Empty state for the orders table').short, { cwd: '~/work/atlas-api-wt-empty' })
    expect(await b.actions.answer(item.id, 1)).toEqual({ ok: false, why: 'PR #233 is in example/lumen-web, not in atlas-api' })
    expect(b.did).toEqual(['merge ~/work/lumen-web #233'])
  })

  test('a stalled child is told to continue, or stopped', async () => {
    const b = bench()
    const child = b.session('Forward-only migration')
    const item = b.waiting(child)
    b.setChild(child.short, { live: true, state: 'working' })
    await b.actions.answer(item.id, 1)
    expect(await b.actions.answer(item.id, 2)).toEqual({ ok: true, note: 'Stopped. It keeps its conversation.' })
    expect(b.did).toEqual([`as me ${child.short} "continue"`, `stop ~/work/atlas-api ${child.short}`])
  })

  test('what is no longer waiting is refused', async () => {
    const b = bench()
    const item = b.waiting(b.session('Webhook signature check'))
    expect(await b.actions.answer('nothing', 1)).toEqual({ ok: false, why: NOT_WAITING })
    expect(await b.actions.answer(item.id, 9)).toEqual({ ok: false, why: NOT_WAITING })
    expect(b.did).toEqual([])
  })
})

describe('speaking to a session', () => {
  test('a live child reads it as the maintainer: typed into its own terminal', async () => {
    const b = bench()
    const child = b.session('Tenant in every cache key')
    expect(await b.actions.reply(child.id, '  ship it  ')).toEqual({ ok: true })
    expect(b.did).toEqual([`as me ${child.short} "ship it"`])
  })

  test('a child that asks a permission is not spoken to: the keys would go to the dialog', async () => {
    const b = bench()
    const o = await b.actions.reply(b.session('Webhook signature check').id, 'yes go on')
    expect(o).toEqual({ ok: false, why: expect.stringContaining('allow or deny') })
    expect(b.did).toEqual([])
  })

  test('a question is answered in words through its own row', async () => {
    const b = bench()
    const s = b.session('Order status history')
    const item = b.waiting(s)
    b.inPane(s, 12, [RULE, ` ${item.text}`, ...item.choices.map((c) => `   ${c.key}. ${c.label}`), '   4. Type something.'])
    expect((await b.actions.reply(s.id, 'online, paused at night')).ok).toBe(true)
    expect(b.did).toEqual(['write 12 "4"', 'write 12 "online, paused at night"', 'write 12 "\\r"'])
  })

  test("a session in one of the app's terminals takes it as a prompt, unless its box holds a draft", async () => {
    const b = bench()
    const s = b.session('Dark theme contrast')
    b.inPane(s, 5, EMPTY_BOX)
    expect(await b.actions.reply(s.id, 'check the focus ring too')).toEqual({ ok: true })
    b.inPane(s, 5, ['● Done.', RULE, '❯ a half-written thought', RULE])
    expect(await b.actions.reply(s.id, 'and the borders')).toEqual({ ok: false, why: expect.stringContaining('already holds "a half-written thought"') })
    expect(b.did).toEqual(['typed 5 "check the focus ring too"'])
  })

  test('a child with no process gets it in its inbox, and a guard that stops it is said', async () => {
    const b = bench()
    const ended = b.session('Forward-only migration')
    expect(await b.actions.reply(ended.id, 'continue')).toEqual({ ok: true, note: expect.stringContaining('inbox') })
    expect(b.did).toEqual([`inbox ${ended.short} "continue"`])
    b.fail.asMe = "c6d082fb's input already holds \"wip\", typed in another attach: send or clear it there, nothing was typed"
    expect(await b.actions.reply(b.session('Tenant in every cache key').id, 'go')).toEqual({ ok: false, why: b.fail.asMe })
  })

  test('nothing is sent with no words, or to nobody', async () => {
    const b = bench()
    expect(await b.actions.reply(b.session('Tenant in every cache key').id, '   ')).toEqual({ ok: false, why: NOTHING })
    expect(await b.actions.reply('nobody', 'hello')).toEqual({ ok: false, why: GONE })
    expect(b.did).toEqual([])
  })
})

describe('a message, which can never approve anything', () => {
  test('goes to a child\'s inbox by its short id', async () => {
    const b = bench()
    const child = b.session('Tenant in every cache key')
    expect(await b.actions.message(child.id, 'rebase on main')).toEqual({ ok: true, note: 'Sent to its inbox.' })
    expect(b.did).toEqual([`inbox ${child.short} "rebase on main"`])
  })

  test('"all" reaches every child that runs, and says which it did not reach', async () => {
    const b = bench()
    const running = b.state.world.sessions.filter((s) => s.role === 'child' && s.live)
    expect(running.length).toBe(2)
    expect(await b.actions.message('all', 'stand by')).toEqual({ ok: true, note: 'Sent to 2 children.' })
    expect(b.did).toEqual(running.map((s) => `inbox ${s.short} "stand by"`))
    b.fail[`inbox ${running[0].short}`] = 'no socket'
    const o = await b.actions.message('all', 'stand by')
    expect(o).toEqual({ ok: false, why: `Sent to 1 of 2 children. Not sent: ${running[0].short}: no socket` })
  })

  test('with no child running, nothing is sent', async () => {
    const b = bench()
    b.state.snapshot = { ...b.state.snapshot, repos: b.state.snapshot.repos.map((r) => ({ ...r, children: r.children.map((c) => ({ ...c, live: false })) })) }
    expect((await b.actions.message('all', 'stand by')).ok).toBe(false)
    expect(b.did).toEqual([])
  })
})

describe('stopping', () => {
  test('only a child that runs is stopped', async () => {
    const b = bench()
    const child = b.session('Tenant in every cache key')
    expect(await b.actions.stop(child.id)).toEqual({ ok: true, note: 'Stopped. It keeps its conversation.' })
    expect(await b.actions.stop(b.session('Shell completions for fish').id)).toEqual({ ok: false, why: expect.stringContaining('not running') })
    expect(await b.actions.stop(b.session('Dark theme contrast').id)).toEqual({ ok: false, why: expect.stringContaining('close it') })
    expect(b.did).toEqual([`stop ~/work/atlas-api ${child.short}`])
  })
})

describe('starting', () => {
  test('a new session starts in the repo and goes on stage', async () => {
    const b = bench()
    expect(await b.actions.newSession('/Users/you/work/atlas-api')).toEqual({ ok: true, note: 'Started.' })
    expect(b.did).toEqual(['start {"kind":"claude","root":"/Users/you/work/atlas-api"}'])
    expect(b.staged).toEqual(['fresh-1'])
  })

  test('its first prompt is typed once its input box is up', async () => {
    const b = bench()
    expect(await b.actions.newSession('/Users/you/work/atlas-api', { prompt: 'read the README' })).toEqual({ ok: true, note: 'Started, and prompted.' })
    expect(b.did.at(-1)).toBe('typed 41 "read the README"')
  })

  test('a session on another CLI than the active account\'s is not started under its name', async () => {
    const b = bench()
    expect((await b.actions.newSession('/Users/you/work/atlas-api', { agent: 'grok' })).ok).toBe(false)
    expect(b.did).toEqual([])
  })

  test('a shell opens in the repo and goes on stage; what could not start says why', async () => {
    const b = bench()
    expect((await b.actions.newShell('/Users/you/work/atlas-api')).ok).toBe(true)
    expect(b.staged).toEqual(['session:1'])
    b.fail.start = 'Could not open a terminal in /nowhere: no such folder'
    expect(await b.actions.newShell('/nowhere')).toEqual({ ok: false, why: b.fail.start })
  })

  test('a dispatch carries its model, effort, may and advisor, and says how it ended', async () => {
    const b = bench()
    const o = { model: 'opus', effort: 'high', may: 'pr', advisor: 'fable' }
    expect(await b.actions.dispatch('/r', [12, 14], o)).toEqual({ ok: true, note: 'Dispatched #12 #14.' })
    expect(await b.actions.dispatchContract('/r', 'docs/contracts/x.md', { may: 'push' })).toEqual({ ok: true, note: 'Dispatched docs/contracts/x.md.' })
    const ran = [`dispatch /r 12,14 ${JSON.stringify(o)}`, 'contract /r docs/contracts/x.md {"may":"push"}']
    expect(b.did).toEqual(ran)
    // With no issue and with no contract, nothing runs.
    expect((await b.actions.dispatch('/r', [])).ok).toBe(false)
    expect((await b.actions.dispatchContract('/r', '  ')).ok).toBe(false)
    expect(b.did).toEqual(ran)
    b.fail.dispatch = 'the same dispatch is already running'
    expect(await b.actions.dispatch('/r', [12])).toEqual({ ok: false, why: '#12 not dispatched: the same dispatch is already running' })
  })
})

describe('merging what is green', () => {
  test('only an open pull request whose checks all passed, one at a time', async () => {
    const b = bench()
    expect(await b.actions.mergeGreen()).toEqual({ ok: true, note: 'Merged #412.' })
    expect(b.did).toEqual(['merge ~/work/atlas-api #412'])
  })

  test('what did not merge is said beside what did', async () => {
    const b = bench()
    b.state.world = { ...b.state.world, pending: b.state.world.pending.map((p) => (p.pr ? { ...p, pr: { ...p.pr, ci: 'green' as const } } : p)) }
    b.fail['merge 233'] = 'not merged: its head moved'
    const o = await b.actions.mergeGreen()
    expect(o.ok).toBe(false)
    expect(o).toMatchObject({ why: expect.stringContaining('Merged #412.') })
    expect(o).toMatchObject({ why: expect.stringContaining('#233: not merged: its head moved') })
  })

  test('with nothing green, nothing runs', async () => {
    const b = bench()
    b.state.world = { ...b.state.world, pending: b.state.world.pending.filter((p) => p.pr?.ci !== 'green') }
    expect((await b.actions.mergeGreen()).ok).toBe(false)
    expect(b.did).toEqual([])
  })
})

describe('landing a mission', () => {
  const withMission = (b: ReturnType<typeof bench>, landable: boolean) => {
    const piece = b.state.snapshot.repos.flatMap((r) => r.children).find((c) => c.pr)!
    b.state.snapshot = {
      ...b.state.snapshot,
      repos: b.state.snapshot.repos.map((r) => (r.root === '~/work/atlas-api' ? { ...r, missions: [{ feature: 'orders', contract_path: 'docs/contracts/orders.md', landable, pieces: [{ name: 'cursor', branch: 'feat/orders/cursor', child: piece, pr: piece.pr ?? null }] }] } : r)),
    }
  }

  test('a landable one lands where its pieces work', async () => {
    const b = bench()
    withMission(b, true)
    expect(await b.actions.land('~/work/atlas-api', 'orders')).toEqual({ ok: true, note: 'orders landed.' })
    expect(b.did).toEqual(['land ~/work/atlas-api orders'])
  })

  test('one that is not landable, or not there, runs nothing', async () => {
    const b = bench()
    withMission(b, false)
    expect(await b.actions.land('~/work/atlas-api', 'orders')).toEqual({ ok: false, why: expect.stringContaining('not landable now') })
    expect(await b.actions.land('~/work/atlas-api', 'nothing')).toEqual({ ok: false, why: expect.stringContaining('not a mission') })
    expect(b.did).toEqual([])
  })
})

describe('what a session saw, and what opens outside', () => {
  test('a screenshot comes back as a picture an <img> can show', async () => {
    const b = bench()
    const s = b.state.world.sessions.find((x) => x.web.shots.length > 0)!
    const shot = s.web.shots[0]
    expect(await b.actions.shot(s.id, shot.id)).toBe(`data:${shot.mediaType};base64,AAAA`)
    expect(b.did).toEqual([`shot ${s.id} ${s.account} ${shot.id}`])
    // One the session never took is not asked for.
    expect(await b.actions.shot(s.id, 'gone.png')).toBeNull()
    expect(await b.actions.shot('nobody', shot.id)).toBeNull()
    expect(b.did).toHaveLength(1)
    b.fail.shot = 'not read yet'
    expect(await b.actions.shot(s.id, shot.id)).toBeNull()
  })

  test('a web page goes to the browser, a path to the system, and nothing else leaves', async () => {
    const b = bench()
    expect(await b.actions.external('https://github.com/example/atlas-api/pull/412')).toEqual({ ok: true })
    expect(await b.actions.external('/Users/you/work/atlas-api/README.md')).toEqual({ ok: true })
    expect((await b.actions.external('javascript://alert(1)')).ok).toBe(false)
    expect((await b.actions.external('  ')).ok).toBe(false)
    expect(b.did).toEqual(['page https://github.com/example/atlas-api/pull/412', 'file /Users/you/work/atlas-api/README.md'])
  })
})

test('open and close are the hosting\'s', async () => {
  const b = bench()
  await b.actions.open('a')
  await b.actions.close('b')
  expect(b.did).toEqual(['open a', 'close b'])
})

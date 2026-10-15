import { captain, child, MNEMO, pr, robot, ROOT } from '../command/fixtures'
import type { SessionSpec } from '../drawer/open'
import { orphanCaptainId, type ActionResult, type LogEvent, type Ship, type ShipAction } from '../ship-types'
import type { ConfirmOptions } from '../ui/confirm'
import type { MenuItem, MenuTarget } from '../ui/menus'
import { makeShipMenu, type MenuDeps } from './menu'

const LEAD = 'cap-1-0000-4000-8000-000000000000'
const GONE = 'cap-9-0000-4000-8000-000000000000'
const OUTSIDE = 'cap-2-0000-4000-8000-000000000000'
const DOCKED = 'cap-3-0000-4000-8000-000000000000'
const green = { state: 'OPEN' as const, mergedAt: null, closedAt: null, checks: [{ name: 'test', startedAt: 1, completedAt: 2, conclusion: 'SUCCESS' }] }

/** A deck (mnemo-desktop) with a captain in a pane, one outside the app, one ended and the empty
 *  chair; a dock (mnemo) with one captain. Robots: `201` working, `202` green in the hangar, `203`
 *  done with no PR. */
function ship(): Ship {
  return {
    bridge: { exceptions: [], blocked: [] },
    decks: [
      {
        root: ROOT,
        name: 'mnemo-desktop',
        captains: [
          captain(LEAD, 'fleet lead'),
          captain(GONE, 'session cap-9', { parent: null, pose: 'offline' }),
          captain(orphanCaptainId(ROOT), 'no parent', { parent: null, pose: 'empty', emblem: '?' }),
        ],
        quiet: [captain(OUTSIDE, 'reviewer')],
        flight: [robot('201')],
        hangar: [
          robot('202', { state: 'done', zone: 'hangar', action: null, ci: 'green', pr: pr(202), fate: green }),
          robot('203', { state: 'done', zone: 'hangar', action: null }),
        ],
        stranded: [],
        hangarReady: true,
      },
    ],
    docks: [{ root: MNEMO, name: 'mnemo', captains: [captain(DOCKED, 'docked', { parent: { session_id: DOCKED, pid: 1, name: null, status: 'idle', cwd: MNEMO } })] }],
    counts: { working: 1, need: 0, ready: 1 },
    rate: null,
    at: 0,
  }
}

type Calls = { sessions: SessionSpec[]; ended: number[]; asked: ConfirmOptions[]; actions: ShipAction[]; windows: [string, unknown][]; urls: string[]; copied: string[]; logged: LogEvent[]; said: [string, boolean][]; opened: string[] }

function setup(over: Partial<MenuDeps> & { answer?: boolean; result?: ActionResult } = {}) {
  const c: Calls = { sessions: [], ended: [], asked: [], actions: [], windows: [], urls: [], copied: [], logged: [], said: [], opened: [] }
  const deps: MenuDeps = {
    openSession: async (s) => void c.sessions.push(s),
    paneOf: (id) => (id === LEAD ? 7 : null),
    endSession: async (p) => void c.ended.push(p),
    confirm: async (o) => {
      c.asked.push(o)
      return over.answer ?? true
    },
    runAction: async (a) => {
      c.actions.push(a)
      return over.result ?? { ok: true, say: 'done', log: [{ id: 'you:1', at: 1, kind: 'you', robotId: null, captainId: null, text: 'you did it' }] }
    },
    openWindow: (id, params) => void c.windows.push([id, params]),
    openUrl: async (u) => void c.urls.push(u),
    copy: async (t) => void c.copied.push(t),
    savedCommands: (root) => (root === ROOT ? [{ label: 'dev', command: 'pnpm tauri dev' }] : []),
    log: (events) => void c.logged.push(...events),
    say: (text, error) => void c.said.push([text, !!error]),
    ...over,
  }
  const menu = (target: MenuTarget, s: Ship = ship()) => makeShipMenu(deps)(target, s, { open: (id) => void c.opened.push(id) })
  return { c, menu }
}

const ids = (items: MenuItem[]) => items.map((i) => i.id)
const item = (items: MenuItem[], id: string) => items.find((i) => i.id === id)!
const live = (items: MenuItem[]) => items.filter((i) => !i.disabled).map((i) => i.id)

describe('a captain', () => {
  test('in a pane: Open, Close and Copy id; Close asks, then ends its pane', async () => {
    const { c, menu } = setup()
    const items = menu({ kind: 'captain', id: LEAD })
    expect(ids(items)).toEqual(['open', 'close', 'copy-id'])
    expect(live(items)).toEqual(['open', 'close', 'copy-id'])
    item(items, 'open').run()
    expect(c.opened).toEqual([LEAD])
    await item(items, 'close').run()
    expect(c.asked).toEqual([expect.objectContaining({ title: 'Close fleet lead?', danger: true })])
    expect(c.ended).toEqual([7])
  })

  test('a Close answered Cancel ends nothing', async () => {
    const { c, menu } = setup({ answer: false })
    await item(menu({ kind: 'captain', id: LEAD }), 'close').run()
    expect(c.asked).toHaveLength(1)
    expect(c.ended).toEqual([])
  })

  test('running outside the app: Close is disabled and says so', () => {
    const { menu } = setup()
    const close = item(menu({ kind: 'captain', id: OUTSIDE }), 'close')
    expect(close).toMatchObject({ disabled: true, hint: 'it runs outside the app' })
  })

  test('ended: Resume reopens its session in its repo; Open is disabled; no Close', async () => {
    const { c, menu } = setup()
    const items = menu({ kind: 'captain', id: GONE })
    expect(ids(items)).toEqual(['open', 'resume', 'copy-id'])
    expect(live(items)).toEqual(['resume', 'copy-id'])
    await item(items, 'resume').run()
    expect(c.sessions).toEqual([{ kind: 'claude', root: ROOT, resume: GONE }])
  })

  test('on a dock: Copy id copies its session id', async () => {
    const { c, menu } = setup()
    await item(menu({ kind: 'captain', id: DOCKED }), 'copy-id').run()
    expect(c.copied).toEqual([DOCKED])
    expect(c.said).toEqual([[`Copied ${DOCKED}`, false]])
  })

  test('the empty chair offers what starts in its repo: no Open, Close, Resume or id', async () => {
    const { c, menu } = setup()
    const items = menu({ kind: 'captain', id: orphanCaptainId(ROOT) })
    expect(ids(items)).toEqual(['new-session', 'terminal', 'command:0'])
    await item(items, 'new-session').run()
    expect(c.sessions).toEqual([{ kind: 'claude', root: ROOT }])
  })

  test('one no longer on the ship offers nothing', () => {
    expect(setup().menu({ kind: 'captain', id: 'cap-x' })).toEqual([])
  })
})

describe('a robot', () => {
  test('working: Open, Stop, Changes and Copy id; Merge and Open PR wait for a PR', () => {
    const items = setup().menu({ kind: 'robot', id: '201' })
    expect(ids(items)).toEqual(['open', 'stop', 'merge', 'open-pr', 'changes', 'copy-id'])
    expect(live(items)).toEqual(['open', 'stop', 'changes', 'copy-id'])
    expect(item(items, 'merge').hint).toBe('no PR yet')
    expect(item(items, 'open-pr').hint).toBe('no PR yet')
  })

  test('Stop asks, then runs claude stop through the command piece and logs it', async () => {
    const { c, menu } = setup()
    await item(menu({ kind: 'robot', id: '201' }), 'stop').run()
    expect(c.asked).toEqual([expect.objectContaining({ title: 'Stop #201?', danger: true })])
    expect(c.actions).toEqual([{ kind: 'stop', robotIds: ['201'] }])
    expect(c.logged.map((e) => e.text)).toEqual(['you did it'])
    expect(c.said).toEqual([])
  })

  test('a refused action says why', async () => {
    const { c, menu } = setup({ result: { ok: false, say: 'not merged: checks are red', log: [] } })
    await item(menu({ kind: 'robot', id: '202' }), 'merge').run()
    expect(c.said).toEqual([['not merged: checks are red', true]])
  })

  test('green: Merge PR is confirmed first; Cancel merges nothing', async () => {
    const yes = setup()
    await item(yes.menu({ kind: 'robot', id: '202' }), 'merge').run()
    expect(yes.c.asked).toEqual([expect.objectContaining({ title: 'Merge PR #202?' })])
    expect(yes.c.actions).toEqual([{ kind: 'merge', robotIds: ['202'] }])
    const no = setup({ answer: false })
    await item(no.menu({ kind: 'robot', id: '202' }), 'merge').run()
    expect(no.c.actions).toEqual([])
  })

  test('finished: Stop is disabled; Open PR opens it in the system browser; Changes opens its worktree', async () => {
    const { c, menu } = setup()
    const items = menu({ kind: 'robot', id: '202' })
    expect(item(items, 'stop')).toMatchObject({ disabled: true, hint: 'it has finished' })
    await item(items, 'open-pr').run()
    expect(c.urls).toEqual(['https://github.com/you/mnemo-desktop/pull/202'])
    item(items, 'changes').run()
    expect(c.windows).toEqual([['changes', { robotId: '202', worktree: `${ROOT}-wt-202`, label: '#202' }]])
  })

  test.each([
    [{ ci: 'red' as const, pr: pr(9, { ci: 'fail' }) }, 'its checks failed'],
    [{ ci: 'run' as const, pr: pr(9, { ci: 'pending' }) }, 'its checks are still running'],
    [{ ci: null, pr: pr(9, { ci: 'none' }) }, 'no check has passed on it'],
    [{ ci: 'green' as const, pr: pr(9, { draft: true }), fate: green }, 'a draft: mark it ready first'],
    [{ ci: 'green' as const, pr: pr(9, { state: 'MERGED' }), fate: { ...green, state: 'MERGED' as const } }, 'already merged'],
    [{ ci: 'green' as const, pr: pr(9), fate: { ...green, state: 'CLOSED' as const } }, 'the PR is closed'],
    [{ ci: 'green' as const, pr: pr(9, { url: 'https://github.com/you/mnemo/pull/9' }), fate: green }, 'PR #9 is in you/mnemo, not in mnemo-desktop'],
  ])('Merge PR is disabled when it would fail: %j', (over, hint) => {
    const s = ship()
    s.decks[0].hangar.push(robot('209', { state: 'done', zone: 'hangar', action: null, ...over }))
    expect(item(setup().menu({ kind: 'robot', id: '209' }, s), 'merge')).toMatchObject({ disabled: true, hint })
  })

  test('a green PR with no check run is not green: Merge stays disabled', () => {
    const s = ship()
    s.decks[0].hangar.push(robot('209', { state: 'done', zone: 'hangar', action: null, ci: 'green', pr: pr(9), fate: { ...green, checks: [] } }))
    expect(item(setup().menu({ kind: 'robot', id: '209' }, s), 'merge').disabled).toBe(true)
  })

  test('Copy id copies the short id; a failed copy says why', async () => {
    const ok = setup()
    await item(ok.menu({ kind: 'robot', id: '203' }), 'copy-id').run()
    expect(ok.c.copied).toEqual(['203'])
    const bad = setup({ copy: () => Promise.reject(new Error('no clipboard')) })
    await item(bad.menu({ kind: 'robot', id: '203' }), 'copy-id').run()
    expect(bad.c.said).toEqual([['no clipboard', true]])
  })

  test('a robot standing on the bridge has its menu too', () => {
    const s = ship()
    s.bridge.blocked.push(robot('210', { state: 'need', zone: 'bridge', child: child('210') }))
    expect(live(setup().menu({ kind: 'robot', id: '210' }, s))).toEqual(['open', 'stop', 'changes', 'copy-id'])
  })
})

describe('a deck or a dock', () => {
  test('a deck: New session, Terminal here and its saved commands, each through openSession', async () => {
    const { c, menu } = setup()
    const items = menu({ kind: 'deck', id: ROOT })
    expect(items.map((i) => [i.label, i.hint])).toEqual([
      ['New session', 'claude'],
      ['Terminal here', 'a shell'],
      ['dev', 'pnpm tauri dev'],
    ])
    for (const i of items) await i.run()
    expect(c.sessions).toEqual([
      { kind: 'claude', root: ROOT },
      { kind: 'shell', root: ROOT },
      { kind: 'command', root: ROOT, command: 'pnpm tauri dev', label: 'dev' },
    ])
  })

  test('a dock with no saved command: New session and Terminal here', () => {
    expect(ids(setup().menu({ kind: 'dock', id: MNEMO }))).toEqual(['new-session', 'terminal'])
  })

  test('a session that does not open says why', async () => {
    const { c, menu } = setup({ openSession: () => Promise.reject(new Error('no daemon')) })
    await item(menu({ kind: 'dock', id: MNEMO }), 'terminal').run()
    expect(c.said).toEqual([['no daemon', true]])
  })
})

test('the SYSTEMS menu is not this piece’s', () => {
  expect(setup().menu({ kind: 'systems', id: '' })).toEqual([])
})

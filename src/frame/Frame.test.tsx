import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { resetLine, type as typeInLine } from '../command/line'
import { actions } from '../world/actions'
import { HOME, go, routeStore, type Route } from '../world/route'
import { sampleWorld } from '../world/sample'
import { pendingInOrder, rosterOrder, worldStore } from '../world/store'
import type { Session } from '../world/types'
import { panels } from '../panels'
import { LEAVE_MS } from './Boot'
import { Frame, MOST_MOVED, MOVE_MS, continuity, contraction, entriesOf, slides } from './Frame'
import { presenceIn, setJames } from './james'
import { sheetStore } from './KeySheet'
import { motionStore, setReduced } from './motion'
import { accountInFront, countsByState, fitFleet, until } from './TopBar'

// Every view is another piece's. Here each is the least that shows where the frame put it and
// what it was given, so these tests hold before and after the real ones land.
const seen = vi.hoisted(() => ({
  orbitTook: [] as string[],
  runtime: 0,
  answered: [] as number[],
  replied: 0,
  takesReply: true,
  /** The terminals the runtime holds (`useHosted`), and a way to say they changed. */
  hosted: [] as { id: string; kind: 'robot' | 'captain' | 'session'; label: string; cwd: string | null; sessionId: string | null; pty: number | null }[],
  /** The order the roster shows, when it is not the world's own (`G`). */
  shown: null as string[] | null,
}))
vi.mock('../orbit', () => ({
  OrbitView: () => (
    <section
      data-testid="orbit"
      tabIndex={0}
      onKeyDown={(e) => {
        // Orbit moves between neighbours with the arrows while the caret is inside it.
        if (e.key === 'ArrowDown') {
          seen.orbitTook.push(e.key)
          e.preventDefault()
        }
      }}
    />
  ),
}))
vi.mock('../roster', async () => {
  const { rosterOrder, worldStore } = await import('../world/store')
  return {
    // what a key that walks the roster walks: the world's order, or the one a test says is shown
    rosterShown: () => {
      const order = rosterOrder(worldStore.getState().world)
      return seen.shown ? seen.shown.map((id) => order.find((s) => s.id === id)!) : order
    },
    Roster: () => (
      <nav data-testid="roster" data-roster>
        <div data-orbit-map />
        <input aria-label="find" />
        <button type="button">an entry</button>
        {rosterOrder(worldStore.getState().world).map((s) => (
          <i key={s.id} data-session={s.id} />
        ))}
      </nav>
    ),
  }
})
vi.mock('../stage', () => ({
  // no way in of its own: the frame finds the terminal itself
  focusTerminal: undefined,
  Stage: () => (
    <section data-stage data-testid="stage">
      <div className="xterm">
        <textarea className="xterm-helper-textarea" aria-label="terminal" />
      </div>
    </section>
  ),
}))
vi.mock('../instruments', () => ({ Instruments: ({ sessionId, at }: { sessionId: string; at?: number | null }) => <aside data-testid="instruments" data-session={sessionId} data-at={at ?? ''} /> }))
vi.mock('../score', async () => {
  const { rosterOrder, worldStore } = await import('../world/store')
  return {
    ScoreView: () => (
      <section data-testid="score">
        {rosterOrder(worldStore.getState().world).map((s) => (
          <div key={s.id} data-score-row={s.id}>
            <i data-session={s.id} />
          </div>
        ))}
      </section>
    ),
  }
})
vi.mock('../runtime', () => ({ startRuntime: () => (seen.runtime++, () => {}), useHosted: () => seen.hosted }))
// What waits is the pending piece's: its count, and what a digit and `R` do. The order `N`
// walks is the real one.
vi.mock('../pending', async (original) => {
  const real = await original<typeof import('../pending')>()
  return {
    armedPending: real.armedPending,
    nextPending: real.nextPending,
    WaitingCount: () => <span data-testid="waiting" />,
    answerArmed: async (key: number) => (seen.answered.push(key), null),
    replyArmed: () => (seen.replied++, seen.takesReply),
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sample = sampleWorld()
const order = rosterOrder(sample)
const titled = (start: string): Session => sample.sessions.find((s) => s.title.startsWith(start))!

let root: Root
let host: HTMLElement

const route = () => routeStore.getState().route
const world = () => worldStore.getState().world
const at = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const frame = () => host.querySelector<HTMLElement>('.mn')!

async function draw(start: Partial<Route> = {}) {
  routeStore.setState({ route: { ...HOME, view: 'console', session: order[0].id, ...start }, recent: [] })
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  await act(async () => root.render(<Frame />))
}

/** A key pressed with the caret on `target`. False when somebody took it. */
async function key(target: EventTarget, k: string, more: KeyboardEventInit = {}): Promise<boolean> {
  let free = true
  await act(async () => {
    free = target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more }))
  })
  return free
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('mnemo.world', 'sample')
  motionStore.setState({ reduced: true })
  sheetStore.setState({ open: false })
  resetLine()
  seen.orbitTook.length = 0
  seen.answered.length = 0
  seen.replied = 0
  seen.takesReply = true
  seen.hosted = []
  seen.shown = null
  sessionStorage.clear()
  setJames(null)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('the room each view gets', () => {
  test('Console is the roster, the stage, and the instruments of the session on stage', async () => {
    await draw()
    expect([!!at('roster'), !!at('stage'), !!at('orbit'), !!at('score')]).toEqual([true, true, false, false])
    expect(at('instruments')?.dataset.session).toBe(order[0].id)
    const columns = [...host.querySelectorAll<HTMLElement>('.frame-col')].map((c) => c.dataset.col)
    expect(columns).toEqual(['roster', 'stage', 'instruments'])
  })

  test('wide gives the instruments’ room to the stage', async () => {
    await draw({ wide: true })
    expect(at('instruments')).toBeNull()
    expect([!!at('roster'), !!at('stage')]).toEqual([true, true])
    await act(async () => go({ wide: false }))
    expect(at('instruments')).not.toBeNull()
  })

  test('Console is never without a session on stage: with none chosen, the first in roster order', async () => {
    await draw({ session: null })
    expect(route().session).toBe(order[0].id)
    expect(at('instruments')?.dataset.session).toBe(order[0].id)
  })

  test('a session that is not in the world is replaced the same way', async () => {
    await draw({ session: 'gone-from-the-world' })
    expect(route().session).toBe(order[0].id)
  })

  test('Orbit and Score have the whole room, and keep the selection', async () => {
    await draw({ view: 'orbit', session: order[3].id })
    expect([!!at('orbit'), !!at('roster'), !!at('score')]).toEqual([true, false, false])
    await act(async () => go({ view: 'score' }))
    expect([!!at('orbit'), !!at('roster'), !!at('score')]).toEqual([false, false, true])
    expect(route().session).toBe(order[3].id)
  })

  test('the runtime starts only in a live world', async () => {
    seen.runtime = 0
    await draw()
    expect(seen.runtime).toBe(0)
  })
})

describe('changing view', () => {
  test('the view left stays for the move, inert, then goes', async () => {
    vi.useFakeTimers()
    await draw()
    await act(async () => motionStore.setState({ reduced: false }))
    await act(async () => go({ view: 'orbit' }))
    const leaving = host.querySelector<HTMLElement>('[data-layer="console"]')!
    expect(leaving).not.toBeNull()
    expect(leaving.hasAttribute('inert')).toBe(true)
    expect(host.querySelector<HTMLElement>('[data-layer="orbit"]')!.hasAttribute('inert')).toBe(false)
    await act(async () => vi.advanceTimersByTime(MOVE_MS))
    expect(host.querySelector('[data-layer="console"]')).toBeNull()
    expect(at('orbit')).not.toBeNull()
    expect(host.querySelector<HTMLElement>('[data-layer="orbit"]')!.dataset.phase).toBeUndefined()
  })

  test('the layers are told where they are going before they move (with nothing laid out, no entry has a place to slide from)', async () => {
    vi.useFakeTimers()
    await draw()
    await act(async () => motionStore.setState({ reduced: false }))
    await act(async () => go({ view: 'score' }))
    const [out, into] = [host.querySelector<HTMLElement>('[data-layer="console"]')!, host.querySelector<HTMLElement>('[data-layer="score"]')!]
    expect([out.dataset.phase, into.dataset.phase]).toEqual(['out', 'in'])
    // Score is to the right of Console: one leaves leftward, the other comes from the right
    expect(out.style.getPropertyValue('--frame-to')).toBe('translateX(-2.5em)')
    expect(into.style.getPropertyValue('--frame-from')).toBe('translateX(2.5em)')
  })

  test('Orbit contracts into the map at the head of the roster, whole and centred, and opens out of it', () => {
    const scene = { left: 0, top: 50, width: 2000, height: 1000 }
    // a map wider than the scene is: the height decides, and the scene sits in its middle
    const map = { left: 20, top: 60, width: 300, height: 100 }
    expect(contraction(scene, map)).toBe('translate(70px, 10px) scale(0.1)')
    // a map taller than the scene is: the width decides
    expect(contraction(scene, { left: 20, top: 60, width: 100, height: 300 })).toBe('translate(20px, 135px) scale(0.05)')
    expect(contraction(scene, { ...map, width: 0 })).toBeNull()

    expect(continuity('orbit', 'console', scene, map)).toEqual({ leave: 'translate(70px, 10px) scale(0.1)', arrive: 'none' })
    expect(continuity('console', 'orbit', scene, map)).toEqual({ leave: 'none', arrive: 'translate(70px, 10px) scale(0.1)' })
  })

  test('with no map to contract into, or between Console and Score, the views slide the way the top bar reads', () => {
    const box = { left: 0, top: 0, width: 100, height: 100 }
    expect(continuity('orbit', 'console', box, null)).toEqual({ leave: 'translateX(-2.5em)', arrive: 'translateX(2.5em)' })
    expect(continuity('score', 'console', box, box)).toEqual({ leave: 'translateX(2.5em)', arrive: 'translateX(-2.5em)' })
    expect(continuity('score', 'orbit', null, null)).toEqual({ leave: 'translateX(2.5em)', arrive: 'translateX(-2.5em)' })
  })

  test('with motion reduced the new view is simply there', async () => {
    await draw()
    await act(async () => go({ view: 'score' }))
    expect(host.querySelectorAll('[data-layer]').length).toBe(1)
    expect(at('score')).not.toBeNull()
  })

  test('a tab in the top bar changes the view, and says which is current', async () => {
    await draw()
    const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('.frame-view-tab')].find((b) => b.textContent!.includes(name))!
    expect(tab('Console').getAttribute('aria-current')).toBe('page')
    await act(async () => tab('Score').click())
    expect(route().view).toBe('score')
    expect(tab('Score').getAttribute('aria-current')).toBe('page')
    expect(tab('Console').getAttribute('aria-current')).toBeNull()
  })
})

describe('the fleet-wide keys, on the page', () => {
  test('a bare key anywhere on the frame is the fleet’s', async () => {
    await draw()
    expect(await key(document.body, 'ArrowDown')).toBe(false)
    expect(route().session).toBe(order[1].id)
    await key(document.body, 't')
    expect(route().view).toBe('score')
  })

  test('typed into a text field, a key is a letter; with Alt it is the fleet’s', async () => {
    await draw()
    const field = host.querySelector<HTMLInputElement>('input[aria-label="find"]')!
    expect(await key(field, 't')).toBe(true)
    expect(route().view).toBe('console')
    expect(await key(field, 't', { altKey: true })).toBe(false)
    expect(route().view).toBe('score')
  })

  test('Esc leaves a text field, so the bare keys work again', async () => {
    await draw()
    const field = host.querySelector<HTMLInputElement>('input[aria-label="find"]')!
    await act(async () => field.focus())
    expect(await key(field, 'Escape')).toBe(false)
    expect(document.activeElement).not.toBe(field)
    await key(document.body, 't')
    expect(route().view).toBe('score')
  })

  test('a field that hands the caret on at Esc keeps what it chose', async () => {
    await draw()
    const field = host.querySelector<HTMLInputElement>('input[aria-label="find"]')!
    const entry = host.querySelector<HTMLButtonElement>('nav[data-testid="roster"] button')!
    // as the stage's box does: Esc gives the caret to the stage
    field.addEventListener('keydown', (e) => e.key === 'Escape' && entry.focus())
    await act(async () => field.focus())
    await key(field, 'Escape')
    expect(document.activeElement).toBe(entry)
  })

  test('typed into the terminal, a key is the session’s', async () => {
    await draw()
    const term = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    expect(await key(term, 'n')).toBe(true)
    expect(await key(term, 'ArrowDown')).toBe(true)
    expect(await key(term, 'Escape')).toBe(true)
    expect(route()).toMatchObject({ session: order[0].id, pending: null })
  })

  test('Alt reaches the fleet from the terminal, and the terminal never sees that key', async () => {
    await draw()
    const term = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    const got: string[] = []
    // xterm.js sends what it is given to the session and lets it go no further
    term.addEventListener('keydown', (e) => {
      got.push(e.key)
      e.stopPropagation()
    })
    expect(await key(term, 'n', { altKey: true })).toBe(false)
    expect(route().pending).toBe(pendingInOrder(sample)[0].id)
    expect(got).toEqual([])
    await key(term, 'x', { altKey: true })
    expect(got).toEqual(['x'])
  })

  test('a view that took a key keeps it', async () => {
    await draw({ view: 'orbit', session: order[0].id })
    await key(at('orbit')!, 'ArrowDown')
    expect(seen.orbitTook).toEqual(['ArrowDown'])
    expect(route().session).toBe(order[0].id)
    // a key it did not take is still the fleet's
    await key(at('orbit')!, 'c')
    expect(route().view).toBe('console')
  })

  test('a key typed outside the frame is not the frame’s', async () => {
    await draw()
    const elsewhere = document.body.appendChild(document.createElement('div'))
    expect(await key(elsewhere, 'ArrowDown')).toBe(true)
    expect(route().session).toBe(order[0].id)
    elsewhere.remove()
  })

  test('Enter puts the caret in the terminal on stage; Alt+Enter from inside gives it the room', async () => {
    await draw()
    const term = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    await key(document.body, 'Enter')
    expect(document.activeElement).toBe(term)
    expect(route().wide).toBe(false)
    await key(term, 'Enter', { altKey: true })
    expect(route().wide).toBe(true)
    expect(at('instruments')).toBeNull()
  })

  test('a digit goes to the pending piece, which answers the armed item with it', async () => {
    await draw()
    expect(await key(document.body, '3')).toBe(false)
    await key(host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!, '7', { altKey: true })
    expect(seen.answered).toEqual([3, 7])
  })

  test('R goes to the pending piece; when nothing armed takes a reply the key is not spent', async () => {
    await draw()
    expect(await key(document.body, 'r')).toBe(false)
    seen.takesReply = false
    expect(await key(document.body, 'r')).toBe(true)
    expect(seen.replied).toBe(2)
  })

  test('`;` opens the command line with the caret in it, and Esc there closes it', async () => {
    await draw()
    const line = host.querySelector<HTMLInputElement>('input[aria-label="Command line"]')!
    await key(document.body, ';')
    expect(route().command).toBe(true)
    expect(document.activeElement).toBe(line)
    expect(host.querySelectorAll('.frame-cmd-pop [role="option"]').length).toBeGreaterThan(0)
    await key(line, 'Escape')
    expect(route().command).toBe(false)
    expect(document.activeElement).not.toBe(line)
    expect(host.querySelector('.frame-cmd-pop')).toBeNull()
  })

  test('`?` opens the key sheet, and any key closes it without doing anything else', async () => {
    await draw()
    await key(document.body, '?', { shiftKey: true })
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
    await key(document.body, 'ArrowDown')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(route().session).toBe(order[0].id)
  })

  test('the foot says the keys need Alt while the caret is in a terminal or a field', async () => {
    await draw()
    const hints = () => host.querySelector<HTMLElement>('.frame-keys')!
    expect(hints().dataset.alt).toBeUndefined()
    await act(async () => host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!.focus())
    expect(hints().dataset.alt).toBe('true')
    await act(async () => host.querySelector<HTMLButtonElement>('nav[data-testid="roster"] button')!.focus())
    expect(hints().dataset.alt).toBeUndefined()
    // and when the caret simply leaves the terminal, for nowhere
    const term = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    await act(async () => term.focus())
    expect(hints().dataset.alt).toBe('true')
    await act(async () => term.blur())
    expect(hints().dataset.alt).toBeUndefined()
  })
})

describe('the top bar', () => {
  const count = (state: string) => Number(host.querySelector(`.frame-fl[data-state="${state}"] b`)!.textContent)

  test('counts the fleet by state, and follows the world', async () => {
    await draw()
    // the sample: 15 sessions, most urgent state first
    expect(countsByState(sample)).toEqual([
      { state: 'need', count: 2 },
      { state: 'stalled', count: 1 },
      { state: 'ready', count: 2 },
      { state: 'working', count: 3 },
      { state: 'idle', count: 6 },
      { state: 'ended', count: 1 },
    ])
    for (const { state, count: n } of countsByState(sample)) expect([state, count(state)]).toEqual([state, n])

    const working = sample.sessions.find((s) => s.state === 'working')!
    const [was, ended] = [count('working'), count('ended')]
    await act(async () => void (await actions().stop(working.id)))
    expect([count('working'), count('ended')]).toEqual([was - 1, ended + 1])
  })

  test('the words of the states give way when the bar has no room for them, and come back', async () => {
    await draw()
    const fleet = host.querySelector<HTMLElement>('.frame-fleet')!
    const sizes = { scroll: 900, client: 900 }
    Object.defineProperty(fleet, 'scrollWidth', { get: () => sizes.scroll })
    Object.defineProperty(fleet, 'clientWidth', { get: () => sizes.client })
    fitFleet(fleet)
    expect(fleet.hasAttribute('data-tight')).toBe(false)
    // something else in the bar grew: the fleet is given less than it needs
    sizes.client = 600
    fitFleet(fleet)
    expect(fleet.hasAttribute('data-tight')).toBe(true)
    // it is measured again whenever the bar is drawn, so the words return with the room
    sizes.client = 900
    await act(async () => worldStore.getState().set({ ...world(), pending: [] }))
    expect(fleet.hasAttribute('data-tight')).toBe(false)
    sizes.client = 600
    await act(async () => go({ view: 'score' }))
    expect(fleet.hasAttribute('data-tight')).toBe(true)
  })

  test('carries the pending piece’s count of what waits, between the views and the fleet', async () => {
    await draw()
    const bar = [...host.querySelector('[data-top-bar]')!.children]
    const at = (pick: (el: Element) => boolean) => bar.findIndex(pick)
    const count = at((el) => (el as HTMLElement).dataset.testid === 'waiting')
    expect(count).toBeGreaterThan(at((el) => el.classList.contains('frame-views')))
    expect(count).toBeLessThan(at((el) => el.classList.contains('frame-fleet')))
  })

  test('draws in full the account of the session in hand', async () => {
    const onSecond = sample.sessions.find((s) => s.account === 'second')!
    const onMain = sample.sessions.find((s) => s.account === 'default')!
    await draw({ session: onSecond.id })
    const bright = () => host.querySelector<HTMLElement>('.frame-acct[data-on]')!
    expect(bright().querySelector('.frame-acct-name')!.textContent).toBe('second')
    expect([...bright().querySelectorAll('.frame-lim b')].map((b) => b.textContent)).toEqual(['8%', '2%'])
    // only the account in hand has bars; the other keeps its numbers
    expect(host.querySelectorAll('.frame-plans [role="meter"]').length).toBe(2)
    expect(bright().querySelectorAll('[role="meter"]').length).toBe(2)
    await act(async () => go({ session: onMain.id }))
    expect(bright().querySelector('.frame-acct-name')!.textContent).toBe('main')
    expect([...bright().querySelectorAll('.frame-lim b')].map((b) => b.textContent)).toEqual(['46%', '21%'])
    expect(host.querySelectorAll('.frame-acct').length).toBe(sample.accounts.length)
  })

  test('with no session in hand, the active account is the one in front', () => {
    expect(accountInFront(sample, null)).toBe(sample.accounts.find((a) => a.active)!.id)
    expect(accountInFront(sample, titled('Idempotent retries').id)).toBe(titled('Idempotent retries').account)
    expect(accountInFront({ ...sample, accounts: [] }, null)).toBeNull()
  })

  test('says when a window resets, from the world’s own now', () => {
    const now = Date.parse('2026-11-09T21:30:00Z')
    expect(until(now + 20 * 60_000, now)).toBe('20m')
    expect(until(Date.parse('2026-11-09T23:50:00Z'), now)).toBe('2h')
    expect(until(Date.parse('2026-11-12T21:10:00Z'), now)).toBe('3d')
    expect(until(now - 1, now)).toBe('')
    expect(until(null, now)).toBe('')
  })

  test('a window that is nearly spent is marked', async () => {
    await draw()
    expect(host.querySelector('.frame-lim[data-hot]')).toBeNull()
    await act(async () => worldStore.getState().set({ ...world(), accounts: world().accounts.map((a) => ({ ...a, limits: a.limits.map((l) => (l.kind === 'session' ? { ...l, percent: 91 } : l)) })) }))
    expect(host.querySelectorAll('.frame-lim[data-hot]').length).toBe(sample.accounts.length)
  })

  test('the motion switch stills the frame, and is kept', async () => {
    motionStore.setState({ reduced: false })
    await draw()
    const button = host.querySelector<HTMLButtonElement>('.frame-motion')!
    expect(frame().dataset.motion).toBeUndefined()
    await act(async () => button.click())
    expect(frame().dataset.motion).toBe('reduced')
    expect(localStorage.getItem('mnemo.motion')).toBe('reduced')
    expect(button.textContent).toContain('reduced')
    await act(async () => button.click())
    expect(frame().dataset.motion).toBeUndefined()
    expect(localStorage.getItem('mnemo.motion')).toBe('full')
    setReduced(true)
  })

  test('says what the world could not read, for as long as it is true', async () => {
    await draw()
    expect(host.querySelector('[role="status"]')).toBeNull()
    await act(async () => worldStore.getState().set({ ...world(), errors: ['Plan usage: the sign-in expired.', 'Memory trail: no answer.'] }))
    expect([...host.querySelectorAll('[role="status"] li')].map((li) => li.textContent)).toEqual(['Plan usage: the sign-in expired.', 'Memory trail: no answer.'])
    await act(async () => worldStore.getState().set({ ...world(), errors: [] }))
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  test('says which world this is when it is not this machine', async () => {
    await draw()
    expect(host.querySelector('.frame-source')!.textContent).toBe('sample world')
    expect(frame().dataset.world).toBe('sample')
  })
})

describe('the panels, from the top bar', () => {
  const tab = (id: string) => host.querySelector<HTMLButtonElement>(`[data-panel-tab="${id}"]`)!

  test('the second line lists the panels that exist, in their order', async () => {
    await draw()
    const listed = [...host.querySelectorAll<HTMLElement>('[data-panel-tab]')].map((b) => b.dataset.panelTab)
    expect(listed).toEqual(panels().map((p) => p.id))
    expect(listed.length).toBeGreaterThan(0)
    expect(tab(listed[0]!).textContent).toBe(panels()[0].title)
  })

  test('a name opens its panel beside the view; the same name closes it', async () => {
    await draw()
    const [first, second] = panels().map((p) => p.id)
    await act(async () => tab(first).click())
    expect(route().panel).toBe(first)
    expect(tab(first).getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector(`[data-panel="${first}"]`)).not.toBeNull()
    // another name is that panel instead
    await act(async () => tab(second).click())
    expect(route().panel).toBe(second)
    expect([tab(first).getAttribute('aria-pressed'), tab(second).getAttribute('aria-pressed')]).toEqual(['false', 'true'])
    await act(async () => tab(second).click())
    expect(route().panel).toBeNull()
    // the view and the session in hand stay as they were
    expect(route()).toMatchObject({ view: 'console', session: order[0].id })
  })

  test('opening a panel from the bar closes the command line, even one with words in it', async () => {
    await draw()
    await key(document.body, ';')
    // a line being typed stays open when the caret leaves it: only the bar's own word closes it
    await act(async () => typeInLine('new atl'))
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Command line"]')!.blur())
    expect(route().command).toBe(true)
    await act(async () => tab(panels()[0].id).click())
    expect(route()).toMatchObject({ panel: panels()[0].id, command: false })
  })
})

describe('James in the top bar', () => {
  test('with no presence handed over there is none, and the foot keeps clear of his corner', async () => {
    await draw()
    expect(host.querySelector('[data-frame-james]')).toBeNull()
    expect(frame().dataset.james).toBeUndefined()
  })

  test('the presence the overlays piece exports stands at the end of the first line', async () => {
    setJames(() => <button type="button">James</button>)
    await draw()
    const bar = [...host.querySelector('[data-top-bar]')!.children]
    expect(bar[bar.length - 1].hasAttribute('data-frame-james')).toBe(true)
    expect(bar[bar.length - 1].textContent).toBe('James')
    expect(frame().dataset.james).toBe('true')
  })

  test('it is found in what `src/jarvis/panel/` exports, and only there', () => {
    const Presence = () => null
    expect(presenceIn({})).toBeNull()
    expect(presenceIn({ '../jarvis/panel/index.ts': { JarvisPanel: () => null } })).toBeNull()
    expect(presenceIn({ '../jarvis/panel/index.ts': { JamesPresence: 'not a component' } })).toBeNull()
    expect(presenceIn({ '../jarvis/panel/index.ts': { JamesPresence: Presence } })).toBe(Presence)
  })
})

describe('a terminal that is not a session', () => {
  const shell = { id: 'tab-shell-1', kind: 'session' as const, label: 'shell', cwd: 'C:/Users/you/work/atlas-api', sessionId: null, pty: 7 }

  test('on Console’s stage it stays: it is not taken for a session that left the world', async () => {
    seen.hosted = [shell]
    await draw({ session: shell.id })
    expect(route().session).toBe(shell.id)
    // it has nothing to read: no instruments beside it
    expect(at('instruments')).toBeNull()
  })

  test('once the app no longer holds it, the first session takes the stage', async () => {
    seen.hosted = []
    await draw({ session: shell.id })
    expect(route().session).toBe(order[0].id)
  })

  test('down from the last session walks on to the terminals, and up comes back', async () => {
    seen.hosted = [shell, { ...shell, id: 'tab-shell-2' }]
    const last = order[order.length - 1]
    await draw({ session: last.id })
    await key(document.body, 'ArrowDown')
    expect(route().session).toBe('tab-shell-1')
    await key(document.body, 'ArrowDown')
    expect(route().session).toBe('tab-shell-2')
    await key(document.body, 'ArrowDown')
    expect(route().session).toBe('tab-shell-2')
    await key(document.body, 'ArrowUp')
    await key(document.body, 'ArrowUp')
    expect(route().session).toBe(last.id)
  })

  test('a held terminal whose session the world lists is that session, not a second entry', async () => {
    const last = order[order.length - 1]
    seen.hosted = [{ ...shell, id: 'tab-of-a-session', kind: 'captain', sessionId: last.id }]
    await draw({ session: last.id })
    await key(document.body, 'ArrowDown')
    expect(route().session).toBe(last.id)
  })

  test('Q goes back to a terminal he was on', async () => {
    seen.hosted = [shell]
    await draw()
    await act(async () => go({ session: shell.id }))
    await act(async () => go({ session: order[2].id }))
    await key(document.body, 'q')
    expect(route().session).toBe(shell.id)
  })

  test('Q passes over a terminal the app no longer holds', async () => {
    seen.hosted = [shell]
    await draw()
    await act(async () => go({ session: order[1].id }))
    await act(async () => go({ session: shell.id }))
    await act(async () => go({ session: order[2].id }))
    // the shell's program exits: the app lets go of it (the frame hears that as it draws)
    seen.hosted = []
    await act(async () => motionStore.setState({ reduced: false }))
    await key(document.body, 'q')
    expect(route().session).toBe(order[1].id)
  })
})

describe('the keys walk the roster as it is shown', () => {
  test('regrouped by project, down is the next session of that order', async () => {
    seen.shown = [...order].reverse().map((s) => s.id)
    await draw({ session: order[order.length - 1].id })
    await key(document.body, 'ArrowDown')
    expect(route().session).toBe(order[order.length - 2].id)
    await key(document.body, 'ArrowUp')
    expect(route().session).toBe(order[order.length - 1].id)
  })
})

describe('between Console and Score the entries carry the change', () => {
  const room = { left: 0, top: 0, width: 2000, height: 1000 }
  const box = (left: number, top: number, width = 400, height = 60) => ({ left, top, width, height })

  test('each session both views show starts from where the other view had it', () => {
    const from = new Map([
      ['a', box(0, 100)],
      ['b', box(0, 200)],
    ])
    const to = new Map([
      ['a', box(1500, 140)],
      ['b', box(1500, 520)],
    ])
    expect(slides(from, to, room)).toEqual([
      { id: 'a', x: -1500, y: -40 },
      { id: 'b', x: -1500, y: -320 },
    ])
  })

  test('a session only one view shows, or one out of sight, does not move', () => {
    const from = new Map([
      ['a', box(0, 100)],
      ['scrolled-away', box(0, 1400)],
      ['folded', box(0, 300, 0, 0)],
    ])
    const to = new Map([
      ['a', box(1500, 140)],
      ['scrolled-away', box(1500, 200)],
      ['folded', box(1500, 260)],
      ['only-here', box(1500, 320)],
      ['below', box(1500, 1300)],
    ])
    expect(slides(from, to, room).map((m) => m.id)).toEqual(['a'])
    // and one that is already where it belongs
    expect(slides(new Map([['a', box(10, 10)]]), new Map([['a', box(10, 10.4)]]), room)).toEqual([])
  })

  test('no more move than a window shows of a roster', () => {
    const many = (left: number) => new Map(Array.from({ length: MOST_MOVED + 20 }, (_, i) => [`s${i}`, box(left, i * 10, 400, 9)] as const))
    expect(slides(many(0), many(900), room).length).toBe(MOST_MOVED)
  })

  test('an entry is a session’s first in the roster, or its card on a line of Score, and nothing else that carries its id', () => {
    const page = document.createElement('div')
    // the instruments and a panel carry a session's id too, and are not entries
    page.innerHTML = `
      <aside data-instruments data-session="a"></aside>
      <nav data-roster><b id="first" data-session="a"></b><b data-session="a"></b><b data-session="b"></b></nav>
      <div data-score-row="c"><i data-session="c"></i></div>
      <div data-changes data-session="d"></div>`
    const found = entriesOf(page)
    expect([...found.keys()]).toEqual(['a', 'b', 'c'])
    expect(found.get('a')!.id).toBe('first')
    expect(found.get('c')!.closest('[data-score-row]')).not.toBeNull()
  })

  test('the entries slide, and the two views stay where they are', async () => {
    vi.useFakeTimers()
    await draw()
    await act(async () => motionStore.setState({ reduced: false }))
    // the roster's entries down the left, Score's cards down the right: what a layout would say
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) })
    const moved: { id: string; from: string }[] = []
    const real = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.dataset.layer) return rect(0, 0, 2000, 1000)
      const id = this.dataset.session
      const at = id ? order.findIndex((s) => s.id === id) : -1
      if (at < 0) return rect(0, 0, 0, 0)
      return this.closest('[data-roster]') ? rect(0, 40 * at, 500, 36) : rect(1500, 50 * at, 400, 44)
    }
    ;(HTMLElement.prototype as { animate?: unknown }).animate = function (this: HTMLElement, frames: Keyframe[]) {
      moved.push({ id: this.dataset.session!, from: String(frames[0].transform) })
      return {}
    }
    try {
      await act(async () => go({ view: 'score' }))
    } finally {
      HTMLElement.prototype.getBoundingClientRect = real
      delete (HTMLElement.prototype as { animate?: unknown }).animate
    }
    const [out, into] = [host.querySelector<HTMLElement>('[data-layer="console"]')!, host.querySelector<HTMLElement>('[data-layer="score"]')!]
    expect([out.style.getPropertyValue('--frame-to'), into.style.getPropertyValue('--frame-from')]).toEqual(['none', 'none'])
    // every session, from its place in the roster to its place in Score
    expect(moved.map((m) => m.id)).toEqual(order.map((s) => s.id))
    expect(moved[0].from).toBe('translate(-1500.0px, 0.0px)')
    expect(moved[2].from).toBe('translate(-1500.0px, -20.0px)')
    // only Score's own cards were set going
    expect(moved.length).toBe(order.length)
  })
})

describe('the boot sequence, in the frame', () => {
  test('a launch on Orbit plays the clip over the views, and the frame says so to its views', async () => {
    motionStore.setState({ reduced: false })
    await draw({ view: 'orbit', session: null })
    expect(frame().dataset.boot).toBe('playing')
    expect(host.querySelector('.frame-main [data-frame-boot]')).not.toBeNull()
    // what waits is in the top bar all along
    expect(at('waiting')).not.toBeNull()
  })

  test('a launch that returns to Console plays none', async () => {
    motionStore.setState({ reduced: false })
    await draw()
    expect(frame().dataset.boot).toBeUndefined()
    expect(host.querySelector('[data-frame-boot]')).toBeNull()
  })

  test('with motion reduced it plays none', async () => {
    await draw({ view: 'orbit', session: null })
    expect(frame().dataset.boot).toBeUndefined()
  })

  test('a key ends it, does what it does, and the clip is gone when its last frame has faded', async () => {
    vi.useFakeTimers()
    motionStore.setState({ reduced: false })
    await draw({ view: 'orbit', session: order[0].id })
    await key(document.body, 'c')
    expect(route().view).toBe('console')
    expect(frame().dataset.boot).toBe('leaving')
    await act(async () => void vi.advanceTimersByTime(LEAVE_MS))
    expect(frame().dataset.boot).toBeUndefined()
    expect(host.querySelector('[data-frame-boot]')).toBeNull()
  })
})

describe('Alt on its own', () => {
  const alt = (type: 'keydown' | 'keyup', key = 'Alt') => new KeyboardEvent(type, { key, bubbles: true, cancelable: true })

  test('is said to be taken, down and up, so Windows does not put the window in its menu mode', async () => {
    await draw()
    const term = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    const [down, up] = [alt('keydown'), alt('keyup')]
    await act(async () => void term.dispatchEvent(down))
    await act(async () => void term.dispatchEvent(up))
    expect([down.defaultPrevented, up.defaultPrevented]).toEqual([true, true])
  })

  test('and nothing else is done with it: the release still reaches whoever listens, and no other key is touched', async () => {
    await draw()
    const heard: string[] = []
    const hear = (e: KeyboardEvent) => void heard.push(`${e.type} ${e.key}`)
    window.addEventListener('keyup', hear)
    const shift = alt('keyup', 'Shift')
    await act(async () => void document.body.dispatchEvent(alt('keyup')))
    await act(async () => void document.body.dispatchEvent(shift))
    window.removeEventListener('keyup', hear)
    expect(heard).toEqual(['keyup Alt', 'keyup Shift'])
    expect(shift.defaultPrevented).toBe(false)
    expect(route()).toMatchObject({ view: 'console', session: order[0].id })
  })

  test('once the frame is gone the key is nobody’s again', async () => {
    await draw()
    await act(async () => root.unmount())
    const up = alt('keyup')
    document.body.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(false)
    root = createRoot(host)
  })

  test('Alt+Space is not one of the fleet’s keys, from a terminal or anywhere: it stays dictation’s', async () => {
    await draw()
    const term = host.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')!
    expect(await key(term, ' ', { altKey: true, code: 'Space' })).toBe(true)
    expect(await key(document.body, ' ', { altKey: true, code: 'Space' })).toBe(true)
    expect(route()).toMatchObject({ view: 'console', session: order[0].id, wide: false, command: false })
  })
})

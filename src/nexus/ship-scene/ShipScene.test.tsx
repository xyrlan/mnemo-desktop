import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ShipScene } from '../ShipScene'
import { SHIP_SPRITES, SPRITES } from '../sprites'
import type { LogEvent, Ship, ShipAction, ShipSceneProps } from '../ship-types'
import { captain, deck, dock, mission, pr, ROOT, robot, ship } from './fixtures'
import { CONFIRM_MS } from './Bridge'
import { TURN_MS } from './voices'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A fleet: one deck with a working, an idle, a finished and a stranded robot, a quiet captain and
 *  a dock; on the bridge a question, a ready PR and a stranded child. */
function fleet(): Ship {
  const ask = robot('408', { state: 'need', zone: 'bridge', need: { kind: 'question', text: 'Move it to tools/, or delete the tests?', options: ['move it to tools/', 'delete the tests'] } })
  const done = robot('360', { state: 'done', zone: 'hangar', pr: pr(382), ci: 'green', action: null })
  const stuck = robot('370', { state: 'idle', zone: 'stranded', idleMs: 23 * 60_000, action: null })
  return ship({
    bridge: {
      exceptions: [
        { kind: 'need', robotId: '408', need: ask.need! },
        { kind: 'ready', robotId: '360', pr: pr(382), waitingMs: 48 * 60_000 },
        { kind: 'stranded', robotId: '370', idleMs: 23 * 60_000 },
      ],
      blocked: [ask],
    },
    decks: [
      deck({
        captains: [captain('cap-1', { notices: 2 }), captain('orphan:/home/dev/mnemo-desktop', { pose: 'empty', parent: null, emblem: '?', name: 'no parent' })],
        quiet: [captain('cap-q', { pose: 'idle', name: 'mnemo-7a', emblem: '▲' })],
        flight: [robot('359', { action: 'run' }), robot('365', { state: 'idle', action: null, line: 'still watching CI', act: 'idle for 8 min' })],
        hangar: [done],
        stranded: [stuck],
        hangarReady: true,
      }),
    ],
    docks: [dock('mnemo', [captain('cap-d', { pose: 'idle', name: 'mnemo-18', emblem: '●' })])],
    counts: { working: 1, need: 1, ready: 1 },
    rate: { callsPerMin: 4, outPerMin: 2_000, inPerMin: 900_000, cacheShare: 0.9 },
  })
}

let root: Root | null = null
let host: HTMLElement
const calls: { open: string[]; select: string[]; action: ShipAction[]; triage: number } = { open: [], select: [], action: [], triage: 0 }

function draw(over: Partial<ShipSceneProps> = {}) {
  const props: ShipSceneProps = {
    ship: fleet(),
    log: [],
    focusId: null,
    selection: new Set(),
    onOpen: (id) => void calls.open.push(id),
    onSelect: (id) => void calls.select.push(id),
    onAction: (a) => void calls.action.push(a),
    onTriage: () => void calls.triage++,
    bridge: (
      <div data-fleet-prompt="">
        <input />
      </div>
    ),
    reducedMotion: false,
    visible: true,
    ...over,
  }
  return act(async () => {
    if (!root) {
      host = document.body.appendChild(document.createElement('div'))
      root = createRoot(host)
    }
    root.render(<ShipScene {...props} />)
  })
}

beforeEach(() => {
  calls.open = []
  calls.select = []
  calls.action = []
  calls.triage = 0
})
/** `navigator.platform`, for ⌥1–9 (macOS only). */
const platform = (p: string) => Object.defineProperty(navigator, 'platform', { value: p, configurable: true })

afterEach(async () => {
  delete (navigator as { platform?: string }).platform
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

const $ = (sel: string) => host.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const robotEl = (id: string) => $(`.ship-robot[data-ship-id="${id}"]`)
const click = (el: Element | null, init: MouseEventInit = {}) => act(async () => void el!.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))
const hover = (el: Element | null) => act(async () => void el!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
const fire = (el: Element, type: 'animationend' | 'transitionend', name: string) =>
  act(async () => {
    const e = new Event(type, { bubbles: true })
    Object.defineProperty(e, type === 'animationend' ? 'animationName' : 'propertyName', { value: name })
    el.dispatchEvent(e)
  })

test('the top bar counts as chips; the need chip triages, and rests when nothing needs you', async () => {
  await draw()
  expect($('[data-chip="working"]')!.textContent).toBe('⚙ 1 working')
  expect($('[data-chip="ready"]')!.textContent).toBe('✓ 1 ready')
  expect($('[data-chip="rate"]')!.textContent).toBe('⚡ 4 calls/min · 2k out tok/min')
  expect($('[data-chip="rate"]')!.title).toContain('90% read from cache')
  await click($('[data-chip="need"]'))
  expect(calls.triage).toBe(1)
  await draw({ ship: { ...fleet(), counts: { working: 0, need: 0, ready: 0 } } })
  expect($('[data-chip="need"]')!.hasAttribute('data-zero')).toBe(true)
  expect(($('[data-chip="need"]') as HTMLButtonElement).disabled).toBe(true)
})

test('the bridge holds the fleet prompt, a row per exception labelled ⌥N on macOS, and is red while a question waits', async () => {
  platform('MacIntel')
  await draw()
  const bridge = $('.ship-bridge')!
  expect(bridge.dataset.tone).toBe('red')
  expect(bridge.querySelector('[data-fleet-prompt] input')).not.toBeNull()
  expect($('.ship-bstatus')!.textContent).toBe('3 things wait for you')
  const rows = $$('.ship-xrow')
  expect(rows.map((r) => r.querySelector('.ship-xn')!.textContent)).toEqual(['⌥1', '⌥2', '⌥3'])
  expect(rows.map((r) => r.dataset.kind)).toEqual(['need', 'ready', 'stranded'])
  expect(rows[1].querySelector('.ship-xt')!.textContent).toBe('PR #382 · CI green · waiting 48 min')
  expect(rows[1].querySelector('.ship-xtag')!.textContent).toBe('◆ #360')
  await draw({ ship: ship() })
  expect($('.ship-bridge')!.dataset.tone).toBe('calm')
  expect($('.ship-bstatus')!.textContent).toBe('nothing needs you — the fleet flies itself')
  expect($('.ship-exceptions')).toBeNull()
})

test('off macOS the rows carry no ⌥N: Alt+digit is the workbench’s', async () => {
  platform('Win32')
  await draw()
  expect($$('.ship-xrow')).toHaveLength(3)
  expect($('.ship-xn')).toBeNull()
})

test('a row’s buttons settle it, merge and stop on a second press; the row itself opens its robot', async () => {
  await draw()
  const [need, ready, stranded] = $$('.ship-xrow')
  await click(need.querySelector('[data-x="answer · Tab"]'))
  expect(calls.triage).toBe(1)
  await click(ready.querySelector('[data-x="merge"]'))
  expect(calls.action).toEqual([])
  expect(ready.querySelector('[data-x="merge"]')!.textContent).toBe('confirm merge?')
  await click(ready.querySelector('[data-x="merge"]'))
  expect(calls.action).toEqual([{ kind: 'merge', robotIds: ['360'] }])
  await click(stranded.querySelector('[data-x="stop"]'))
  expect(stranded.querySelector('[data-x="stop"]')!.textContent).toBe('confirm stop?')
  await click(stranded.querySelector('[data-x="stop"]'))
  expect(calls.action[1]).toEqual({ kind: 'stop', robotIds: ['370'] })
  expect(calls.open).toEqual([])
  await click(ready.querySelector('[data-x="open"]'))
  await click(stranded.querySelector('.ship-xt'))
  expect(calls.open).toEqual(['360', '370'])
})

test('a landable mission gets a row that lands it', async () => {
  await draw({ ship: ship({ bridge: { exceptions: [{ kind: 'land', root: ROOT, mission: mission('nexus-v2', 5, 5) }], blocked: [] } }) })
  expect($('.ship-bridge')!.dataset.tone).toBe('lilac')
  expect($('.ship-xt')!.textContent).toBe('mission nexus-v2 · 5/5 green → land')
  await click($('[data-x="land"]'))
  expect(calls.action).toEqual([])
  await click($('[data-x="land"]'))
  expect(calls.action).toEqual([{ kind: 'land', root: ROOT, feature: 'nexus-v2' }])
  expect(calls.open).toEqual([])
})

test('merge all green asks for a second click, and forgets after a while', async () => {
  vi.useFakeTimers()
  const ready = (id: string, n: number) => ({ kind: 'ready' as const, robotId: id, pr: pr(n), waitingMs: 60_000 })
  await draw({ ship: ship({ bridge: { exceptions: [ready('1', 11), ready('2', 12)], blocked: [] } }) })
  const all = () => $('[data-x="merge-all"]')!
  expect(all().textContent).toBe('✈ merge all green (2)')
  await click(all())
  expect(all().textContent).toBe('confirm merge of 2?')
  expect(calls.action).toEqual([])
  await act(async () => void vi.advanceTimersByTime(CONFIRM_MS))
  expect(all().textContent).toBe('✈ merge all green (2)')
  await click(all())
  await click(all())
  expect(calls.action).toEqual([{ kind: 'merge', robotIds: ['1', '2'] }])
  // What is merged is what was ready when it was armed, not what is ready at the second press.
  await click(all())
  await draw({ ship: ship({ bridge: { exceptions: [ready('1', 11), ready('2', 12), ready('3', 13)], blocked: [] } }) })
  await click(all())
  expect(calls.action[1]).toEqual({ kind: 'merge', robotIds: ['1', '2'] })
})

test('past two blocked robots the bridge counts the rest and sends you to triage', async () => {
  const blocked = ['a', 'b', 'c', 'd'].map((id) => robot(id, { state: 'need', zone: 'bridge', need: { kind: 'question', text: `${id}?`, options: ['yes'] } }))
  await draw({ ship: ship({ bridge: { exceptions: [], blocked }, counts: { working: 0, need: 4, ready: 0 } }) })
  expect($$('[data-blocked]').map((b) => b.dataset.blocked)).toEqual(['a', 'b'])
  expect($('.ship-more-blocked')!.textContent).toBe('+2 blocked · triage')
  await click($('.ship-more-blocked'))
  expect(calls.triage).toBe(1)
})

test('a blocked robot stands on the bridge with its question, answered in place', async () => {
  await draw()
  const blocked = $('[data-blocked="408"]')!
  expect(blocked.closest('.ship-bridge')).not.toBeNull()
  expect(blocked.querySelector('.ship-q')!.textContent).toBe('❓ Move it to tools/, or delete the tests?')
  expect(blocked.querySelector('.ship-robot[data-state="need"]')).not.toBeNull()
  await click([...blocked.querySelectorAll('.ship-opts button')][1])
  expect(calls.action).toEqual([{ kind: 'answer', robotId: '408', text: 'delete the tests' }])
  const input = blocked.querySelector('input')!
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, 'keep both')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => void blocked.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(calls.action[1]).toEqual({ kind: 'answer', robotId: '408', text: 'keep both' })
  await click(blocked.querySelector('.ship-link'))
  expect(calls.open).toEqual(['408'])
})

test('a permission is answered with yes, always or no, and has no free text', async () => {
  const perm = robot('9', { state: 'need', zone: 'bridge', need: { kind: 'permission', text: 'Bash · git push', options: ['yes', 'always', 'no'] } })
  await draw({ ship: ship({ bridge: { exceptions: [{ kind: 'need', robotId: '9', need: perm.need! }], blocked: [perm] } }) })
  expect($('.ship-q')!.textContent).toBe('🔒 wants to run: Bash · git push')
  expect($$('.ship-opts button').map((b) => b.textContent)).toEqual(['yes', 'always', 'no'])
  expect($('.ship-need form')).toBeNull()
})

test('a deck draws captains at their consoles, rooms lit by who stands in them, the hangar glowing', async () => {
  await draw()
  const d = $('[data-deck="/home/dev/mnemo-desktop"]')!
  expect(d.querySelector('.ship-dlabel')!.textContent).toBe('mnemo-desktop')
  const cap = d.querySelector<HTMLElement>('.ship-captain[data-ship-id="cap-1"]')!
  expect(cap.querySelector('img')!.getAttribute('src')).toBe(SHIP_SPRITES.captain.busy.src)
  expect(cap.querySelector('.ship-mail')!.textContent).toBe('✉ 2')
  expect(cap.querySelector('.ship-topic')!.textContent).toBe('“tidy the docs”')
  expect(cap.querySelector('.ship-pact')!.textContent).toBe('Bash · pnpm test')
  const chair = d.querySelector<HTMLElement>('.ship-captain[data-pose="empty"]')!
  expect(chair.querySelector('img')!.getAttribute('src')).toBe(SHIP_SPRITES.chair.src)
  expect(chair.querySelector('.ship-topic')!.textContent).toBe('children with no recorded parent')
  expect(d.querySelector('.ship-quiet [data-ship-id="cap-q"]')!.textContent).toContain('mnemo-7a')
  const rooms = Object.fromEntries([...d.querySelectorAll<HTMLElement>('.ship-room')].map((r) => [r.dataset.zone, r]))
  for (const z of ['flight', 'hangar', 'stranded']) expect(rooms[z].hasAttribute('data-lit')).toBe(true)
  expect(rooms.hangar.hasAttribute('data-ready')).toBe(true)
  expect(robotEl('359')!.dataset.zone).toBe('flight')
  expect(robotEl('360')!.dataset.zone).toBe('hangar')
  expect(robotEl('360')!.dataset.ci).toBe('green')
  expect(robotEl('360')!.querySelector('.ship-shuttle')).not.toBeNull()
  expect(robotEl('370')!.querySelector('.ship-ab')!.textContent).toBe('⏸')
  expect(robotEl('359')!.querySelector('.ship-fx')!.getAttribute('data-fx')).toBe('radar')
  const imgs = [...robotEl('359')!.querySelectorAll('img')].map((i) => i.getAttribute('src'))
  expect(imgs).toEqual([SPRITES.accessories[0].src, SPRITES.robots.droid.working.src])
  const empty = deck({ flight: [robot('1')] })
  await draw({ ship: ship({ decks: [empty] }) })
  expect($('.ship-room[data-zone="hangar"]')!.hasAttribute('data-lit')).toBe(false)
})

test('the docks hold repos with only quiet captains; a captain clicked opens', async () => {
  await draw()
  const pod = $('[data-dock="/home/dev/mnemo"]')!
  expect(pod.textContent).toContain('mnemo-18')
  // Drawn whole, at a size that reads: the captain's console, not a sliver of it.
  const docked = pod.querySelector<HTMLElement>('.ship-docked[data-ship-id="cap-d"]')!
  expect(docked.querySelector('img')!.getAttribute('src')).toBe(SHIP_SPRITES.captain.idle.src)
  await click(docked)
  await click($('.ship-captain[data-ship-id="cap-1"]'))
  await click($('.ship-captain[data-pose="empty"]'))
  expect(calls.open).toEqual(['cap-d', 'cap-1'])
})

test('a click opens a robot, shift+click selects it; the selection is dashed', async () => {
  await draw()
  await click(robotEl('359')!.querySelector('.ship-figure'))
  await click(robotEl('365')!.querySelector('.ship-figure'), { shiftKey: true })
  expect(calls.open).toEqual(['359'])
  expect(calls.select).toEqual(['365'])
  await draw({ selection: new Set(['365']) })
  expect(robotEl('365')!.hasAttribute('data-selected')).toBe(true)
  expect(robotEl('359')!.hasAttribute('data-selected')).toBe(false)
})

test('the figure open in the drawer glows and is scrolled into view, by robot, session or captain', async () => {
  const seen: string[] = []
  const was = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) {
    seen.push(this.dataset.shipId ?? '')
  }
  try {
    await draw({ focusId: '359' })
    expect(robotEl('359')!.hasAttribute('data-focus')).toBe(true)
    await draw({ focusId: 's-365' })
    expect(robotEl('365')!.hasAttribute('data-focus')).toBe(true)
    expect(robotEl('359')!.hasAttribute('data-focus')).toBe(false)
    await draw({ focusId: 'cap-1' })
    expect($('.ship-captain[data-ship-id="cap-1"]')!.hasAttribute('data-focus')).toBe(true)
    expect(seen).toEqual(['359', '365', 'cap-1'])
  } finally {
    HTMLElement.prototype.scrollIntoView = was
  }
})

test('hovering a robot shows its full line, model, context, contract, twin and rules, tied to its relations', async () => {
  const a = robot('404a', { label: '#404·a', twin: 'a', contract: { feature: 'nexus-v2', piece: 'scene', consumes: ['ship'] }, injected: ['merge-requires-admin'] })
  const b = robot('404b', { label: '#404·b', twin: 'b' })
  const c = robot('500', { contract: { feature: 'nexus-v2', piece: 'ship', consumes: [] } })
  await draw({ ship: ship({ decks: [deck({ flight: [a, b, c] })] }) })
  await hover(robotEl('404a')!.querySelector('.ship-figure'))
  const card = $('[data-hover="404a"]')!
  expect(card.textContent).toContain('claude-opus-4-1 · context 42k')
  expect(card.textContent).toContain('writes against ship (does not wait)')
  expect(card.textContent).toContain('A/B twin — independent by design')
  expect(card.textContent).toContain('◈ rules: merge-requires-admin')
  expect(
    $$('.ship-tether text')
      .map((t) => t.textContent)
      .sort(),
  ).toEqual(['consumes ship', 'twin'])
  expect($$('.ship-tether [data-tether="crew"]')).toHaveLength(1)
  await act(
    async () =>
      void robotEl('404a')!
        .querySelector('.ship-figure')!
        .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })),
  )
  expect($('[data-hover]')).toBeNull()
})

test('hovering a captain ties it to its crew and dims the rest', async () => {
  const mine = robot('1')
  const theirs = robot('2', { captainId: 'cap-2' })
  await draw({ ship: ship({ decks: [deck({ captains: [captain('cap-1'), captain('cap-2', { emblem: '●' })], flight: [mine, theirs] })] }) })
  await hover($('.ship-captain[data-ship-id="cap-1"]'))
  expect($('.ship-captain[data-ship-id="cap-1"]')!.hasAttribute('data-hl')).toBe(true)
  expect(robotEl('2')!.hasAttribute('data-dim')).toBe(true)
  expect(robotEl('1')!.hasAttribute('data-dim')).toBe(false)
  expect($$('.ship-tether line')).toHaveLength(1)
  expect(robotEl('2')!.querySelector('.ship-tag')!.textContent).toBe('● #2')
})

test('the hangar folds into a stack when it runs out of floor, and unfolds on a click', async () => {
  const hangar = Array.from({ length: 12 }, (_, i) => robot(`h${i}`, { state: 'done', zone: 'hangar', pr: pr(100 + i), ci: i % 2 ? 'green' : 'run', action: null }))
  await draw({ ship: ship({ decks: [deck({ hangar })] }) })
  const stack = $('.ship-stack')!
  expect(stack.textContent).toMatch(/^\+\d+\d+ PRs waiting for merge · \d+ green$/)
  const floor = $$('.ship-robot[data-zone="hangar"]').length
  expect(floor).toBeLessThan(12)
  expect($('.ship-room[data-zone="hangar"] .ship-rcount')!.textContent).toBe('12')
  await click(stack)
  expect($$('.ship-robot[data-zone="hangar"]')).toHaveLength(12)
  expect($('.ship-stack')!.textContent).toContain('fold 12 ready')
})

test('speech: as many bubbles as the room is wide, the rest taking turns', async () => {
  vi.useFakeTimers()
  const flight = Array.from({ length: 6 }, (_, i) => robot(`f${i}`, { line: `line ${i}` }))
  await draw({ ship: ship({ decks: [deck({ flight })] }) })
  const speakers = () => $$('.ship-room ~ .ship-bubble, .ship-bubble:not(.ship-hover)').map((b) => b.dataset.for)
  const first = speakers()
  // jsdom is 1200 wide: in flight is (1200 − 260) × 0.56 ≈ 526 px, two voices.
  expect(first).toEqual(['f0', 'f1'])
  expect($('.ship-bubble[data-for="f0"] .ship-say')!.textContent).toBe('◆ #f0 line 0')
  await act(async () => void vi.advanceTimersByTime(TURN_MS))
  expect(speakers()).not.toEqual(first)
  expect(speakers()).toHaveLength(2)
})

test('with reduced motion nobody takes turns: the voices stay until a line changes', async () => {
  vi.useFakeTimers()
  const flight = Array.from({ length: 6 }, (_, i) => robot(`f${i}`))
  await draw({ ship: ship({ decks: [deck({ flight })] }), reducedMotion: true })
  const before = $$('.ship-bubble').map((b) => b.dataset.for)
  await act(async () => void vi.advanceTimersByTime(5 * TURN_MS))
  expect($$('.ship-bubble').map((b) => b.dataset.for)).toEqual(before)
})

test('a line that changed takes the floor; a clock moving on does not', async () => {
  const flight = (third: string) => [robot('f0'), robot('f1'), robot('f2', { line: '', act: third })]
  await draw({ ship: ship({ decks: [deck({ flight: flight('idle for 6 min') })] }), reducedMotion: true })
  const speakers = () => $$('.ship-bubble').map((b) => b.dataset.for)
  expect(speakers()).toEqual(['f0', 'f1'])
  await draw({ ship: ship({ decks: [deck({ flight: flight('idle for 7 min') })] }), reducedMotion: true })
  expect(speakers()).toEqual(['f0', 'f1'])
  await draw({ ship: ship({ decks: [deck({ flight: flight('Bash · pnpm test') })] }), reducedMotion: true })
  expect(speakers()).toContain('f2')
})

test('a robot that arrives after the first draw beams in on the teleport pad', async () => {
  await draw({ ship: ship({ decks: [deck({ flight: [robot('1')] })] }) })
  expect($$('[data-arriving]')).toHaveLength(0)
  await draw({ ship: ship({ decks: [deck({ flight: [robot('1'), robot('2')] })] }) })
  expect(robotEl('2')!.hasAttribute('data-arriving')).toBe(true)
  const pad = robotEl('2')!.querySelector('.ship-teleport')!
  expect(pad.getAttribute('src')).toBe(SHIP_SPRITES.teleport.src)
  await fire(pad, 'animationend', 'ship-tele')
  expect(robotEl('2')!.hasAttribute('data-arriving')).toBe(false)
  expect(robotEl('2')!.querySelector('.ship-teleport')).toBeNull()
})

test('a robot that changes room walks there, facing where it goes', async () => {
  const r = robot('1', { zone: 'hangar', state: 'done', action: null })
  await draw({ ship: ship({ decks: [deck({ hangar: [r] })] }) })
  const x0 = robotEl('1')!.style.transform
  await draw({ ship: ship({ decks: [deck({ flight: [{ ...r, zone: 'flight', state: 'working', action: 'edit' }] })] }) })
  const el = robotEl('1')!
  expect(el.style.transform).not.toBe(x0)
  expect(el.hasAttribute('data-walking')).toBe(true)
  expect(el.hasAttribute('data-left')).toBe(true)
  await fire(el, 'transitionend', 'transform')
  expect(el.hasAttribute('data-walking')).toBe(false)
  expect(el.hasAttribute('data-left')).toBe(true)
})

test('a robot the log says merged boards its shuttle and launches; a closed one walks off; one gone to the bridge does neither', async () => {
  // As the ship builds them: the robots stand there with an open PR, then are gone in the build
  // their fate turns final; only the log says which merged.
  const open = { state: 'OPEN' as const, mergedAt: null, closedAt: null, checks: [] }
  const merged = robot('m', { state: 'done', zone: 'hangar', pr: pr(1), ci: 'green', fate: open })
  const closed = robot('c', { state: 'done', zone: 'hangar', pr: pr(2), fate: open })
  const climber = robot('b')
  await draw({ ship: ship({ decks: [deck({ flight: [climber], hangar: [merged, closed] })] }) })
  const up = { ...climber, state: 'need' as const, zone: 'bridge' as const, need: { kind: 'question' as const, text: '?', options: [] } }
  const after = ship({ decks: [deck()], bridge: { exceptions: [], blocked: [up] } })
  await draw({ ship: after })
  expect($('[data-leaving="m"]')!.dataset.exit).toBe('walk')
  // The log's milestone lands a moment later (the view appends it after the build).
  const log: LogEvent[] = [{ id: 'merged:m', at: 1, kind: 'merged', robotId: 'm', captainId: 'cap-1', text: 'PR #1 merged' }]
  await draw({ ship: after, log })
  const launch = $('[data-leaving="m"]')!
  expect(launch.dataset.exit).toBe('launch')
  expect(launch.querySelector('img')!.getAttribute('src')).toBe(SHIP_SPRITES.shuttle.launch.src)
  expect($('[data-leaving="c"]')!.dataset.exit).toBe('walk')
  expect($('[data-leaving="b"]')).toBeNull()
  await fire(launch.querySelector('.ship-launch')!, 'animationend', 'ship-launch')
  await fire($('[data-leaving="c"] .ship-walk-off')!, 'animationend', 'ship-walk-off')
  expect($$('[data-leaving]')).toHaveLength(0)
})

test('the last robot of a deck still makes its exit: the deck stays, emptied, until it has left', async () => {
  const merged = robot('m', { state: 'done', zone: 'hangar', pr: pr(1), ci: 'green' })
  await draw({ ship: ship({ decks: [deck({ hangar: [merged] })] }) })
  const log: LogEvent[] = [{ id: 'merged:m', at: 1, kind: 'merged', robotId: 'm', captainId: 'cap-1', text: 'PR #1 merged' }]
  await draw({ ship: ship({ docks: [dock('mnemo-desktop', [captain('cap-1')])] }), log })
  const ghost = $('[data-deck="/home/dev/mnemo-desktop"]')!
  expect(ghost.hasAttribute('data-ghost')).toBe(true)
  expect(ghost.querySelector('[data-leaving="m"]')!.getAttribute('data-exit')).toBe('launch')
  expect($('.ship-robot')).toBeNull()
  await fire(ghost.querySelector('.ship-launch')!, 'animationend', 'ship-launch')
  expect($('[data-deck]')).toBeNull()
})

test('a deck that leaves while motion is reduced simply goes', async () => {
  await draw({ ship: ship({ decks: [deck({ hangar: [robot('m', { state: 'done', zone: 'hangar' })] })] }), reducedMotion: true })
  await draw({ ship: ship(), reducedMotion: true })
  expect($('[data-deck]')).toBeNull()
})

test('a relayout (the window or the drawer resized) moves robots without walking', async () => {
  let width = 1400
  let observed: (() => void) | null = null
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => width })
  const RO = globalThis.ResizeObserver
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      observed = cb
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  try {
    await draw({ ship: ship({ decks: [deck({ flight: [robot('1'), robot('2')], stranded: [robot('3', { state: 'idle', zone: 'stranded' })] })] }) })
    const x0 = robotEl('3')!.style.transform
    width = 1000
    await act(async () => observed!())
    expect(robotEl('3')!.style.transform).not.toBe(x0)
    expect($$('[data-walking]')).toHaveLength(0)
    expect(robotEl('3')!.hasAttribute('data-still')).toBe(true)
  } finally {
    Object.defineProperty(Element.prototype, 'clientWidth', desc)
    globalThis.ResizeObserver = RO
  }
})

test('with reduced motion nothing beams in, walks, launches or walks off', async () => {
  const r = robot('1', { state: 'done', zone: 'hangar', pr: pr(1), fate: { state: 'MERGED', mergedAt: 1, closedAt: null, checks: [] } })
  await draw({ ship: ship({ decks: [deck({ hangar: [r] })] }), reducedMotion: true })
  await draw({ ship: ship({ decks: [deck({ flight: [{ ...r, zone: 'flight' }, robot('2')] })] }), reducedMotion: true })
  expect($$('[data-arriving]')).toHaveLength(0)
  expect($$('[data-walking]')).toHaveLength(0)
  await draw({ ship: ship({ decks: [deck()] }), reducedMotion: true })
  expect($$('[data-leaving]')).toHaveLength(0)
})

test('◈ flashes when mnemo injects a new rule, not for the rules it had when the ship was drawn', async () => {
  await draw({ ship: ship({ decks: [deck({ flight: [robot('1', { injected: ['old-rule'] })] })] }) })
  expect($('.ship-rule')).toBeNull()
  await draw({ ship: ship({ decks: [deck({ flight: [robot('1', { injected: ['new-rule', 'old-rule'] })] })] }) })
  const mark = $('.ship-rule')!
  expect(mark.textContent).toBe('◈')
  expect(mark.title).toBe('new-rule')
  await fire(mark, 'animationend', 'ship-rule')
  expect($('.ship-rule')).toBeNull()
})

test('the ship’s log: a ticker of the newest milestone that opens into the list, newest first; a row opens its robot', async () => {
  const log: LogEvent[] = [
    { id: 'e1', at: new Date(2026, 9, 15, 14, 2).getTime(), kind: 'dispatched', robotId: '359', captainId: 'cap-1', text: 'dispatched' },
    { id: 'e2', at: new Date(2026, 9, 15, 14, 16).getTime(), kind: 'ci-green', robotId: '360', captainId: 'cap-1', text: 'CI green' },
    { id: 'e3', at: new Date(2026, 9, 15, 14, 20).getTime(), kind: 'you', robotId: null, captainId: null, text: 'you merged 2 PRs' },
  ]
  await draw({ log })
  expect($('.ship-tick')!.textContent).toBe('14:20 ↩  you merged 2 PRs')
  expect($('.ship-log-list')).toBeNull()
  await click($('.ship-log-head'))
  const rows = $$('.ship-log-list button')
  expect(rows.map((r) => r.dataset.ev)).toEqual(['e3', 'e2', 'e1'])
  expect(rows[1].textContent).toBe('14:16✓◆ #360 CI green')
  expect(rows[1].dataset.tone).toBe('ok')
  expect((rows[0] as HTMLButtonElement).disabled).toBe(true)
  await click(rows[1])
  expect(calls.open).toEqual(['360'])
  await draw({ log: [] })
  expect($('.ship-tick')!.textContent).toBe('no milestones yet')
})

test('an empty fleet says so', async () => {
  await draw({ ship: ship() })
  expect($('.ship-empty')!.textContent).toBe('No live sessions.')
  expect($('.ship-colhead')).toBeNull()
})

test('reduced motion and a hidden window are marked on the scene for its stylesheet', async () => {
  await draw()
  expect($('[data-ship-scene]')!.hasAttribute('data-reduced')).toBe(false)
  expect($('[data-ship-scene]')!.hasAttribute('data-paused')).toBe(false)
  await draw({ reducedMotion: true, visible: false })
  expect($('[data-ship-scene]')!.hasAttribute('data-reduced')).toBe(true)
  expect($('[data-ship-scene]')!.hasAttribute('data-paused')).toBe(true)
})

type Fs = { readFileSync(path: string, encoding: string): string }

/** ship.css as rules: `[selector, body]`, keyframes left out. */
async function rules(): Promise<Array<[string, string]>> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const css = fs
    .readFileSync('src/nexus/ship.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '')
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
}

test('the stylesheet: nothing walks, flies or loops with reduced motion, all of it pauses while hidden, pixels stay sharp', async () => {
  const all = await rules()
  const animated = all.filter(([, body]) => /\banimation\s*:(?!\s*none)/.test(body) || /\btransition\s*:\s*transform/.test(body))
  expect(animated.length).toBeGreaterThan(20)
  for (const [sel, body] of animated) {
    if (/ship-hold\b/.test(body)) {
      expect(sel).toBe('.ship-scene[data-reduced] .ship-rule')
      continue
    }
    for (const one of sel.split(',')) expect(one.trim()).toMatch(/^\.ship-scene:not\(\[data-reduced\]\) /)
  }
  const paused = all.find(([sel]) => sel.includes('[data-paused]'))!
  expect(paused[0]).toContain('.ship-scene[data-paused] *')
  expect(paused[1]).toMatch(/animation-play-state:\s*paused\s*!important/)
  expect(all.find(([sel]) => sel === '.ship-px')![1]).toMatch(/image-rendering:\s*pixelated/)
  // Colour means state only: the app's four state tokens.
  const root = all.find(([sel]) => sel === '.ship-scene')![1]
  for (const s of ['working', 'needs-you', 'done', 'idle']) expect(root).toContain(`var(--state-${s})`)
})

test('a captain waiting on you has a row, ⌥N and an open button, tagged with its emblem and name', async () => {
  platform('MacIntel')
  const f = fleet()
  const waiting = { kind: 'captain' as const, captainId: 'cap-d', waitsOn: 'permission' as const, question: null, since: null, lines: [] }
  await draw({ ship: { ...f, bridge: { ...f.bridge, exceptions: [waiting, ...f.bridge.exceptions] }, counts: { ...f.counts, need: 2 } } })
  const rows = $$('.ship-xrow')
  expect(rows.map((r) => r.dataset.kind)).toEqual(['captain', 'need', 'ready', 'stranded'])
  expect(rows[0].querySelector('.ship-xn')!.textContent).toBe('⌥1')
  expect(rows[0].querySelector('.ship-xtag')!.textContent).toBe('● mnemo-18')
  expect(rows[0].querySelector('.ship-xt')!.textContent).toBe('waits on a permission')
  await click(rows[0].querySelector('[data-x="open"]'))
  await click(rows[0].querySelector('.ship-xt'))
  expect(calls.open).toEqual(['cap-d', 'cap-d'])
  expect(calls.action).toEqual([])
  expect($('.ship-bridge')!.dataset.tone).toBe('red')
})

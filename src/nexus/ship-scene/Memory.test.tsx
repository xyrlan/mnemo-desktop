import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Pulse } from '../../pulse/store'
import type { PulseEvent, PulseKind } from '../../pulse/types'
import { ShipScene } from '../ShipScene'
import { SHIP_SPRITES } from '../sprites'
import type { Ship, ShipSceneProps } from '../ship-types'
import { closeWindow, registerWindow, windowStore } from '../ui/windows'
import { repoChoice } from '../windows/memory/repo'
import { captain, deck, dock, ROOT, robot, ship } from './fixtures'
import { LEDS } from './packets'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** One deck (a captain, two robots in flight) and a dock with one captain. */
function fleet(): Ship {
  return ship({
    decks: [deck({ captains: [captain('cap-1')], flight: [robot('359'), robot('365')] })],
    docks: [dock('mnemo', [captain('cap-d', { pose: 'idle', name: 'mnemo-18', emblem: '●' })])],
  })
}

let root: Root | null = null
let host: HTMLElement
let pulses: Pulse[] = []
let nextId = 1

function draw(over: Partial<ShipSceneProps> = {}) {
  const props: ShipSceneProps = {
    ship: fleet(),
    log: [],
    focusId: null,
    selection: new Set(),
    onOpen: () => {},
    onSelect: () => {},
    onAction: () => {},
    onTriage: () => {},
    onCommand: () => {},
    onMenu: () => {},
    command: null,
    reducedMotion: false,
    visible: true,
    pulses,
    level: { level: 7, into: 40, fraction: 0.4 },
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

/** `event` arrives: the store's log gains it, and the scene is drawn again. */
function arrive(kind: PulseKind, over: Partial<PulseEvent> = {}, props: Partial<ShipSceneProps> = {}) {
  pulses = [...pulses, { id: nextId++, event: { at: Date.now(), kind, project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: [], ...over }, received: Date.now() }]
  return draw(props)
}

beforeEach(() => {
  pulses = []
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
  closeWindow()
  vi.useRealTimers()
})

const $ = (sel: string) => host.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const robotEl = (id: string) => $(`.ship-robot[data-ship-id="${id}"]`)!
const count = (el: Element) => el.querySelector<HTMLElement>('.ship-rc')?.dataset.rules ?? null
const landed = (el: Element) =>
  act(async () => {
    const e = new Event('animationend', { bubbles: true })
    Object.defineProperty(e, 'animationName', { value: 'ship-pk-x' })
    el.dispatchEvent(e)
  })

test('each deck and each dock pod shows its archive: the tower at 1×, its five LEDs, then the vault’s LV', async () => {
  await draw()
  const onDeck = $(`[data-deck="${ROOT}"] .ship-dlabel [data-archive]`)!
  const onDock = $('[data-dock="/home/dev/mnemo"] [data-archive]')!
  for (const a of [onDeck, onDock]) {
    const img = a.querySelector('img')!
    expect(img.getAttribute('src')).toBe(SHIP_SPRITES.archive.src)
    expect(img.classList.contains('ship-px')).toBe(true)
    expect([...a.querySelectorAll<HTMLElement>('.ship-tower i')].map((i) => [i.style.left, i.style.top])).toEqual(LEDS.map(([x, y]) => [`${x}px`, `${y}px`]))
    expect(a.querySelector('.ship-lv')!.textContent).toBe('LV7')
  }
  // The name comes first, the tower right after it.
  expect($('.ship-dlabel')!.firstElementChild!.textContent).toBe('mnemo-desktop')
  await draw({ level: null })
  expect($$('.ship-lv')).toEqual([])
  expect($$('[data-archive]')).toHaveLength(2)
})

test('a click on the tower opens the Memory window on that repo', async () => {
  const off = registerWindow({ id: 'memory', title: 'Memory', render: () => null })
  await draw()
  await act(async () => void $('[data-dock="/home/dev/mnemo"] [data-archive]')!.click())
  expect(windowStore.getState().open?.id).toBe('memory')
  expect(repoChoice.getState().root).toBe('/home/dev/mnemo')
  await act(async () => void $(`[data-deck="${ROOT}"] [data-archive]`)!.click())
  expect(repoChoice.getState().root).toBe(ROOT)
  off()
})

test('what was logged before the ship was drawn flies nothing, though the counts include it', async () => {
  pulses = [{ id: nextId++, event: { at: 0, kind: 'reflex', project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: ['a', 'b'], session_id: 's-359' }, received: 0 }]
  await draw()
  expect($$('.ship-pk')).toEqual([])
  expect(count(robotEl('359'))).toBe('2')
  expect(count(robotEl('365'))).toBeNull()
})

test('a reflex flies from the archive to its robot; the count and the floating slug wait for it to land', async () => {
  await draw()
  await arrive('reflex', { session_id: 's-359', slugs: ['merge-requires-admin'] })
  const pk = $('.ship-pk')!
  expect(pk.dataset).toMatchObject({ packet: 'reflex', dir: 'out', sessionTo: 's-359' })
  expect(count(robotEl('359'))).toBeNull()
  await landed(pk)
  expect($$('.ship-pk')).toEqual([])
  expect(count(robotEl('359'))).toBe('1')
  expect(robotEl('359').querySelector('.ship-rc')!.getAttribute('title')).toContain('merge-requires-admin')
  expect($('.ship-pk-say')!.textContent).toBe('merge-requires-admin')
})

test('Q23: a second event for the robot within 5 s joins the packet in flight, marked ×2', async () => {
  await draw()
  await arrive('reflex', { session_id: 's-359', slugs: ['a'] })
  await arrive('reflex', { session_id: 's-359', slugs: ['b'] })
  expect($$('.ship-pk')).toHaveLength(1)
  expect($('.ship-pk-n')!.textContent).toBe('×2')
  await landed($('.ship-pk')!)
  expect(count(robotEl('359'))).toBe('2')
  expect($('.ship-pk-say')!.textContent).toBe('×2 2 rules')
})

test('reduced motion: nothing flies; the count changes at once and the archive glows for what comes in', async () => {
  await draw({ reducedMotion: true })
  await arrive('reflex', { session_id: 's-359', slugs: ['a'] }, { reducedMotion: true })
  expect($$('.ship-pk')).toEqual([])
  expect(count(robotEl('359'))).toBe('1')
  expect($$('.ship-pk-say')).toEqual([])
  await arrive('friction', { session_id: 's-359' }, { reducedMotion: true })
  expect($$('.ship-pk')).toEqual([])
  expect($(`[data-deck="${ROOT}"] [data-archive]`)!.dataset.glow).toBe('short')
  await arrive('enforce', { session_id: 's-359', slugs: ['x'] }, { reducedMotion: true })
  expect(robotEl('359').hasAttribute('data-shake')).toBe(false)
})

test('while the window is hidden nothing flies, and what was flying lands at once', async () => {
  await draw()
  await arrive('reflex', { session_id: 's-359', slugs: ['a'] })
  expect($$('.ship-pk')).toHaveLength(1)
  await draw({ visible: false })
  expect($$('.ship-pk')).toEqual([])
  expect(count(robotEl('359'))).toBe('1')
  await arrive('reflex', { session_id: 's-365', slugs: ['b'] }, { visible: false })
  expect($$('.ship-pk')).toEqual([])
  expect(count(robotEl('365'))).toBe('1')
})

test('an MCP read goes to the archive asking, the archive glows, and it comes back with the rules read', async () => {
  await draw()
  await arrive('tool', { session_id: 's-365', tool: 'list_rules_by_topic', slugs: ['a', 'b'] })
  const ask = $('.ship-pk')!
  await landed(ask)
  expect($(`[data-deck="${ROOT}"] [data-archive]`)!.dataset.glow).toBe('short')
  expect(count(robotEl('365'))).toBeNull()
  const back = $('.ship-pk')!
  expect(back).not.toBe(ask)
  await landed(back)
  expect(count(robotEl('365'))).toBe('2')
})

test('enforcement flies the white guard fast, and the robot shakes as it lands', async () => {
  vi.useFakeTimers()
  await draw()
  await arrive('enforce', { session_id: 's-359', tool: 'git push --force', slugs: ['never-force-push-main'] })
  const pk = $('.ship-pk')!
  expect(pk.dataset.dir).toBe('guard')
  expect(pk.style.getPropertyValue('--ms')).toBe('700ms')
  await landed(pk)
  expect(robotEl('359').hasAttribute('data-shake')).toBe(true)
  await act(async () => void vi.advanceTimersByTime(500))
  expect(robotEl('359').hasAttribute('data-shake')).toBe(false)
})

test('captains get packets too, on a deck and in a dock; an event with no session flies nothing', async () => {
  await draw()
  await arrive('briefing', { session_id: 'cap-d', project: 'mnemo', agent: 'mnemo' })
  await arrive('reflex', { session_id: 'cap-1', slugs: ['a'] })
  await arrive('reflex', { slugs: ['b'] })
  await arrive('reflex', { session_id: 's-elsewhere', slugs: ['c'] })
  expect($$('.ship-pk').map((p) => [p.dataset.packet, p.dataset.dir, p.dataset.sessionTo])).toEqual([
    ['briefing', 'in', 'cap-d'],
    ['reflex', 'out', 'cap-1'],
  ])
  await landed($('.ship-pk[data-session-to="cap-1"]')!)
  expect(count($('.ship-captain[data-ship-id="cap-1"]')!)).toBe('1')
})

test('an enrichment flies to the robot whose worktree holds the file it touched', async () => {
  await draw()
  await arrive('enrich', { tool: 'Edit', file_path: `${ROOT}-wt-365/src/a.ts`, slugs: ['a-rule'] })
  expect($('.ship-pk')!.dataset).toMatchObject({ packet: 'enrich', dir: 'out', sessionTo: 's-365' })
})

test('learned flies nothing: the archive of its repo glows longer', async () => {
  await draw()
  await arrive('learned', { slugs: ['new-rule'] })
  expect($$('.ship-pk')).toEqual([])
  expect($(`[data-deck="${ROOT}"] [data-archive]`)!.dataset.glow).toBe('long')
  expect($('[data-dock="/home/dev/mnemo"] [data-archive]')!.dataset.glow).toBeUndefined()
})

test('a click on a packet in flight opens its card: its kind and its rules; Esc closes it', async () => {
  await draw()
  await arrive('reflex', { session_id: 's-359', slugs: ['merge-requires-admin', 'prove-the-result-first'] })
  await act(async () => void $('.ship-pk')!.click())
  const card = $('[data-packet-card]')!
  expect(card.dataset.packetCard).toBe('reflex')
  expect([...card.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['merge-requires-admin', 'prove-the-result-first'])
  await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect($('[data-packet-card]')).toBeNull()
})

test('the LV flashes when the level goes up, not when it is first read', async () => {
  await draw({ level: null })
  await draw({ level: { level: 7, into: 0, fraction: 0 } })
  expect($('.ship-lv')!.classList.contains('ship-tick')).toBe(false)
  await draw({ level: { level: 8, into: 0, fraction: 0 } })
  expect($('.ship-lv')!.classList.contains('ship-tick')).toBe(true)
  expect($('.ship-lv')!.textContent).toBe('LV8')
})

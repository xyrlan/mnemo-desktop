import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PulseEvent } from '../../pulse/types'
import { Scene, type SceneProps } from '../Scene'
import { SPRITES } from '../sprites'
import type { Packet, Target } from '../types'
import { nexus, robot, robots, territory, world } from './fixtures'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The card is the `interact` piece's; the scene only decides when it shows and what it is handed.
vi.mock('../HoverCard', () => ({
  HoverCard: ({ target, events, now }: { target: Target; events: PulseEvent[]; now: number }) => (
    <div data-card={target.kind} data-events={events.length} data-now={now}>
      {target.kind === 'robot' ? target.robot.id : target.kind === 'nexus' ? target.nexus.sessionId : target.root}
    </div>
  ),
}))

const AT = 5_000_000

const fleet = () =>
  world(
    [
      territory('mnemo-desktop', [
        nexus(
          'p1',
          [
            robot('643', { klass: 'mech', pose: 'working', halo: 'working', tool: 'Bash', accessory: 2, level: 3 }),
            robot('644', { klass: 'drone', pose: 'waiting', halo: 'needs-you', badge: 'alert', accessory: 5 }),
            robot('645', { klass: 'unknown', pose: 'sleeping', badge: 'zzz' }),
            robot('646', { badge: 'fire', tool: 'Edit' }),
          ],
          { pose: 'busy' },
        ),
        nexus('p2', [], { pose: 'dead', parent: null }),
      ]),
    ],
    AT,
  )

let root: Root | null = null
let host: HTMLElement

function draw(over: Partial<SceneProps> = {}) {
  const props: SceneProps = { world: fleet(), packets: [], events: [], onPick: () => {}, reducedMotion: false, visible: true, ...over }
  return act(async () => {
    if (!root) {
      host = document.body.appendChild(document.createElement('div'))
      root = createRoot(host)
    }
    root.render(<Scene {...props} />)
  })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const $ = (sel: string) => host.querySelector<HTMLElement>(sel)
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)]
const imgs = (el: HTMLElement | null) => [...(el?.querySelectorAll('img') ?? [])].map((i) => i.getAttribute('src'))

function animationEnd(el: HTMLElement, name: string) {
  const e = new Event('animationend', { bubbles: true })
  Object.defineProperty(e, 'animationName', { value: name })
  return act(async () => void el.dispatchEvent(e))
}

const packet = (over: Partial<Packet> = {}): Packet => ({
  id: 'k1',
  kind: 'reflex',
  path: 'to-agent',
  agent: { kind: 'robot', id: '643' },
  root: '/home/dev/mnemo-desktop',
  count: 1,
  slugs: [],
  at: AT,
  ...over,
})

test('each robot is its class and pose, standing on its floor plate, with its halo, badge and tool', async () => {
  await draw()
  const mech = $('[data-robot="643"]')!
  const [plate, body] = imgs(mech)
  expect(plate).toBe(SPRITES.accessories[2].src)
  expect(body).toBe(SPRITES.robots.mech.working.src)
  expect(mech.querySelector('.nexus-plate')!.compareDocumentPosition(mech.querySelector('.nexus-body')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(mech.dataset.halo).toBe('working')
  expect(mech.querySelector('.nexus-halo')).not.toBeNull()
  expect(mech.querySelector('.nexus-aura')).not.toBeNull()
  expect(mech.querySelector('[data-tool="Bash"] svg')).not.toBeNull()
  expect(mech.querySelector('.nexus-badge')).toBeNull()
  expect(mech.textContent).toContain('#643')

  const drone = $('[data-robot="644"]')!
  expect(imgs(drone)[1]).toBe(SPRITES.robots.drone.waiting.src)
  expect(drone.dataset.halo).toBe('needs-you')
  expect(drone.querySelector('.nexus-badge')!.getAttribute('data-badge')).toBe('alert')
  expect(drone.querySelector('.nexus-tool')).toBeNull()
  expect(drone.querySelector('.nexus-aura')).toBeNull()

  expect(imgs($('[data-robot="645"]'))[1]).toBe(SPRITES.robots.unknown.sleeping.src)
  expect($('[data-robot="645"] .nexus-badge')!.getAttribute('data-badge')).toBe('zzz')
  expect($('[data-robot="645"] .nexus-halo')).toBeNull()
  // A tool only shows while the robot works.
  expect($('[data-robot="646"] .nexus-tool')).toBeNull()
  expect($('[data-robot="646"] .nexus-badge')!.getAttribute('data-badge')).toBe('fire')
})

test('badges are drawn in code on the art’s grid, at its scale', async () => {
  await draw()
  const badge = $('[data-robot="644"] .nexus-badge')!
  expect(badge.tagName.toLowerCase()).toBe('svg')
  expect(badge.querySelectorAll('rect').length).toBeGreaterThan(10)
  const scale = Number($('.nexus-scene')!.style.getPropertyValue('--s'))
  expect(Number(badge.getAttribute('width'))).toBe(7 * 2 * scale)
  // Needs-you is the state token, nothing else.
  expect([...badge.querySelectorAll('rect')].some((r) => r.getAttribute('fill') === 'var(--state-needs-you)')).toBe(true)
})

test('the nexus is its pose, the archive its tier, the core is in the middle', async () => {
  await draw()
  expect(imgs($('[data-nexus="p1"]'))[0]).toBe(SPRITES.nexus.busy.src)
  expect(imgs($('[data-nexus="p2"]'))[0]).toBe(SPRITES.nexus.dead.src)
  const archive = $('[data-archive="/home/dev/mnemo-desktop"]')!
  expect(imgs(archive)[0]).toBe(SPRITES.archive[1].src)
  expect(archive.textContent).toBe('mnemo-desktop · 40')
  expect(imgs($('.nexus-universal'))[0]).toBe(SPRITES.universal.src)
  expect($('.nexus-universal')!.textContent).toBe('universal · 120')
  expect($('.nexus-empty')).toBeNull()
})

test('a nexus with no robots draws no ring', async () => {
  await draw()
  expect($$('.nexus-orbit')).toHaveLength(1)
})

test('an empty world draws the core and says so', async () => {
  await draw({ world: world([], AT) })
  expect($('.nexus-universal')).not.toBeNull()
  expect($('.nexus-empty')!.textContent).toBe('No live sessions.')
})

test('a ring past 15 shows the count of the robots it leaves out', async () => {
  await draw({ world: world([territory('mnemo', [nexus('p1', robots(18))])], AT) })
  expect($$('.nexus-robot')).toHaveLength(15)
  expect($('[data-nexus="p1"] .nexus-more')!.textContent).toBe('+3')
})

test('a click picks the nexus, robot or archive it lands on', async () => {
  const picked: Target[] = []
  const w = fleet()
  await draw({ world: w, onPick: (t) => picked.push(t) })
  await act(async () => $('[data-robot="644"]')!.click())
  await act(async () => $('[data-nexus="p1"]')!.click())
  await act(async () => $('[data-archive="/home/dev/mnemo-desktop"]')!.click())
  const t = w.territories[0]
  expect(picked).toEqual([
    { kind: 'robot', robot: t.nexuses[0].robots[1] },
    { kind: 'nexus', nexus: t.nexuses[0] },
    { kind: 'archive', archive: t.archive, root: t.root },
  ])
  expect((picked[0] as { robot: unknown }).robot).toBe(t.nexuses[0].robots[1])
})

test('a hover or focus shows the hover card for that thing, with the events and the world’s time', async () => {
  const events: PulseEvent[] = [{ at: AT, kind: 'reflex', project: 'mnemo-desktop', agent: 'a', slugs: ['x'], session_id: 's-643' }]
  await draw({ events })
  expect($('[data-card]')).toBeNull()
  const mech = $('[data-robot="643"]')!
  await act(async () => mech.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
  const card = $('[data-card]')!
  expect(card.dataset.card).toBe('robot')
  expect(card.textContent).toBe('643')
  expect(card.dataset.events).toBe('1')
  expect(card.dataset.now).toBe(String(AT))
  expect(card.closest('.nexus-hover-anchor')).not.toBeNull()
  await act(async () => mech.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
  expect($('[data-card]')).toBeNull()

  await act(async () => $('[data-archive="/home/dev/mnemo-desktop"]')!.focus())
  expect($('[data-card]')!.dataset.card).toBe('archive')
  await act(async () => $('[data-archive="/home/dev/mnemo-desktop"]')!.blur())
  expect($('[data-card]')).toBeNull()
})

test('a robot that appears warps in from its nexus; the ones there when the scene opened do not', async () => {
  const w = fleet()
  await draw({ world: w })
  expect($$('[data-arriving]')).toHaveLength(0)
  const next = fleet()
  next.territories[0].nexuses[0].robots.push(robot('700'))
  await draw({ world: next })
  const fresh = $('[data-robot="700"]')!
  expect($$('[data-arriving]')).toEqual([fresh])
  // It starts at its nexus: the offset is the nexus's centre less its own.
  const core = $('[data-nexus="p1"]')!
  const centre = (el: HTMLElement) => ({ x: parseFloat(el.style.left) + parseFloat(el.style.width) / 2, y: parseFloat(el.style.top) + parseFloat(el.style.height) / 2 })
  expect(parseFloat(fresh.style.getPropertyValue('--dx'))).toBeCloseTo(centre(core).x - centre(fresh).x, 5)
  expect(parseFloat(fresh.style.getPropertyValue('--dy'))).toBeCloseTo(centre(core).y - centre(fresh).y, 5)
  // A loop ending inside it is not the arrival ending.
  await animationEnd(fresh.querySelector('.nexus-body')!, 'nexus-bob')
  expect(fresh.hasAttribute('data-arriving')).toBe(true)
  await animationEnd(fresh, 'nexus-warp-in')
  expect(fresh.hasAttribute('data-arriving')).toBe(false)
  // The same robots again are no arrival.
  await draw({ world: { ...next, at: AT + 1 } })
  expect($$('[data-arriving]')).toHaveLength(0)
})

test('with reduced motion nothing warps in', async () => {
  await draw({ reducedMotion: true })
  const next = fleet()
  next.territories[0].nexuses[0].robots.push(robot('700'))
  await draw({ world: next, reducedMotion: true })
  expect($('[data-robot="700"]')).not.toBeNull()
  expect($$('[data-arriving]')).toHaveLength(0)
})

test('exits are drawn for the scene to play', async () => {
  const w = fleet()
  w.territories[0].nexuses[0].robots[0] = robot('643', { exit: 'merged' })
  w.territories[0].nexuses[0].robots[1] = robot('644', { exit: 'powered-down' })
  await draw({ world: w })
  expect($('[data-robot="643"]')!.dataset.exit).toBe('merged')
  expect($('[data-robot="643"] .nexus-burst')).not.toBeNull()
  expect($('[data-robot="644"]')!.dataset.exit).toBe('powered-down')
  expect($('[data-robot="644"] .nexus-burst')).toBeNull()
})

test('a packet travels between the archive and its agent once, however many polls still list it', async () => {
  const w = fleet()
  await draw({ world: w })
  const p = packet()
  await draw({ world: w, packets: [p] })
  const el = $('[data-packet="k1"]')!
  expect(el.className).toBe('nexus-packet')
  expect(el.dataset.path).toBe('to-agent')
  const archive = $('[data-archive="/home/dev/mnemo-desktop"]')!
  const mech = $('[data-robot="643"]')!
  const half = parseFloat(el.style.width) / 2
  expect(parseFloat(el.style.getPropertyValue('--ax')) + half).toBeCloseTo(parseFloat(archive.style.left) + parseFloat(archive.style.width) / 2, 5)
  expect(parseFloat(el.style.getPropertyValue('--gx')) + half).toBeCloseTo(parseFloat(mech.style.left) + parseFloat(mech.style.width) / 2, 5)
  expect(el.querySelector('.nexus-count')).toBeNull()

  // Coalescing grows the same packet: its counter follows while it flies.
  await draw({ world: { ...w, at: AT + 1 }, packets: [{ ...p, count: 3 }] })
  expect($$('[data-packet]')).toHaveLength(1)
  expect($('[data-packet="k1"] .nexus-count')!.textContent).toBe('×3')

  await animationEnd($('[data-packet="k1"]')!, 'nexus-to-agent')
  expect($('[data-packet="k1"]')).toBeNull()
  await draw({ world: { ...w, at: AT + 2 }, packets: [{ ...p, count: 3 }] })
  expect($('[data-packet="k1"]')).toBeNull()
})

test('a packet from before anyone looked is not played', async () => {
  await draw({ packets: [packet({ id: 'old', at: AT - 60_000 }), packet({ id: 'new' })] })
  expect($$('[data-packet]').map((e) => e.dataset.packet)).toEqual(['new'])
})

test('a flash, or a packet whose agent is not drawn, glows on the archive', async () => {
  await draw({
    packets: [packet({ id: 'f', path: 'flash', agent: null, kind: 'learned', count: 4 }), packet({ id: 'lost', agent: { kind: 'robot', id: 'gone' } }), packet({ id: 'n', agent: { kind: 'nexus', id: 'p1' }, path: 'round-trip' })],
  })
  expect($('[data-packet="f"]')!.className).toBe('nexus-flash')
  expect($('[data-packet="f"] .nexus-count')!.textContent).toBe('×4')
  expect($('[data-packet="lost"]')!.className).toBe('nexus-flash')
  expect($('[data-packet="n"]')!.dataset.path).toBe('round-trip')
  // A packet for a territory not drawn is dropped, not thrown.
  await draw({ packets: [packet({ id: 'elsewhere', root: '/home/dev/other' })] })
  expect($('[data-packet="elsewhere"]')).toBeNull()
})

test('with reduced motion a packet does not travel: it rests where it was going, its counter showing', async () => {
  await draw({ reducedMotion: true, packets: [packet({ count: 2 }), packet({ id: 'up', path: 'to-archive', kind: 'friction' })] })
  expect($('.nexus-packet')).toBeNull()
  expect($('.nexus-flash')).toBeNull()
  const mark = $('[data-packet="k1"]')!
  expect(mark.className).toBe('nexus-mark')
  expect(mark.querySelector('.nexus-count')!.textContent).toBe('×2')
  const mech = $('[data-robot="643"]')!
  const centreX = (el: HTMLElement) => parseFloat(el.style.left) + parseFloat(el.style.width) / 2
  expect(centreX(mark)).toBeCloseTo(centreX(mech), 5)
  expect(centreX($('[data-packet="up"]')!)).toBeCloseTo(centreX($('[data-archive="/home/dev/mnemo-desktop"]')!), 5)
  await animationEnd(mark, 'nexus-hold')
  expect($('[data-packet="k1"]')).toBeNull()
})

test('reduced motion and a hidden window are marked on the scene for its stylesheet', async () => {
  await draw()
  expect($('.nexus-scene')!.hasAttribute('data-reduced')).toBe(false)
  expect($('.nexus-scene')!.hasAttribute('data-paused')).toBe(false)
  await draw({ reducedMotion: true, visible: false })
  expect($('.nexus-scene')!.hasAttribute('data-reduced')).toBe(true)
  expect($('.nexus-scene')!.hasAttribute('data-paused')).toBe(true)
})

// The stylesheet that ships, read off disk as `scrollbar.test.ts` reads its own: `tsc` checks tests
// with the app's types (no Node modules), and vitest hands a `?raw` CSS import back empty.
type Fs = { readFileSync(path: string, encoding: string): string }

/** nexus.css as rules: `[selector, body]`, keyframes left out. */
async function rules(): Promise<Array<[string, string]>> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const css = fs
    .readFileSync('src/nexus/nexus.css', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '')
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
}

test('the stylesheet: no loop and no travel with reduced motion, everything paused while hidden, pixels kept sharp', async () => {
  const all = await rules()
  const animated = all.filter(([, body]) => /\banimation\s*:/.test(body))
  expect(animated.length).toBeGreaterThan(10)
  const travel = /nexus-(warp-in|merged|power-down|to-agent|to-archive|round-trip|flash|bob|breathe|sway|swing|hop|float|spin|burst)\b/
  for (const [sel, body] of animated) {
    const moves = /\binfinite\b/.test(body) || travel.test(body)
    // Every selector in a moving rule is scoped to motion allowed.
    if (moves) for (const one of sel.split(',')) expect(one).toContain('.nexus-scene:not([data-reduced])')
  }
  // What reduced motion keeps animates no position.
  for (const [sel, body] of animated.filter(([sel]) => sel.includes('[data-reduced]') && !sel.includes(':not('))) {
    expect(body).toMatch(/nexus-(fade|hold)\b/)
    expect(sel).not.toMatch(/:not/)
  }
  const paused = all.find(([sel]) => sel.includes('[data-paused]'))!
  expect(paused[0]).toContain('.nexus-scene[data-paused] *')
  expect(paused[1]).toMatch(/animation-play-state:\s*paused\s*!important/)
  expect(all.find(([sel]) => sel === '.nexus-px')![1]).toMatch(/image-rendering:\s*pixelated/)
  // Halos are the four state tokens.
  for (const s of ['working', 'needs-you', 'done', 'idle']) expect(all.find(([sel]) => sel === `[data-halo='${s}']`)![1]).toContain(`var(--state-${s})`)
})

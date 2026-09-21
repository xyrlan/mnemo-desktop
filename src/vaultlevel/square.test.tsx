import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'
import Square, { AGE_MS, BUCKETS, OCTO, SQUARE, TICK } from './Square'
import { createPulseStore } from '../pulse/store'
import type { LevelClient } from './client'
import type { VaultLevel } from './types'
import type { PulseEvent } from '../pulse/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const vault = (over: Partial<VaultLevel> = {}): VaultLevel => ({
  root: '/v',
  pages: 1000,
  rules_fired: 200,
  fires: 300,
  fired_recent: 40,
  dormant: 0,
  label_only: 0,
  inbox: 0,
  error: null,
  ...over,
})
const ev = (over: Partial<PulseEvent> = {}): PulseEvent => ({ at: Date.now(), kind: 'reflex', project: 'x', agent: 'x', slugs: [], ...over })

/** A client whose best-ever xp is whatever it was offered highest, like the Rust side. */
function fakeClient(levels: VaultLevel[]): LevelClient & { offered: number[] } {
  let best = 0
  const offered: number[] = []
  let i = 0
  return {
    offered,
    level: async () => levels[Math.min(i++, levels.length - 1)],
    best: async (xp) => {
      offered.push(xp)
      best = Math.max(best, xp)
      return best
    },
  }
}

async function render(node: React.ReactNode) {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, unmount: () => act(() => root.unmount()) }
}

afterEach(() => vi.useRealTimers())

test('the square shows the level from the best xp, tinted by health', async () => {
  const client = fakeClient([vault()])
  const { host, unmount } = await render(<Square client={client} pulses={createPulseStore()} />)
  // 1000 + 5×200 + 300 = 2300
  expect(client.offered).toEqual([2300])
  expect(host.querySelector('.vl-level')?.textContent).toBe('lv 23')
  expect(host.querySelector('.vl-square')?.classList.contains('vl-green')).toBe(true)
  expect(host.querySelector('.vl-square')?.classList.contains('vl-on-fire')).toBe(true)
  // No pulse yet: he wears the health pose, with nothing to say and an hour of rest marks.
  expect(host.querySelector('.av-idle.vl-body')).not.toBeNull()
  expect(host.querySelector('.vl-verb')).toBeNull()
  const quiet = [...host.querySelectorAll('.vl-tick')]
  expect(quiet).toHaveLength(BUCKETS)
  expect(quiet.every((t) => t.classList.contains('vl-quiet'))).toBe(true)
  unmount()
})

test('a retired rule moves the colour and not the level', async () => {
  vi.useFakeTimers()
  const client = fakeClient([vault(), vault({ rules_fired: 20, dormant: 900 })])
  const { host, unmount } = await render(<Square client={client} pulses={createPulseStore()} pollMs={1000} />)
  expect(host.querySelector('.vl-level')?.textContent).toBe('lv 23')
  await act(async () => vi.advanceTimersByTime(1000))
  expect(client.offered[1]).toBeLessThan(client.offered[0])
  expect(host.querySelector('.vl-level')?.textContent).toBe('lv 23')
  // Health 0.335 lands in the orange band: five tones report the slide before it is red.
  expect(host.querySelector('.vl-square')?.classList.contains('vl-orange')).toBe(true)
  // Orange wears the poor pose.
  expect(host.querySelector('.av-poor')).not.toBeNull()
  unmount()
})

test('no vault reads as such and records nothing', async () => {
  const client = fakeClient([vault({ error: 'no mnemo vault found', pages: 0 })])
  const { host, unmount } = await render(<Square client={client} pulses={createPulseStore()} />)
  expect(host.querySelector('.vl-level')?.textContent).toBe('no vault')
  expect(host.querySelector('.vl-muted')).not.toBeNull()
  expect(client.offered).toEqual([])
  unmount()
})

test('an empty vault reads as neutral, not as a sick one', async () => {
  const { host, unmount } = await render(<Square client={fakeClient([vault({ pages: 0, rules_fired: 0, fires: 0 })])} pulses={createPulseStore()} />)
  const square = host.querySelector('.vl-square')!
  // healthOf floors at 0 for an empty vault, which as a tone would be red.
  expect(square.classList.contains('vl-muted')).toBe(true)
  expect(square.classList.contains('vl-red')).toBe(false)
  expect(host.querySelector('.av-poor')).toBeNull()
  expect(square.getAttribute('aria-label')).toBe('the vault is empty')
  unmount()
})

test('the ▤ button opens the vault, and is absent when nothing can open it', async () => {
  const open = vi.fn()
  const withButton = await render(<Square client={fakeClient([vault()])} pulses={createPulseStore()} openVault={open} />)
  withButton.host.querySelector<HTMLButtonElement>('.vl-open')!.click()
  expect(open).toHaveBeenCalledTimes(1)
  withButton.unmount()

  const without = await render(<Square client={fakeClient([vault()])} pulses={createPulseStore()} />)
  expect(without.host.querySelector('.vl-open')).toBeNull()
  without.unmount()
})

const svgOf = (host: HTMLElement) => host.querySelector('.vl-octo svg')!

/** Every source in the app, read raw, the way `vault/modes.test.tsx` pins its own deletion. */
const sources = import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

test('`recent.ts` is gone, and nothing reaches for it', () => {
  // A revert or a stale merge is how a deleted module comes back. The glob is the guard: it is
  // the trail's data that went, not just its markup, and `recentPulses` has nowhere left to be.
  expect(Object.keys(sources).length).toBeGreaterThan(50)
  expect(Object.keys(sources).filter((f) => /vaultlevel\/recent\.tsx?$/.test(f))).toEqual([])
  expect(Object.keys(sources).filter((f) => /recentPulses|toneOfKind/.test(sources[f]))).toEqual([])
})

test('the first pulse dresses him in its scene, and he keeps wearing it', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  expect(svgOf(host).getAttribute('width')).toBe(String(OCTO))

  await act(async () => pulses.getState().push(ev({ kind: 'enforce', tool: 'git push --force', project: 'mnemo' })))
  expect(svgOf(host).classList.contains('av-blocked')).toBe(true)
  expect(host.querySelector('.av-idle')).toBeNull()
  expect(host.querySelector('.vl-what')?.textContent).toBe('blocked git push --force')
  expect(host.querySelector('.vl-where')?.textContent).toBe('mnemo · 0s')
  expect(host.querySelector('.vl-square')?.getAttribute('aria-label')).toContain('last: blocked git push --force, mnemo · 0s')

  // No overlay timer sends him back to rest: an hour on, he still wears it.
  await act(async () => vi.advanceTimersByTime(60 * 60_000))
  expect(svgOf(host).classList.contains('av-blocked')).toBe(true)
  unmount()
})

test('the scene owns the colour: a blocked command is red on a green vault', async () => {
  const pulses = createPulseStore()
  pulses.getState().push(ev({ kind: 'enforce' }))
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  expect(host.querySelector('.vl-square')?.classList.contains('vl-green')).toBe(true)
  const svg = svgOf(host)
  expect(svg.classList.contains('av-red')).toBe(true)
  // The health tint is the at-rest skin only.
  expect(svg.classList.contains('vl-body')).toBe(false)
  unmount()
})

test('the age recounts itself on its own clock', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  // A slow poll, so only the age timer can be what moves the caption.
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} pollMs={10 * 60_000} />)
  await act(async () => pulses.getState().push(ev({ kind: 'tool', slugs: ['git-rules'] })))
  expect(host.querySelector('.vl-what')?.textContent).toBe('read git-rules')
  await act(async () => vi.advanceTimersByTime(4 * 60_000 + AGE_MS))
  expect(host.querySelector('.vl-where')?.textContent).toBe('x · 4m')
  unmount()
})

const ticks = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.vl-tick')]

test('the texture is always the whole window, and a busy minute is one tall bar in it', async () => {
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  const kinds = ['learned', 'reflex', 'tool', 'tool', 'tool', 'enrich', 'enforce', 'friction'] as const
  await act(async () => kinds.forEach((kind) => pulses.getState().push(ev({ kind }))))

  const bars = ticks(host)
  // The row is a stretch of time, not a list of events: eight pulses, still `BUCKETS` bars.
  expect(bars).toHaveLength(BUCKETS)
  // All eight landed in this minute, so only the newest bucket has any height.
  expect(bars.at(-1)!.style.height).toBe(`${TICK}px`)
  expect(bars.slice(0, -1).every((t) => t.style.height === '0px' && t.classList.contains('vl-quiet'))).toBe(true)
  // Its colour is the bucket's dominant tone, not the last pulse's: six of the eight are accent.
  expect(bars.at(-1)!.classList.contains('vl-kind-accent')).toBe(true)
  expect(bars.at(-1)!.classList.contains('vl-quiet')).toBe(false)
  unmount()
})

test('the texture says how busy and nothing else: no number, no legend, nothing to hover', async () => {
  const pulses = createPulseStore()
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  await act(async () => pulses.getState().push(ev({ kind: 'enforce', tool: 'git push --force' })))
  const band = host.querySelector('.vl-texture')!
  expect(band.getAttribute('aria-hidden')).toBe('true')
  expect(band.textContent).toBe('')
  expect(ticks(host).some((t) => t.title || t.getAttribute('aria-label'))).toBe(false)
  // The trail it replaced is gone for good: no dots, no run counts.
  expect(host.querySelector('.vl-trail, .vl-dot, .vl-count, .vl-now')).toBeNull()
  unmount()
})

test('a pulse an hour old has left the window, and the texture goes quiet again', async () => {
  vi.useFakeTimers()
  const pulses = createPulseStore()
  // A slow poll, so only the age timer can be what re-cuts the texture.
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} pollMs={10 * 60_000} />)
  await act(async () => pulses.getState().push(ev({ kind: 'learned' })))
  expect(ticks(host).at(-1)!.classList.contains('vl-quiet')).toBe(false)

  await act(async () => vi.advanceTimersByTime(61 * 60_000))
  expect(ticks(host).every((t) => t.classList.contains('vl-quiet'))).toBe(true)
  // He is still wearing it, though: the texture forgets, the octopus does not.
  expect(svgOf(host).classList.contains('av-learned')).toBe(true)
  unmount()
})

test('the octopus ignores which pane a pulse was routed to', async () => {
  const pulses = createPulseStore()
  pulses.getState().claim({ pane: 1, place: 'x', focused: false })
  pulses.getState().claim({ pane: 2, place: 'other', focused: true })
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={pulses} />)
  await act(async () => pulses.getState().push(ev({ kind: 'learned', slugs: ['a-rule'] })))
  expect(pulses.getState().log.at(-1)?.pane).toBe(1)
  expect(svgOf(host).classList.contains('av-learned')).toBe(true)
  unmount()
})

test('the octopus keeps wearing pulses when the vault cannot be read', async () => {
  const pulses = createPulseStore()
  pulses.getState().push(ev({ kind: 'dispatch', hits: 3 }))
  const client = fakeClient([vault({ error: 'no mnemo vault found', pages: 0 })])
  const { host, unmount } = await render(<Square client={client} pulses={pulses} />)
  expect(host.querySelector('.vl-level')?.textContent).toBe('no vault')
  expect(svgOf(host).classList.contains('av-dispatching')).toBe(true)
  expect(host.querySelector('.vl-what')?.textContent).toBe('dispatched 3 children')
  unmount()
})

test('the square is its four bands tall, and the library is gone', async () => {
  const { host, unmount } = await render(<Square client={fakeClient([vault()])} pulses={createPulseStore()} />)
  expect(SQUARE).toBe(113 + 26 + 15 + 22)
  expect(host.querySelector('.vl-shelves, .vl-book, .vl-shelving, .vl-morsel')).toBeNull()
  // Band 3 is the texture now, and its predecessor left nothing behind.
  expect(host.querySelector('.vl-texture')).not.toBeNull()
  expect(host.querySelector('.vl-trail, .vl-dot, .vl-count')).toBeNull()
  // The fire moved to the HUD.
  expect(host.querySelector('.vl-hud .vl-fire')).not.toBeNull()
  unmount()
})

/** The stylesheets are the ones that ship, read off disk: jsdom applies no layout, and a `?raw`
 *  import of a `.css` comes back empty under vitest (the CSS plugin stubs it first). The `fs`
 *  type is declared here rather than pulled in: the project carries no `@types/node`, and a guard
 *  is not worth a dependency. Both files, because the bug this guards against lived in the gap
 *  between them. */
type Fs = { readFileSync(path: string, encoding: string): string }
type Url = { fileURLToPath(url: URL): string }
const readCss = async (rel: string): Promise<string> => {
  // The specifiers are built at run time so `tsc` does not try to resolve them: the project
  // carries no `@types/node`, and a guard is not worth a dependency. Vitest runs in Node, so the
  // imports themselves are ordinary.
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const url = (await import(/* @vite-ignore */ 'node:' + 'url')) as unknown as Url
  // `fileURLToPath`, never `.pathname`: on Windows the latter yields `/D:/a/...`, which `fs`
  // reads as relative and opens as `D:\D:\a\...`.
  return fs.readFileSync(url.fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const pxIn = (css: string, selector: string, prop: string): number => {
  const rule = css.split('\n').find((l: string) => l.trimStart().startsWith(`${selector} {`))
  if (!rule) throw new Error(`${selector} not found`)
  const found = new RegExp(`(?:^|[;{\\s])${prop}:\\s*(\\d+)px`).exec(rule)
  if (!found) throw new Error(`${selector} has no ${prop}`)
  return Number(found[1])
}

test('the slot is tall enough for the square, so the HUD is never clipped', async () => {
  // The square's bands are `flex: 0 0`, and both boxes clip. A slot shorter than the square does
  // not scale it down — it cuts the last band off the bottom, and the last band is the HUD that
  // carries `lv N`. This is how the level vanished when the square grew to 176 and the slot,
  // written for the older 160, stayed behind.
  expect(pxIn(await readCss('./vaultlevel.css'), '.vl-square', 'height')).toBe(SQUARE)
  expect(pxIn(await readCss('../theme.css'), '.vault-level-slot', 'height')).toBeGreaterThanOrEqual(SQUARE)
})

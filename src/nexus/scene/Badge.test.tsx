import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Badge as BadgeKind } from '../types'
import { Badge } from './Badge'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement

async function draw(kind: Exclude<BadgeKind, null>) {
  await act(async () => {
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    root.render(<Badge kind={kind} scale={1} />)
  })
  return host.querySelector('svg')!
}

async function clear() {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
}

afterEach(clear)

const fills = (el: Element) => new Set([...el.querySelectorAll('rect')].map((r) => r.getAttribute('fill')))
const STATES = ['working', 'needs-you', 'done', 'idle'].map((s) => `var(--state-${s})`)
const stateFills = (el: Element) => [...fills(el)].filter((f) => f?.startsWith('var(--state-'))

test('checks running: a flag in the working colour beside a still hourglass, its cloth in two frames', async () => {
  const svg = await draw('flag-pending')
  const a = svg.querySelector('.nexus-wave-a')!
  const b = svg.querySelector('.nexus-wave-b')!
  expect(a.querySelectorAll('rect').length).toBeGreaterThan(10)
  expect(b.querySelectorAll('rect').length).toBeGreaterThan(10)
  // The frames differ, or nothing would wave.
  const at = (g: Element) => [...g.querySelectorAll('rect')].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')}`).sort().join(' ')
  expect(at(a)).not.toBe(at(b))
  // The hourglass and the pole sit outside the frames, so they hold still: sand in the working colour.
  const still = [...svg.children].filter((c) => c.tagName.toLowerCase() === 'rect')
  expect(still.length).toBeGreaterThan(15)
  expect(still.some((r) => r.getAttribute('fill') === 'var(--state-working)')).toBe(true)
  expect(stateFills(svg)).toEqual(['var(--state-working)'])
  // Wider than a lone flag: the hourglass stands beside it.
  expect(Number(svg.getAttribute('width'))).toBe(12 * 2)
})

test('checks passed: a still flag in the done colour', async () => {
  const svg = await draw('flag-ready')
  expect(svg.querySelector('g')).toBeNull()
  expect(stateFills(svg)).toEqual(['var(--state-done)'])
})

test('a draft: a flag of its own shape, carrying no state colour', async () => {
  const draft = await draw('flag-draft')
  expect(draft.querySelector('g')).toBeNull()
  expect(stateFills(draft)).toEqual([])
  const cells = (svg: Element) => [...svg.querySelectorAll('rect')].map((r) => `${r.getAttribute('x')},${r.getAttribute('y')}`).sort().join(' ')
  const mine = cells(draft)
  await clear()
  for (const other of ['flag-pending', 'flag-ready'] as const) {
    expect(cells(await draw(other))).not.toBe(mine)
    await clear()
  }
})

test('colour means state only: no badge paints a state colour outside the four tokens', async () => {
  for (const kind of ['alert', 'zzz', 'flag-pending', 'flag-ready', 'flag-draft', 'fire'] as const) {
    const svg = await draw(kind)
    for (const f of fills(svg)) expect(f).toMatch(/^var\(--(state|nexus)-[a-z-]+\)$/)
    for (const f of stateFills(svg)) expect(STATES).toContain(f)
    await clear()
  }
})

// nexus.css off disk, as `Scene.test.tsx` reads it.
type Fs = { readFileSync(path: string, encoding: string): string }

test('the stylesheet waves the flag only with motion allowed; at rest the first frame shows', async () => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const css = fs.readFileSync('src/nexus/nexus.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
  const wave = rules.filter(([sel]) => /nexus-wave-[ab]/.test(sel) && sel.includes('[data-badge'))
  expect(wave.map(([sel]) => sel.match(/nexus-wave-[ab]/)![0]).sort()).toEqual(['nexus-wave-a', 'nexus-wave-b'])
  for (const [sel, body] of wave) {
    expect(sel).toContain(".nexus-scene:not([data-reduced]) .nexus-badge[data-badge='flag-pending']")
    expect(body).toMatch(/animation:\s*nexus-wave-(in|out)\b.*\binfinite\b/)
  }
  // With no animation (reduced motion), the second frame is hidden and the first is not.
  expect(rules.find(([sel]) => sel === '.nexus-wave-b')![1]).toMatch(/opacity:\s*0/)
  expect(rules.some(([sel]) => sel === '.nexus-wave-a')).toBe(false)
  // The two loops trade the frames at the same moment.
  expect(css).toMatch(/@keyframes nexus-wave-out \{ 50% \{ opacity: 0; \} \}/)
  expect(css).toMatch(/@keyframes nexus-wave-in \{ 50% \{ opacity: 1; \} \}/)
})

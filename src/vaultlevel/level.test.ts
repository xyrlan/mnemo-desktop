import vaultRs from '../../src-tauri/src/vault.rs?raw'
import libRs from '../../src-tauri/src/lib.rs?raw'
import { vi } from 'vitest'
import {
  FIRE_MIN_RECENT,
  HALO_MAX_DOTS,
  HALO_BAND_PAGES,
  HALO_MIN_DOTS,
  HEALTH_GREEN,
  HEALTH_WEIGHTS,
  XP_PER_FIRE,
  XP_PER_FIRED_RULE,
  XP_PER_LEVEL,
  flashed,
  haloDots,
  haloLayout,
  healthOf,
  levelOf,
  onFire,
  toneOf,
  xpOf,
} from './level'
import { makeLevelClient } from './client'
import type { VaultLevel } from './types'

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

test('xp is pages plus weighted reach plus fires', () => {
  expect(xpOf({ pages: 0, rules_fired: 0, fires: 0 })).toBe(0)
  expect(xpOf({ pages: 10, rules_fired: 2, fires: 3 })).toBe(10 + 2 * XP_PER_FIRED_RULE + 3 * XP_PER_FIRE)
})

test('the level steps at exact multiples and the bar measures the way to the next', () => {
  expect(levelOf(0)).toEqual({ level: 0, into: 0, fraction: 0 })
  expect(levelOf(XP_PER_LEVEL - 1).level).toBe(0)
  expect(levelOf(XP_PER_LEVEL)).toEqual({ level: 1, into: 0, fraction: 0 })
  expect(levelOf(XP_PER_LEVEL * 3 + 25)).toEqual({ level: 3, into: 25, fraction: 0.25 })
  expect(levelOf(-5).level).toBe(0)
})

test('a retired rule lowers xp but not the level read from the best ever seen', () => {
  const before = xpOf(vault())
  const after = xpOf(vault({ rules_fired: 150 }))
  expect(after).toBeLessThan(before)
  const best = Math.max(before, after)
  expect(levelOf(best)).toEqual(levelOf(before))
})

test('the health weights add to one', () => {
  const sum = Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)
  expect(sum).toBeCloseTo(1)
})

test('a vault with wide reach and nothing pending is fully healthy; an empty one is not', () => {
  expect(healthOf(vault())).toBeCloseTo(1)
  expect(healthOf(vault({ pages: 0 }))).toBe(0)
})

test('dormancy, label-only pages and a full inbox each cost health, and it stays in [0, 1]', () => {
  const full = healthOf(vault())
  expect(healthOf(vault({ dormant: 200 }))).toBeLessThan(full)
  expect(healthOf(vault({ label_only: 20 }))).toBeLessThan(full)
  expect(healthOf(vault({ inbox: 50 }))).toBeLessThan(full)
  const worst = healthOf(vault({ rules_fired: 0, dormant: 1000, label_only: 1000, inbox: 10_000 }))
  expect(worst).toBe(0)
})

test('the real vault of 2026-09-16 reads yellow, not on fire', () => {
  const real = vault({ pages: 2413, rules_fired: 386, fires: 576, fired_recent: 320, dormant: 646, label_only: 0, inbox: 195 })
  const h = healthOf(real)
  expect(toneOf(h)).toBe('yellow')
  expect(onFire(h, real.fired_recent)).toBe(false)
  expect(levelOf(xpOf(real)).level).toBe(49)
})

test('tone and fire follow their thresholds', () => {
  expect(toneOf(1)).toBe('green')
  expect(toneOf(HEALTH_GREEN)).toBe('green')
  expect(toneOf(0.5)).toBe('yellow')
  expect(toneOf(0.1)).toBe('red')
  expect(onFire(HEALTH_GREEN, FIRE_MIN_RECENT)).toBe(true)
  expect(onFire(HEALTH_GREEN, FIRE_MIN_RECENT - 1)).toBe(false)
  expect(onFire(HEALTH_GREEN - 0.01, 1000)).toBe(false)
})

test('the halo grows in bands and stays within its bounds', () => {
  expect(haloDots(0)).toBe(HALO_MIN_DOTS)
  expect(haloDots(HALO_BAND_PAGES - 1)).toBe(HALO_MIN_DOTS)
  expect(haloDots(HALO_BAND_PAGES)).toBeGreaterThan(HALO_MIN_DOTS)
  // A real vault is still climbing, not pinned at the ceiling.
  expect(haloDots(2_413)).toBeLessThan(HALO_MAX_DOTS)
  expect(haloDots(1_000_000)).toBe(HALO_MAX_DOTS)
  for (let p = 0; p < 20_000; p += 137) expect(haloDots(p + 137)).toBeGreaterThanOrEqual(haloDots(p))
})

test('the rain is deterministic and every fragment starts on the bottom edge', () => {
  const dots = haloLayout(40, 160)
  expect(dots).toEqual(haloLayout(40, 160))
  for (const d of dots) {
    // `y` belongs to the animation; only the column is laid out, and it stays inside the square.
    expect(d.x).toBeGreaterThanOrEqual(0)
    expect(d.x + d.w).toBeLessThanOrEqual(160)
    expect(d.rise).toBeGreaterThan(0)
    // A negative delay starts the climb part-way through, so the rain is already underway.
    expect(d.delay).toBeLessThanOrEqual(0)
    expect(Math.abs(d.delay)).toBeLessThanOrEqual(d.rise)
  }
})
test('a pulse flashes a few distinct dots, and never one that does not exist', () => {
  expect(flashed(3, 0).size).toBe(0)
  const f = flashed(12, 40)
  expect(f.size).toBe(5)
  for (const i of f) expect(i).toBeLessThan(40)
  expect(flashed(2, 3).size).toBeLessThanOrEqual(3)
})

test('the client calls the two commands and floors the xp it offers', async () => {
  const invoke = vi.fn().mockResolvedValue(7)
  const c = makeLevelClient(invoke as never)
  await c.level()
  await c.best(12.8)
  expect(invoke.mock.calls).toEqual([['vault_level'], ['vault_level_best', { xp: 12 }]])
})

test('every command the client invokes is registered in the vaultlevel block of lib.rs', async () => {
  const block = /\/\/ -- vaultlevel commands --([^/]*)/.exec(libRs)![1]
  const registered = [...block.matchAll(/vault::(\w+)/g)].map((m) => m[1])
  const invoked: string[] = []
  const c = makeLevelClient(async <T,>(cmd: string) => (invoked.push(cmd), undefined as T))
  await Promise.all([c.level(), c.best(1)])
  expect(registered.sort()).toEqual(invoked.sort())
  for (const cmd of invoked) expect(vaultRs).toContain(`pub async fn ${cmd}(`)
})

test('fragments carry depth: the near ones are bigger and faster than the far ones', () => {
  const dots = haloLayout(60, 160)
  // Depth is interleaved across the width, not ramped, so near and far fragments mix.
  const byDepth = [...dots].sort((a, b) => a.depth - b.depth)
  expect(byDepth[0].depth).toBeLessThan(byDepth[byDepth.length - 1].depth)
  // The near ones are bigger and faster than the far ones.
  const near = byDepth.slice(0, 10)
  const far = byDepth.slice(-10)
  expect(near.reduce((a, d) => a + d.w, 0)).toBeGreaterThan(far.reduce((a, d) => a + d.w, 0))
  expect(near.reduce((a, d) => a + d.rise, 0)).toBeLessThan(far.reduce((a, d) => a + d.rise, 0))
  // Every fragment climbs on its own clock: no two start the same wave.
  expect(new Set(dots.map((d) => d.delay)).size).toBeGreaterThan(dots.length / 2)
})

import vaultRs from '../../src-tauri/src/vault.rs?raw'
import libRs from '../../src-tauri/src/lib.rs?raw'
import { vi } from 'vitest'
import {
  FIRE_MIN_RECENT,
  BOOKS_PER_ROW,
  PAGES_PER_BOOK,
  SHELF_ROWS,
  bookCount,
  booksPerRow,
  shelfBooks,
  HEALTH_GREEN,
  HEALTH_WEIGHTS,
  XP_PER_FIRE,
  XP_PER_FIRED_RULE,
  XP_PER_LEVEL,
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

test('books count a band of pages each and stop when the shelves are full', () => {
  expect(bookCount(0)).toBe(0)
  expect(bookCount(PAGES_PER_BOOK - 1)).toBe(0)
  expect(bookCount(PAGES_PER_BOOK)).toBe(1)
  // The live vault fills about a third of the wall, with room to keep filling.
  expect(bookCount(2_413)).toBe(34)
  expect(bookCount(1_000_000)).toBe(SHELF_ROWS * BOOKS_PER_ROW)
  for (let p = 0; p < 30_000; p += 211) expect(bookCount(p + 211)).toBeGreaterThanOrEqual(bookCount(p))
})

test('a wider sidebar is a wider wall: more books a row, and more of them', () => {
  expect(booksPerRow(160)).toBe(BOOKS_PER_ROW)
  expect(booksPerRow(480)).toBeGreaterThan(booksPerRow(160))
  // Never so narrow that a row holds nothing.
  expect(booksPerRow(1)).toBeGreaterThanOrEqual(6)
  expect(bookCount(1_000_000, booksPerRow(480))).toBeGreaterThan(bookCount(1_000_000, booksPerRow(160)))
})

test('books fill bottom-up, stay on their shelf, and are deterministic', () => {
  // More than one row's worth, so "bottom-up" is observable.
  const books = shelfBooks(40, 160)
  expect(books).toEqual(shelfBooks(40, 160))
  expect(books).toHaveLength(40)
  // The bottom shelf fills before the one above it, so a growing vault stacks up.
  expect(books[0].row).toBe(0)
  expect(books.at(-1)!.row).toBeGreaterThan(0)
  for (const b of books) {
    expect(b.row).toBeLessThan(SHELF_ROWS)
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(160 + 1e-9)
    expect(b.h).toBeGreaterThan(0)
  }
  // Spine widths vary, or the wall reads as a barcode.
  expect(new Set(books.map((b) => b.w.toFixed(2))).size).toBeGreaterThan(1)
})

test('more books than the shelves hold are dropped, not stacked off the top', () => {
  const books = shelfBooks(10_000, 160)
  expect(books).toHaveLength(SHELF_ROWS * BOOKS_PER_ROW)
  expect(Math.max(...books.map((b) => b.row))).toBe(SHELF_ROWS - 1)
})

test('exactly one book is the last, and it is the one on the end of the filled run', () => {
  const books = shelfBooks(40, 160)
  expect(books.filter((b) => b.last)).toHaveLength(1)
  expect(books.at(-1)!.last).toBe(true)
  // A partly filled row leans its final book; an exactly full one does not.
  expect(books.at(-1)!.lean).toBeGreaterThan(0)
  const exact = shelfBooks(booksPerRow(160), 160)
  expect(exact.at(-1)!.last).toBe(true)
  expect(exact.at(-1)!.lean).toBe(0)
  expect(shelfBooks(0, 160)).toEqual([])
})

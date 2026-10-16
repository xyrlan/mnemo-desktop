import { SHIP_SPRITES, SPRITES, type SpriteSheet } from './sprites'
import { ACCESSORIES } from './ship-types'

test('every class, pose and accessory has a sprite, at 64 px', () => {
  for (const poses of Object.values(SPRITES.robots)) for (const s of Object.values(poses)) expect(s.src).toBeTruthy()
  expect(Object.keys(SPRITES.robots).sort()).toEqual(['droid', 'drone', 'mech', 'unknown'])
  expect(Object.keys(SPRITES.robots.mech).sort()).toEqual(['idle', 'sleeping', 'waiting', 'working'])
  expect(SPRITES.accessories).toHaveLength(ACCESSORIES)
  expect(SPRITES.robots.mech.idle).toMatchObject({ w: 64, h: 64 })
})

test('v2: a captain per pose at 96 px, the empty chair, the shuttle docked and launching, the teleport pad', () => {
  expect(Object.keys(SHIP_SPRITES.captain).sort()).toEqual(['alert', 'busy', 'idle', 'offline'])
  for (const s of Object.values(SHIP_SPRITES.captain)) expect(s).toMatchObject({ w: 96, h: 96 })
  expect(SHIP_SPRITES.chair).toMatchObject({ w: 64, h: 64 })
  expect(SHIP_SPRITES.shuttle.docked).toMatchObject({ w: 64, h: 64 })
  expect(SHIP_SPRITES.shuttle.launch).toMatchObject({ w: 64, h: 96 })
  expect(SHIP_SPRITES.teleport).toMatchObject({ w: 64, h: 96 })
  for (const s of [SHIP_SPRITES.chair, SHIP_SPRITES.teleport, SHIP_SPRITES.shuttle.docked, SHIP_SPRITES.shuttle.launch]) expect(s.src).toBeTruthy()
})

test('the archive tower and every held prop, at 24 px', () => {
  expect(SHIP_SPRITES.archive).toMatchObject({ w: 24, h: 24 })
  expect(Object.keys(SHIP_SPRITES.props).sort()).toEqual(['edit', 'green', 'need', 'read', 'red', 'run', 'ship', 'test'])
  for (const s of Object.values(SHIP_SPRITES.props)) expect(s).toMatchObject({ w: 24, h: 24 })
})

test('every image in sprites/ is drawn: none is left over', () => {
  const files = Object.values(import.meta.glob<string>('./sprites/*.png', { eager: true, query: '?url', import: 'default' }))
  const sheets = (x: unknown): SpriteSheet[] =>
    x && typeof x === 'object' ? ('src' in x ? [x as SpriteSheet] : Object.values(x).flatMap(sheets)) : []
  const drawn = new Set([...sheets(SPRITES), ...sheets(SHIP_SPRITES)].map((s) => s.src))
  expect(files.filter((f) => !drawn.has(f))).toEqual([])
})

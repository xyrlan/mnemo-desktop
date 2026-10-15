import { SHIP_SPRITES, SPRITES } from './sprites'
import { ACCESSORIES } from './types'

test('every class, pose, nexus pose, tier, accessory, the core and the packet has a sprite', () => {
  for (const poses of Object.values(SPRITES.robots)) for (const s of Object.values(poses)) expect(s.src).toBeTruthy()
  expect(Object.keys(SPRITES.robots).sort()).toEqual(['droid', 'drone', 'mech', 'unknown'])
  expect(Object.keys(SPRITES.nexus).sort()).toEqual(['busy', 'dead', 'idle', 'waiting'])
  expect(SPRITES.accessories).toHaveLength(ACCESSORIES)
  expect(Object.keys(SPRITES.archive)).toHaveLength(3)
  expect(SPRITES.universal.src && SPRITES.packet.src).toBeTruthy()
})

test('robots are 64 px and the nexus 96 px (spec Q16)', () => {
  expect(SPRITES.robots.mech.idle).toMatchObject({ w: 64, h: 64 })
  expect(SPRITES.nexus.busy).toMatchObject({ w: 96, h: 96 })
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

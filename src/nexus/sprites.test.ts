import { SPRITES } from './sprites'
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

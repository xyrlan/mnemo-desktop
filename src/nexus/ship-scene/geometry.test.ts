import { bubblesOf, columns, deckLayout, G, hangarFloor, QUIET_ROW, quietRows } from './geometry'
import { captain, deck, robot } from './fixtures'

const many = (n: number, prefix: string, over = {}) => Array.from({ length: n }, (_, i) => robot(`${prefix}${i}`, over))

test('the rooms share the deck by weight right of COMMAND, which narrows on small windows', () => {
  const wide = columns(1400)
  expect(wide.cmdW).toBe(260)
  expect(wide.rooms.map((r) => r.zone)).toEqual(['flight', 'hangar', 'stranded'])
  const free = 1400 - 260
  expect(wide.rooms.map((r) => r.w)).toEqual([free * 0.56, free * 0.29, free * 0.15])
  expect(wide.rooms[0].x).toBe(260)
  expect(wide.rooms[2].x + wide.rooms[2].w).toBeCloseTo(1400, 6)
  expect(wide.rooms.map((r) => r.perRow)).toEqual([Math.floor((free * 0.56 - 10) / G.slotW), Math.floor((free * 0.29 - 10) / G.slotW), Math.floor((free * 0.15 - 10) / G.slotW)])
  expect(columns(1000).cmdW).toBe(214)
})

test('robots stand in their room in rows, from its left edge', () => {
  const l = deckLayout(deck({ flight: many(3, 'f'), stranded: many(1, 's', { zone: 'stranded', state: 'idle' }) }), 1400, false)
  const flight = l.rooms[0]
  const floor = G.labelH + G.bubbleH
  expect(l.robots.get('f0')).toEqual({ x: flight.x + 8, y: floor, zone: 'flight' })
  expect(l.robots.get('f2')).toEqual({ x: flight.x + 8 + 2 * G.slotW, y: floor, zone: 'flight' })
  expect(l.robots.get('s0')!.x).toBe(l.rooms[2].x + 8)
  const full = deckLayout(deck({ flight: many(flight.perRow + 1, 'f') }), 1400, false)
  expect(full.robots.get(`f${flight.perRow}`)).toMatchObject({ x: flight.x + 8, y: floor + G.rowH })
  expect(full.height).toBeGreaterThan(l.height)
})

test('the hangar keeps its newest on the floor and folds the rest into a stack, until it is opened', () => {
  const room = hangarFloor(columns(1400).rooms[1].perRow)
  const hangar = many(room + 3, 'h', { zone: 'hangar', state: 'done', ci: 'green' })
  hangar[room + 2] = { ...hangar[room + 2], ci: 'red' }
  const folded = deckLayout(deck({ hangar }), 1400, false)
  expect(folded.rooms[1].robots).toHaveLength(room)
  expect(folded.stack).toMatchObject({ n: 3, green: 2, open: false, hidden: [`h${room}`, `h${room + 1}`, `h${room + 2}`] })
  expect(folded.robots.has(`h${room}`)).toBe(false)
  const open = deckLayout(deck({ hangar }), 1400, true)
  expect(open.rooms[1].robots).toHaveLength(room + 3)
  expect(open.stack).toMatchObject({ n: room + 3, open: true, hidden: [] })
  // One more than the floor holds is not worth a stack.
  expect(deckLayout(deck({ hangar: hangar.slice(0, room + 1) }), 1400, false).stack).toBeNull()
})

test('a room speaks with as many bubbles as it is wide, one per ~240 px', () => {
  const l = deckLayout(deck({ flight: many(5, 'f'), hangar: many(1, 'h', { zone: 'hangar', state: 'done' }) }), 1400, false)
  expect(l.rooms[0].voices).toBe(Math.floor((l.rooms[0].w - 10) / G.voiceW))
  expect(l.rooms[1].voices).toBe(1)
  expect(l.rooms[2].voices).toBe(0)
})

test('few captains are drawn big with their topic; more stand two to a row', () => {
  const two = deckLayout(deck({ captains: [captain('a'), captain('b')] }), 1400, false)
  expect(two.captains.map((c) => c.big)).toEqual([true, true])
  const three = deckLayout(deck({ captains: [captain('a'), captain('b'), captain('c')] }), 1400, false)
  expect(three.captains.map((c) => c.big)).toEqual([false, false, false])
  expect(three.captains[2].y).toBeGreaterThan(three.captains[0].y)
  expect(deckLayout(deck({ captains: [captain('a'), captain('b')] }), 1000, false).captains[0].big).toBe(false)
})

test('bubbles hang left to right over the robots that speak, tails pointing at them', () => {
  const l = deckLayout(deck({ flight: many(4, 'f') }), 1400, false)
  const room = l.rooms[0]
  const b = bubblesOf(room, ['f3', 'f0'], l.robots)
  expect(b.map((x) => x.robotId)).toEqual(['f0', 'f3'])
  const lane = (room.w - 10) / room.voices
  expect(b[1].x).toBeCloseTo(room.x + 5 + lane, 6)
  for (const x of b) {
    expect(x.w).toBeLessThanOrEqual(230)
    expect(x.tail).toBeGreaterThanOrEqual(8)
    expect(x.tail).toBeLessThanOrEqual(x.w - 20)
  }
  expect(bubblesOf({ ...room, voices: 0 }, ['f0'], l.robots)).toEqual([])
})

test('quiet captains take as many chip rows as COMMAND needs, and the deck is tall enough for them', () => {
  expect(quietRows(0, 260)).toBe(0)
  expect(quietRows(1, 260)).toBe(1)
  expect(quietRows(7, 260)).toBe(4) // 260 px holds two 124 px chips a row
  expect(quietRows(7, 480)).toBe(3) // three a row
  const quiet = Array.from({ length: 7 }, (_, i) => captain(`q${i}`))
  const one = deckLayout(deck({ captains: [captain('a')], quiet: quiet.slice(0, 1) }), 1400, false)
  const seven = deckLayout(deck({ captains: [captain('a')], quiet }), 1400, false)
  expect(seven.height - one.height).toBe((quietRows(7, seven.cmdW) - 1) * QUIET_ROW)
})

test('quiet chips start below every captain: its console, two-line name, topic and pill (#465)', () => {
  const quiet = Array.from({ length: 8 }, (_, i) => captain(`q${i}`))
  // Two small captains in the narrow COMMAND (the drawer open): console 96, name 2 × 13.
  const narrow = deckLayout(deck({ captains: [captain('a'), captain('b')], quiet }), 860, false)
  expect(narrow.captains.map((c) => c.big)).toEqual([false, false])
  expect(narrow.quietY).toBeGreaterThanOrEqual(Math.max(...narrow.captains.map((c) => c.y)) + G.captain + 26)
  // COMMAND holds every row of chips: one a row, 44 px each.
  expect(narrow.height).toBeGreaterThanOrEqual(narrow.quietY + 8 * QUIET_ROW - 4)
  // Two big ones: and under the name a two-line topic and the action pill.
  const wide = deckLayout(deck({ captains: [captain('a'), captain('b')], quiet }), 1400, false)
  expect(wide.captains.map((c) => c.big)).toEqual([true, true])
  expect(wide.quietY).toBeGreaterThanOrEqual(wide.captains[0].y + G.captain + 26 + 26 + 23)
  // Robots that make the deck taller than COMMAND leave the chips where they are.
  const tall = deckLayout(deck({ captains: [captain('a'), captain('b')], quiet, flight: many(40, 'f') }), 860, false)
  expect(tall.height).toBeGreaterThan(narrow.height)
  expect(tall.quietY).toBe(narrow.quietY)
})

import type { Captain, Deck, ShipRobot, Zone } from '../ship-types'

/** Where everything stands, in CSS px. Every sprite is drawn at 1× (`SHIP_SPRITES`, `SPRITES`): a
 *  robot is 64, a captain 96. The numbers are the prototype's (`renderStation`). */
export const G = {
  /** The stage's margin. */
  pad: 16,
  /** One robot's floor space: its 64-px body plus room for its badge and label. */
  slotW: 74,
  /** One row of robots: the body, the label and the gap above the next. */
  rowH: 98,
  /** A room's label strip, then the strip its speech bubbles hang in. */
  labelH: 22,
  bubbleH: 86,
  robot: 64,
  captain: 96,
  /** Between decks. */
  gap: 16,
  /** One speech bubble's lane, at least. */
  voiceW: 240,
  /** The narrowest the ship draws; narrower windows scroll it sideways. */
  minWidth: 860,
} as const

export type RoomZone = Exclude<Zone, 'bridge'>
export type RoomSpec = { zone: RoomZone; label: string; hint: string; weight: number }

/** The three rooms right of COMMAND, by weight: in flight is the widest. */
export const ROOMS: RoomSpec[] = [
  { zone: 'flight', label: 'IN FLIGHT', hint: 'working on their own', weight: 0.56 },
  { zone: 'hangar', label: 'HANGAR', hint: 'ready · waiting for merge', weight: 0.29 },
  { zone: 'stranded', label: 'STRANDED', hint: 'idle 15+ min', weight: 0.15 },
]

export type Column = RoomSpec & { x: number; w: number; perRow: number }
export type Columns = { cmdW: number; rooms: Column[] }

/** COMMAND's width, then the rooms by weight, across a deck `width` wide (deck coordinates: x from
 *  the deck's left edge). Every deck shares them, so the columns line up down the ship. */
export function columns(width: number): Columns {
  const cmdW = width < 1100 ? 214 : 260
  let x = cmdW
  const rooms = ROOMS.map((r) => {
    const w = (width - cmdW) * r.weight
    const col = { ...r, x, w, perRow: Math.max(1, Math.floor((w - 10) / G.slotW)) }
    x += w
    return col
  })
  return { cmdW, rooms }
}

export type Point = { x: number; y: number }
export type CaptainSpot = Point & { captain: Captain; big: boolean }
/** The hangar's fold: `hidden` robots are in the stack; `open` draws them all and the stack folds
 *  them again. `green`: of the hidden, how many have green CI. */
export type Stack = Point & { n: number; green: number; hidden: string[]; open: boolean }
export type Bubble = { robotId: string; x: number; y: number; w: number; tail: number }
export type RoomSpot = Column & { robots: ShipRobot[]; voices: number }

export type DeckLayout = {
  width: number
  height: number
  cmdW: number
  rooms: RoomSpot[]
  captains: CaptainSpot[]
  /** Every robot drawn on the floor, by id: its top-left corner. */
  robots: Map<string, Point & { zone: RoomZone }>
  stack: Stack | null
  /** Where the first row of quiet chips starts in COMMAND: below every captain's whole figure. */
  quietY: number
}

/** Room for this many big captains (topic and action under each) in COMMAND; past it they stand two
 *  to a row, name only. */
export const bigCaptains = (cmdW: number) => (cmdW >= 250 ? 2 : 1)
/** A captain's name takes up to two lines under its console. */
const BIG_H = 186
const SMALL_ROW = 138
/** One row of quiet chips: a chip is 44 px tall (its 40-px window and border), 4 px to the next. */
export const QUIET_ROW = 48
/** Below the captains' room (console, name, topic, action pill) to the first row of quiet chips. */
const QUIET_GAP = 12
/** Under the last row of quiet chips. */
const QUIET_PAD = 10
/** A quiet captain's chip, its gap included: as many sit on one row as COMMAND is wide. */
export const QUIET_CHIP = 124

/** Rows of quiet chips COMMAND needs at this width. */
export const quietRows = (n: number, cmdW: number) => (n ? Math.ceil(n / Math.max(1, Math.floor((cmdW - 12) / QUIET_CHIP))) : 0)

/** The robots the hangar floor holds before it folds the rest into a stack: two rows, less one
 *  slot, as the stack takes two. */
export const hangarFloor = (perRow: number) => Math.max(1, perRow * 2 - 1)

const slot = (col: Column, i: number): Point => ({ x: col.x + 8 + (i % col.perRow) * G.slotW, y: G.labelH + G.bubbleH + Math.floor(i / col.perRow) * G.rowH })

/** One deck laid out `width` wide. `open`: the hangar stack is unfolded. Pure. */
export function deckLayout(deck: Deck, width: number, open: boolean): DeckLayout {
  const { cmdW, rooms: cols } = columns(width)
  const robots = new Map<string, Point & { zone: RoomZone }>()

  let stack: Stack | null = null
  const slots: number[] = []
  const rooms: RoomSpot[] = cols.map((col) => {
    let arr = deck[col.zone]
    let extra = 0
    if (col.zone === 'hangar') {
      const room = hangarFloor(col.perRow)
      if (arr.length > room + 1) {
        const hidden = open ? [] : arr.slice(room)
        if (!open) arr = arr.slice(0, room)
        const folded = open ? deck.hangar : hidden
        const i = arr.length
        stack = { ...slot(col, i), n: folded.length, green: folded.filter((r) => r.ci === 'green').length, hidden: hidden.map((r) => r.id), open }
        extra = 2
      }
    }
    arr.forEach((r, i) => robots.set(r.id, { ...slot(col, i), zone: col.zone }))
    slots.push(arr.length + extra)
    const voices = arr.length ? Math.max(1, Math.min(arr.length, Math.floor((col.w - 10) / G.voiceW))) : 0
    return { ...col, robots: arr, voices }
  })

  const big = deck.captains.length <= bigCaptains(cmdW)
  const captains: CaptainSpot[] = deck.captains.map((captain, k) => (big ? { captain, big, x: 14 + k * 122, y: 26 } : { captain, big, x: 6 + (k % 2) * 100, y: 24 + Math.floor(k / 2) * SMALL_ROW }))
  const quietY = 28 + (big ? BIG_H : Math.ceil(deck.captains.length / 2) * SMALL_ROW) + QUIET_GAP
  const cmdH = deck.quiet.length ? quietY + quietRows(deck.quiet.length, cmdW) * QUIET_ROW - 4 + QUIET_PAD : quietY
  const rows = Math.max(1, ...rooms.map((r, i) => Math.ceil(slots[i] / r.perRow)))
  const height = Math.max(G.labelH + G.bubbleH + rows * G.rowH + 4, cmdH)
  return { width, height, cmdW, rooms, captains, robots, stack, quietY }
}

/** A room's speech bubbles, left to right, under the robots that speak: `speakers` in any order.
 *  Each lane is `(w - 10) / voices` wide; the tail points at its robot. */
export function bubblesOf(room: RoomSpot, speakers: string[], at: Map<string, Point>): Bubble[] {
  if (!room.voices) return []
  const lane = (room.w - 10) / room.voices
  const w = Math.min(230, lane - 6)
  const order = speakers.filter((id) => at.has(id)).sort((a, b) => at.get(a)!.x - at.get(b)!.x)
  return order.map((robotId, k) => {
    const x = room.x + 5 + k * lane
    return { robotId, x, y: G.labelH - 2, w, tail: Math.max(8, Math.min(w - 20, at.get(robotId)!.x + 26 - x)) }
  })
}

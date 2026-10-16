import type { Pulse } from '../../pulse/store'
import type { PulseEvent, PulseKind } from '../../pulse/types'
import { norm, within } from '../../path/path'

/** mnemo's memory on the ship (issue #472, v1 spec Q22–Q23): each pulse event is a packet flying
 *  between its deck's archive and the figure of its session. Pure: what flies, to whom, what it
 *  carries and what changes when it lands. `Memory.tsx` draws it. */

/** Which way a packet flies, as its frame's colour: out of the archive (cyan), into it (violet),
 *  or enforcement's guard (white, blinking). Never a state colour. */
export type PacketDir = 'out' | 'in' | 'guard'
/** One leg: `out` archive → figure, `in` figure → archive. */
export type Leg = 'out' | 'in'
/** The 10×10 icon a packet carries (`ICONS`). */
export type PacketIcon = 'reflex' | 'catchup' | 'tool' | 'enrich' | 'friction' | 'briefing' | 'enforce'
/** What landing does: `rules` the figure's count takes the packet's slugs (and a reflex's slug
 *  floats up), `glow` the archive glows, `shake` the figure shakes. */
export type Landing = 'rules' | 'glow' | 'shake'

export type PacketSpec = {
  icon: PacketIcon
  /** The icon it carries on each leg. */
  icons: PacketIcon[]
  legs: Leg[]
  dir: PacketDir
  /** ms per leg. */
  ms: number
  landing: Landing
}

/** One leg's flight, and enforcement's, which is faster. */
export const LEG_MS = 1_200
export const GUARD_MS = 700
/** Q23: events for one figure within this long join the packet still in flight. */
export const COALESCE_MS = 5_000
/** Packets in flight at most; past it the oldest lands at once, without a flight. */
export const MAX_FLYING = 12

const out = (icon: PacketIcon, landing: Landing = 'rules'): PacketSpec => ({ icon, icons: [icon], legs: ['out'], dir: 'out', ms: LEG_MS, landing })
const inward = (icon: PacketIcon): PacketSpec => ({ icon, icons: [icon], legs: ['in'], dir: 'in', ms: LEG_MS, landing: 'glow' })

/** The packet of each kind. `enrich` flies *out*: `enrichment-log.jsonl` is the rules mnemo
 *  attached to an Edit/Write before it ran (`pulse.rs`), the agent given rules, as v1's Q22 has it;
 *  not the agent writing to memory. An MCP read (`tool`) goes asking (?) and comes back with what it
 *  read (◈). `learned` flies nothing: the archive glows longer. `dispatch` is not mnemo's memory. */
const SPECS: Partial<Record<PulseKind, PacketSpec>> = {
  reflex: out('reflex'),
  catchup: out('catchup'),
  enrich: out('enrich'),
  tool: { icon: 'tool', icons: ['tool', 'reflex'], legs: ['in', 'out'], dir: 'out', ms: LEG_MS * 0.75, landing: 'rules' },
  friction: inward('friction'),
  briefing: inward('briefing'),
  enforce: { icon: 'enforce', icons: ['enforce'], legs: ['out'], dir: 'guard', ms: GUARD_MS, landing: 'shake' },
}

export const packetOf = (kind: PulseKind): PacketSpec | null => SPECS[kind] ?? null

/** How long the archive glows: a packet coming in, or the vault learning a rule. */
export const GLOW_MS = 400
export const LEARNED_GLOW_MS = 1_200

/** The kinds that put rules in front of a figure, which its count counts: a reflex, the briefing at
 *  boot, an enrichment, and what an MCP read returned. */
const COUNTED: ReadonlySet<PulseKind> = new Set(['reflex', 'catchup', 'enrich', 'tool'])

/** A figure on the ship a packet can fly to: its session and the folder it works in. */
export type Session = { sessionId: string; cwd: string | null }

/** The session an event belongs to, among the ones on the ship; null when none of them is its. Its
 *  own `session_id` names it. An enrichment names none (`enrichment-log.jsonl` has no session):
 *  the figure whose worktree holds the file it touched is its, the deepest such worktree if they
 *  nest (`.claude/worktrees/` under a repo). */
export function sessionOf(e: PulseEvent, sessions: readonly Session[]): string | null {
  if (e.session_id) return sessions.some((s) => s.sessionId === e.session_id) ? e.session_id : null
  if (e.kind !== 'enrich' || !e.file_path) return null
  let best: Session | null = null
  for (const s of sessions) if (s.cwd && within(e.file_path, s.cwd) && (!best || norm(s.cwd).length > norm(best.cwd!).length)) best = s
  return best?.sessionId ?? null
}

/** The rules each session on the ship got, as their slugs, each once, oldest first. */
export function rulesOf(pulses: readonly Pulse[], sessions: readonly Session[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const p of pulses) {
    if (!COUNTED.has(p.event.kind)) continue
    const sid = sessionOf(p.event, sessions)
    if (!sid) continue
    const got = out.get(sid) ?? []
    for (const s of p.event.slugs) if (!got.includes(s)) got.push(s)
    out.set(sid, got)
  }
  return out
}

/** A packet in flight. `pulses`: the events it carries (Q23: `n` of them, `×N`); until it lands,
 *  their rules are not counted yet. `born`: when the first was launched. */
export type Packet = {
  id: number
  kind: PulseKind
  spec: PacketSpec
  sessionId: string
  pulses: number[]
  slugs: string[]
  n: number
  born: number
}

export type Launched = { flying: Packet[]; packet: Packet; joined: boolean; dropped: Packet[] }

/** `pulse` launched at `sessionId`: it joins the packet of its kind still flying to that figure
 *  if that one left less than `COALESCE_MS` ago, else a new packet flies, and past `MAX_FLYING` the
 *  oldest are dropped (they land without a flight). Null for a kind that flies nothing. */
export function launch(flying: readonly Packet[], pulse: Pulse, sessionId: string, id: number, now: number): Launched | null {
  const spec = packetOf(pulse.event.kind)
  if (!spec) return null
  const e = pulse.event
  const host = flying.find((p) => p.sessionId === sessionId && p.kind === e.kind && now - p.born < COALESCE_MS)
  if (host) {
    const packet = { ...host, pulses: [...host.pulses, pulse.id], slugs: [...host.slugs, ...e.slugs.filter((s) => !host.slugs.includes(s))], n: host.n + 1 }
    return { flying: flying.map((p) => (p === host ? packet : p)), packet, joined: true, dropped: [] }
  }
  const packet: Packet = { id, kind: e.kind, spec, sessionId, pulses: [pulse.id], slugs: [...new Set(e.slugs)], n: 1, born: now }
  const all = [...flying, packet]
  const cut = Math.max(0, all.length - MAX_FLYING)
  return { flying: all.slice(cut), packet, joined: false, dropped: all.slice(0, cut) }
}

/** What a packet's card says it is. */
export const KIND_LABEL: Record<PulseKind, string> = {
  reflex: 'reflex: rules for a prompt',
  catchup: 'briefing at boot',
  tool: 'MCP read',
  enrich: 'rules for an edit',
  enforce: 'enforcement blocked a command',
  friction: 'friction noted',
  briefing: 'briefing written',
  learned: 'the vault learned a rule',
  dispatch: 'dispatch',
}

/** What floats up from a figure as a reflex lands: its rule, or how many when it carried more. */
export const floatOf = (p: Pick<Packet, 'slugs'>): string => (p.slugs.length === 1 ? p.slugs[0] : `${p.slugs.length} rules`)

/** The packet icons, 10×10: `#` is #ebe3f9 and `o` #6d84e0, two colours of the sprites' own
 *  palette. From the approved prototype (`docs/superpowers/prototypes/nexus-memory/`). */
export const ICONS: Record<PacketIcon | 'learned', string[]> = {
  reflex: ['....##....', '...#..#...', '..#.##.#..', '.#.####.#.', '#.##oo##.#', '#.##oo##.#', '.#.####.#.', '..#.##.#..', '...#..#...', '....##....'],
  catchup: ['..........', '##########', '#########o', '..........', '##########', '#########o', '..........', '##########', '#########o', '..........'],
  tool: ['...####...', '..##oo##..', '..##..##..', '......##..', '.....##o..', '....##o...', '....##....', '..........', '....##....', '....##....'],
  enrich: ['.......oo.', '......o##o', '.....o##o.', '....o##o..', '...o##o...', '..o##o....', '.o##o.....', '.###......', 'o##.......', '#.........'],
  friction: ['....##....', '...####...', '...####...', '...####...', '....##....', '....##....', '....oo....', '..........', '....##....', '....##....'],
  briefing: ['....##....', '...####...', '..######..', '.########.', '...####...', '...####...', '...####...', '..........', '##########', 'oooooooooo'],
  enforce: ['....#.....', '..#.#.#...', '..#.#.#.#.', '..#.#.#.#.', '..#######.', '#.#######.', '##o######.', '.########.', '..######..', '...####...'],
  learned: ['....#.....', '....#.....', '...###....', '..##o##...', '####o####.', '..##o##...', '...###....', '....#.....', '....#.....', '..........'],
}
export const ICON_COLOURS: Record<string, string> = { '#': '#ebe3f9', o: '#6d84e0' }

/** The 1-px LEDs drawn over the 24×24 tower, whose own lights do not survive at 1×: where, and
 *  their colours in turn. */
export const LEDS: ReadonlyArray<readonly [number, number]> = [
  [7, 7],
  [7, 10],
  [7, 13],
  [8, 16],
  [10, 19],
]
export const LED_COLOURS = ['#bc4fed', '#f7f7fc', '#b0c7f1'] as const

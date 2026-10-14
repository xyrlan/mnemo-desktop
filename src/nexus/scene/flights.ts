import { samePath } from '../../path/path'
import type { Packet, PacketPath } from '../types'
import type { Point, SceneLayout } from './layout'

/** A packet placed in the scene: where it leaves from and where it goes, in scene px. */
export type Flight = {
  packet: Packet
  /** The packet's path, or `flash` when the agent it names is not drawn. */
  path: PacketPath
  archive: Point
  /** The agent's centre; the archive's for a flash. */
  agent: Point
}

/** Where `p` travels (spec Q22): between its territory's archive and its agent. A robot past the
 *  ring's 15 travels to its nexus; an agent the world no longer holds turns the packet into a flash
 *  on the archive, so the event still shows. Null when its territory is not drawn. */
export function flightOf(p: Packet, layout: SceneLayout): Flight | null {
  const t = layout.territories.find((t) => samePath(t.territory.root, p.root))
  if (!t) return null
  let agent: Point | null = null
  const a = p.agent
  if (a && p.path !== 'flash') {
    for (const n of t.nexuses) {
      if (a.kind === 'nexus' && n.nexus.sessionId === a.id) agent = n
      if (a.kind !== 'robot') continue
      const drawn = n.robots.find((r) => r.robot.id === a.id)
      if (drawn) agent = { x: drawn.cx, y: drawn.cy }
      else if (n.nexus.robots.some((r) => r.id === a.id)) agent = n
    }
  }
  const archive = { x: t.archive.x, y: t.archive.y }
  if (!agent) return { packet: p, path: 'flash', archive, agent: archive }
  return { packet: p, path: p.path, archive, agent: { x: agent.x, y: agent.y } }
}

/** Where a packet rests when motion is reduced: the end it was going to. */
export const restOf = (f: Flight): Point => (f.path === 'to-agent' || f.path === 'round-trip' ? f.agent : f.archive)

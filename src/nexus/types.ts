/** The Nexus: the fleet drawn as a sci-fi world (spec `docs/superpowers/specs/2026-10-14-nexus-design.md`).
 *  Every repo is a territory, every live session that is not a dispatched child is a nexus, every
 *  child is a robot around its parent's nexus, and every territory has an archive (its project's
 *  vault). The shapes below are the round's contract: no piece edits this file. A type that does
 *  not fit is a question for the parent session, not an edit. */
import type { ChildSession, ParentSession } from '../mission/types'

/** The robot's chassis, from the child's model (spec Q3/Q13): opus is a heavy mech, sonnet a droid,
 *  haiku a drone. `unknown` when neither `respawnFlags` nor the transcript names a model. */
export type RobotClass = 'mech' | 'droid' | 'drone' | 'unknown'

/** From `--effort`: 0 is the default (no aura), then low … max. */
export type Level = 0 | 1 | 2 | 3 | 4

/** How many identity accessories the sprite sheet has; `Robot.accessory` is in `[0, ACCESSORIES)`. */
export const ACCESSORIES = 6

/** The state colour, drawn as a halo (spec Q11): one of the four `--state-*` tokens, or none. */
export type Halo = 'working' | 'needs-you' | 'done' | 'idle' | null

/** What the robot's body does (spec Q18). Arrival is not a pose: a robot that appears in the world
 *  is drawn warping in from its nexus. */
export type RobotPose = 'working' | 'idle' | 'waiting' | 'sleeping'

/** The icon over the robot's head (spec Q18). `alert` is "needs you"; `zzz` a rate-limit stall;
 *  `flag-pending` an open PR whose checks run; `flag-ready` an open PR whose checks passed;
 *  `flag-draft` a draft PR, whatever its checks do short of failing; `fire` failing checks or a
 *  conflict. */
export type Badge = 'alert' | 'zzz' | 'flag-pending' | 'flag-ready' | 'flag-draft' | 'fire' | null

/** Why a robot leaves (spec Q12): `merged` celebrates and warps out; `powered-down` (stopped
 *  without a PR, once its parent has its notice) switches off and fades. A robot with an exit is
 *  still in the world so the scene can play it; the world drops it afterwards. */
export type Exit = 'merged' | 'powered-down' | null

export type Robot = {
  /** The child's short job id. */
  id: string
  sessionId: string | null
  /** `#643` from a `<repo>-wt-<issue>` worktree, else the contract piece, else the short id. */
  label: string
  klass: RobotClass
  level: Level
  /** Seeded from `id`: the same child wears the same accessory all day. */
  accessory: number
  pose: RobotPose
  halo: Halo
  badge: Badge
  exit: Exit
  /** The tool it is running now (`Bash`, `Edit`, `Read`…), when the timeline says. */
  tool: string | null
  /** The snapshot row, for the hover card. */
  child: ChildSession
}

/** The parent session's state (spec Q18): `dead` is a parent no longer alive whose children still
 *  are — known only through them. */
export type NexusPose = 'busy' | 'waiting' | 'idle' | 'dead'

export type Nexus = {
  sessionId: string
  label: string
  cwd: string
  pose: NexusPose
  halo: Halo
  robots: Robot[]
  /** The `claude agents` row; null for a dead parent. */
  parent: ParentSession | null
}

/** 0 small, 1 grown, 2 full: from the number of live pages (spec Q21). */
export type Tier = 0 | 1 | 2

/** A territory's archive: its project's vault. `project` is the name the vault's logs use. */
export type Archive = { project: string; pages: number; tier: Tier }

/** Live pages per project and the universal (shared) count: what `nexus_archives` returns. */
export type ArchiveCounts = { projects: Record<string, number>; universal: number }

export type Territory = {
  /** The repo's root (main checkout); its `<repo>-wt-*` worktrees fold into it. */
  root: string
  name: string
  archive: Archive
  nexuses: Nexus[]
}

export type World = {
  territories: Territory[]
  /** The core in the middle: the universal rules every project shares. */
  universal: { pages: number; tier: Tier }
  at: number
}

/** A memory event made visible (spec Q22). */
export type PacketKind = 'catchup' | 'reflex' | 'read' | 'enrich' | 'friction' | 'briefing' | 'learned'

/** Which way the packet travels: archive → agent, agent → archive, there and back, or only the
 *  archive glows (an event no agent can be named for). */
export type PacketPath = 'to-agent' | 'to-archive' | 'round-trip' | 'flash'

export type Packet = {
  /** Stable across polls: the scene keys on it so a packet plays once. */
  id: string
  kind: PacketKind
  path: PacketPath
  /** The agent it travels to or from; null with `flash`. */
  agent: { kind: 'robot' | 'nexus'; id: string } | null
  /** The territory whose archive it leaves from or reaches (`Territory.root`). */
  root: string
  /** Events coalesced into it (spec Q23): drawn as `×count` when above 1. */
  count: number
  slugs: string[]
  at: number
}

/** One drawable: a horizontal strip of `frames` frames, each `w`×`h` pixels, played at `fps`
 *  (1 frame, any fps, is a still). Drawn at an integer scale with `image-rendering: pixelated`. */
export type SpriteSheet = { src: string; w: number; h: number; frames: number; fps: number }

/** Every sprite the scene draws. The placeholder set ships first; the final art replaces the files
 *  and this manifest's values, never its shape. Badges are drawn in code, not here. */
export type SpriteManifest = {
  robots: Record<RobotClass, Record<RobotPose, SpriteSheet>>
  /** `ACCESSORIES` overlays, drawn on top of the robot at the same size. */
  accessories: SpriteSheet[]
  nexus: Record<NexusPose, SpriteSheet>
  archive: Record<Tier, SpriteSheet>
  universal: SpriteSheet
  packet: SpriteSheet
}

/** What the scene hands a click or a hover to. */
export type Target = { kind: 'nexus'; nexus: Nexus } | { kind: 'robot'; robot: Robot } | { kind: 'archive'; archive: Archive; root: string }

/** Nexus v2's shared types (`docs/superpowers/specs/2026-10-15-nexus-v2-design.md`): the round's
 *  contract (`docs/superpowers/contracts/2026-10-15-nexus-v2.md`). No piece edits this file; a type
 *  that does not fit is a question for the parent session. */

import type { ReactNode } from 'react'
import type { AgentState, WaitingFor } from '../fleet/types'
import type { ErrorSource } from '../mission/errors'
import type { ChildSession, Mission, ParentSession, Pr, Snapshot } from '../mission/types'
import type { PulseEvent } from '../pulse/types'
import type { Pulse } from '../pulse/store'
import type { Levels } from './ship-scene/Memory'
import type { MenuTarget } from './ui/menus'

// ------------------------------------------------------------------ the feed --
// What `nexus_feed` adds to the snapshot, read from each session's transcript and job.
// Times are epoch ms.

/** The last tool call. `running`: its result has not arrived yet (a CI watch, a full suite). */
export type Activity = { tool: string; target: string; at: number; running: boolean }
/** The last assistant text, whole. */
export type Said = { text: string; at: number }
/** A contract piece, parsed from the child's full dispatch intent: `one piece of the feature "X":
 *  piece` and every `from the piece \`y\``. */
export type ContractRef = { feature: string; piece: string; consumes: string[] }
/** An `AskUserQuestion` still unanswered: the question and its options, in order. */
export type Ask = { question: string; options: string[] }

export type SessionFeed = {
  activity: Activity | null
  said: Said | null
  /** input + cache_read + cache_creation tokens of the last API call: how full the context is. */
  context: number | null
  /** The model of the last assistant message: the answer when the snapshot's `model` is null. */
  model: string | null
  /** Parents: the latest user prompt, at most 200 characters. Null for children. */
  topic: string | null
  /** Parents: what the session is called, at most 200 characters: the name a person gave it
   *  (`custom-title`: `/rename`, `claude --name`), else Claude Code's latest `ai-title`. Null for
   *  children, and when the transcript has neither. */
  title: string | null
  /** Children dispatched from a contract. Null otherwise. */
  contract: ContractRef | null
  ask: Ask | null
}

export type CheckRun = { name: string; startedAt: number | null; completedAt: number | null; conclusion: string | null }
/** A PR's real fate: when it merged or closed, and when each check of its last run ran. */
export type PrFate = { state: 'OPEN' | 'MERGED' | 'CLOSED'; mergedAt: number | null; closedAt: number | null; checks: CheckRun[] }
/** Across every session the feed was asked about, over the last 5 minutes. */
export type FleetRate = { callsPerMin: number; outPerMin: number; inPerMin: number; cacheShare: number }

/** `sessions` is keyed by `FeedAsk.key`, `prs` by PR url. */
export type Feed = { sessions: Record<string, SessionFeed>; prs: Record<string, PrFate>; rate: FleetRate | null; at: number }

/** One session the feed reads. `key`: a child's `id`, a parent's `session_id`. `account`: the
 *  account id the session runs on (the feed resolves its config dir). `jobId`: a child's short id. */
export type FeedAsk = { key: string; sessionId: string; cwd: string; account: string; jobId: string | null; prUrl: string | null }

// ------------------------------------------------------------------ the ship --

/** The robot's chassis, from the child's model: opus is a heavy mech, sonnet a droid, haiku a
 *  drone. `unknown` when neither the snapshot nor the transcript names a model. */
export type RobotClass = 'mech' | 'droid' | 'drone' | 'unknown'
/** What a robot's body does: the sprite drawn for it. */
export type RobotPose = 'working' | 'idle' | 'waiting' | 'sleeping'
/** How many identity accessories the sprite sheet has; `ShipRobot.accessory` is in `[0, ACCESSORIES)`. */
export const ACCESSORIES = 6

/** Where a robot stands: the room says whether you are needed, never what it is doing. */
export type Zone = 'flight' | 'hangar' | 'stranded' | 'bridge'
export type RobotState = 'working' | 'idle' | 'need' | 'done' | 'stopped'
/** What a working robot does, shown by the prop it holds: read · edit · test · ship · run (a long command). */
export type ActionKind = 'read' | 'edit' | 'test' | 'ship' | 'run'
/** CI on a finished robot's PR at this moment: queued, running, green, red; null without checks. */
export type Ci = 'wait' | 'run' | 'green' | 'red' | null
/** A blocked robot's pending decision. `options`: an `AskUserQuestion`'s, or a permission's
 *  `yes` / `always` / `no`. */
export type Need = { kind: 'question' | 'permission'; text: string; options: string[] }

export type ShipRobot = {
  /** The child's `id` (its short id). */
  id: string
  sessionId: string | null
  child: ChildSession
  /** The captain it stands under: its parent's session id, or `orphanCaptainId(root)`. */
  captainId: string
  /** `#682`, `#404·a`; a contract piece's name; else the short id. */
  label: string
  /** For a grandchild: the label of the child that dispatched it (`↳#661`). */
  via: string | null
  klass: RobotClass
  /** `[0, ACCESSORIES)`, seeded from the id. */
  accessory: number
  state: RobotState
  zone: Zone
  /** Null unless `state` is `working`. */
  action: ActionKind | null
  ci: Ci
  pr: Pr | null
  fate: PrFate | null
  /** What it says: the child's own `detail`, else its last assistant sentence. */
  line: string
  /** The line under it: the current tool, `idle for 6 min`, `running for 9 min · Bash …`. */
  act: string | null
  /** Since its last action, ms. */
  idleMs: number
  context: number | null
  model: string | null
  contract: ContractRef | null
  /** `a`, `b`, … among its captain's children that share its issue; null when it has no twin. */
  twin: string | null
  need: Need | null
  /** Rule slugs mnemo injected into the session, newest first. */
  injected: string[]
}

/** `empty`: no recorded parent; drawn as an empty command chair. */
export type CaptainPose = 'busy' | 'idle' | 'alert' | 'offline' | 'empty'

export type Captain = {
  /** The parent's session id, or `orphanCaptainId(root)`. */
  id: string
  parent: ParentSession | null
  /** The feed's `title` (the name a person gave the session, else its AI title); else Home's
   *  title (its first prompt), its `claude agents` name, `session <id>`. */
  name: string
  /** ◆ ● ▲ ■ ★ ✚ ♦ ✦ in order of first sight within the repo; `?` for the empty chair. */
  emblem: string
  pose: CaptainPose
  /** Its latest user prompt. */
  topic: string | null
  /** Its last tool or sentence while busy. */
  action: string | null
  /** Children whose finish notice waits for its next prompt (`notice: 'held'`). */
  notices: number
}

export const orphanCaptainId = (root: string) => `orphan:${root}`

/** One per repo root with a live child. `<repo>-wt-*` worktrees fold into their repo. `captains`:
 *  those with a child on this deck or busy; `quiet`: the repo's other live parents. `hangar`: newest
 *  first. `hangarReady`: a green PR waits in it. */
export type Deck = {
  root: string
  name: string
  captains: Captain[]
  quiet: Captain[]
  flight: ShipRobot[]
  hangar: ShipRobot[]
  stranded: ShipRobot[]
  hangarReady: boolean
}

/** A repo with live parents and no child. */
export type Dock = { root: string; name: string; captains: Captain[] }

export type Exception =
  | { kind: 'need'; robotId: string; need: Need }
  | { kind: 'red'; robotId: string; pr: Pr }
  | { kind: 'ready'; robotId: string; pr: Pr; waitingMs: number }
  | { kind: 'land'; root: string; mission: Mission }
  | { kind: 'stranded'; robotId: string; idleMs: number }
  | CaptainNeed
  | SnapshotException

/** A read the snapshot could not make (`mission/errors`, #367): what failed and what to do
 *  (`text`), and the line as the backend said it (`detail`). `source`: the data it leaves out, so
 *  an empty ship is not taken for a quiet one. */
export type SnapshotException = { kind: 'snapshot'; source: ErrorSource; text: string; detail: string }

/** A captain (a parent session) waiting on you, as the fleet sees it (`waitingFor`): what the
 *  sidebar's needs-you count counts. `question`: the feed's `ask`, when it has one. `since`: its
 *  last action, when it began waiting, if the feed dates it. `lines`: its last tool call and
 *  sentence, newest last. */
export type CaptainNeed = { kind: 'captain'; captainId: string; waitsOn: 'permission' | 'question'; question: string | null; since: number | null; lines: string[] }

/** `need`: robots and captains waiting on you. */
export type ShipCounts = { working: number; need: number; ready: number }

/** `bridge.exceptions`: need and captain (longest wait first, together), red, land, ready (longest
 *  wait first), stranded (longest first), then what the snapshot could not read.
 *  `bridge.blocked`: every robot whose zone is `bridge`. Decks in a fixed order: most children over
 *  the session first, then by name. */
export type Ship = {
  bridge: { exceptions: Exception[]; blocked: ShipRobot[] }
  decks: Deck[]
  docks: Dock[]
  counts: ShipCounts
  rate: FleetRate | null
  at: number
}

/** What the fleet module knows about a session, fused with live hook events: the one answer to
 *  "is it busy" (`src/fleet/model.ts`), keyed by session id. `title`: its pane's tab title. */
export type AgentView = { state: AgentState; waitingFor: WaitingFor; title: string }

/** `firstSeen`: session id → epoch ms the view first saw it; it keeps emblems and deck order
 *  steady while the app runs. */
export type ShipInput = {
  snapshot: Snapshot
  feed: Feed | null
  agents: Record<string, AgentView>
  events: PulseEvent[]
  firstSeen: Record<string, number>
  now: number
}

// ------------------------------------------------------------------ the log --

export type LogKind = 'dispatched' | 'pr-opened' | 'ci-green' | 'ci-red' | 'merged' | 'closed' | 'finished' | 'stranded' | 'blocked' | 'rule' | 'you'
/** A milestone in the ship's log. `id` is stable, so a milestone is never logged twice. */
export type LogEvent = { id: string; at: number; kind: LogKind; robotId: string | null; captainId: string | null; text: string }

// --------------------------------------------------------------- what you do --

export type ShipAction =
  | { kind: 'open'; id: string }
  | { kind: 'answer'; robotId: string; text: string }
  | { kind: 'merge'; robotIds: string[] }
  | { kind: 'land'; root: string; feature: string }
  | { kind: 'stop'; robotIds: string[] }
  | { kind: 'message'; ids: string[]; text: string }
  | { kind: 'dispatch'; root: string; issues: number[] }

/** What happened, for the bridge's output line, and what to append to the log. */
export type ActionResult = { ok: boolean; say: string; log: LogEvent[] }

/** A line typed at the fleet's command line. `confirm`: a batch verb waiting for `/yes`. */
export type Parsed = { action: ShipAction } | { confirm: ShipAction; prompt: string } | { yes: true } | { error: string }

// ------------------------------------------------------------- component props --

export type ShipSceneProps = {
  ship: Ship
  log: LogEvent[]
  /** The session open in the drawer's active tab: its figure is highlighted and scrolled to. */
  focusId: string | null
  selection: ReadonlySet<string>
  /** A click on a captain or a robot. */
  onOpen(id: string): void
  /** Shift+click on a robot. */
  onSelect(id: string): void
  /** An exception's button, an inline answer. */
  onAction(action: ShipAction): void
  /** The `! N need you` chip. */
  onTriage(): void
  /** A right-click on a captain, a robot, a deck or a dock, or the bar's SYSTEMS button: the view
   *  opens the menu at (x, y), in viewport px. */
  onMenu(target: MenuTarget, x: number, y: number): void
  /** The fleet's command line while it is open (`/`, the bridge's `/ commands`): it floats over
   *  the bridge's top edge. Null while closed: the bridge holds no input. */
  command: ReactNode
  /** The bridge's `/ commands` hint: opens the command line. */
  onCommand(): void
  reducedMotion: boolean
  visible: boolean
  /** mnemo's events as the app received them (`pulseStore`): each new one flies as a packet
   *  between its deck's archive and its session's figure. */
  pulses?: readonly Pulse[]
  /** Each project's level by name, beside its deck's archive (#478): null until read, `'none'`
   *  with no vault. */
  levels?: Levels
}

export type FleetPromptProps = {
  ship: Ship
  /** Every repo `/new` takes besides the ship's (`useKnownRepos`). */
  repos?: readonly { root: string; name: string }[]
  /** Runs an action and returns what to print under the line. */
  run(action: ShipAction): Promise<ActionResult>
  /** Whether the line is shown. Closed, it keeps what it holds: a batch waiting for `/yes`. */
  open: boolean
  /** Esc, a click outside it. */
  onClose(): void
}

export type TriageProps = {
  ship: Ship
  open: boolean
  onClose(): void
  onOpen(id: string): void
  run(action: ShipAction): Promise<ActionResult>
}

export type SelectionBarProps = {
  ship: Ship
  selection: ReadonlySet<string>
  onClear(): void
  run(action: ShipAction): Promise<ActionResult>
}

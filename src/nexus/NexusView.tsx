import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/ui'
import { STATUS_BAR, TOP_CHROME } from '../shell/edges'
import { useFleet } from '../fleet/store'
import type { RepoNode } from '../fleet/types'
import { useMission } from '../mission/app-store'
import type { Snapshot } from '../mission/types'
import { usePulse } from '../pulse/app-store'
import type { PulseEvent } from '../pulse/types'
import { pollWhileShown } from '../shell/while-shown'
import type { NexusClient } from './client'
import { runAction } from './command/actions'
import { FleetPrompt } from './command/FleetPrompt'
import { SelectionBar } from './command/SelectionBar'
import { Triage } from './command/Triage'
import { liveDrawer } from './drawer/app'
import { NexusDrawer, useShownWidth, type DrawerDeps } from './drawer/Drawer'
import { openingOf } from './drawer/model'
import { useReducedMotion, useVisible } from './env'
import { logEvents } from './log'
import { buildShip } from './ship'
import { asksFrom, type ShipClient } from './ship-client'
import type { ActionResult, AgentView, Feed, Ship, ShipAction } from './ship-types'
import { ShipScene } from './ShipScene'
import { nexusStore, useNexus } from './store'
import { startNexusUsage } from './usage'

/** How often the feed is read while the Nexus is shown. */
export const FEED_MS = 3_000
/** How often idle times move on when nothing else changed. */
const CLOCK_MS = 5_000

/** The fleet module's answer per session, fused with live hook events: the one "is it busy". */
export function agentsOf(repos: RepoNode[]): Record<string, AgentView> {
  const out: Record<string, AgentView> = {}
  for (const r of repos) for (const w of r.worktrees) for (const a of w.agents) out[a.sessionId] = { state: a.state, waitingFor: a.waitingFor, title: a.title }
  return out
}

/** Every session id the snapshot holds, so `firstSeen` can date them. */
function sessionIds(snap: Snapshot): string[] {
  const ids: string[] = []
  for (const r of snap.repos) {
    for (const p of r.parents) ids.push(p.session_id)
    for (const c of r.children) ids.push(c.session_id ?? c.id)
    for (const m of r.missions) for (const p of m.pieces) if (p.child) ids.push(p.child.session_id ?? p.child.id)
  }
  return ids
}

/** A refused action from the ship (an exception's button, an inline answer) says why; what went
 *  through is in the log. */
function sayFailure(r: ActionResult) {
  if (!r.ok) toast.error(r.say || 'That did not go through.')
}

type BodyProps = {
  client: ShipClient
  usage: NexusClient
  /** Opens a captain or a robot in the drawer. */
  onOpen(id: string): void
  /** The ship and feed each time they are built, for the drawer beside it. */
  onShip(ship: Ship, feed: Feed | null): void
}

function ShipBody({ client, usage, onOpen, onShip }: BodyProps) {
  const snapshot = useMission((s) => s.snapshot)
  const repos = useFleet((f) => f.repos)
  const pulse = usePulse((s) => s.log)
  const log = useNexus((s) => s.log)
  const selection = useNexus((s) => s.selection)
  const triage = useNexus((s) => s.triage)
  const triageAsked = useNexus((s) => s.triageAsked)
  const focusId = useNexus((s) => s.focusId)
  const reducedMotion = useReducedMotion()
  const visible = useVisible()
  // The last feed read, also by an earlier mount: reopened, the ship is drawn with it.
  const feed = useNexus((s) => s.feed)
  /** A feed was read since this mount: until then the ship may be older than the snapshot. */
  const fed = useRef(false)
  const [now, setNow] = useState(() => Date.now())

  const asks = useMemo(() => asksFrom(snapshot), [snapshot])
  const asksRef = useRef(asks)
  asksRef.current = asks
  useEffect(() => {
    let live = true
    const stop = pollWhileShown(async () => {
      const f = await client.feed(asksRef.current).catch(() => null)
      if (!live || !f) return
      fed.current = true
      nexusStore.getState().setFeed(f)
    }, FEED_MS)
    return () => {
      live = false
      stop()
    }
  }, [client])
  useEffect(() => pollWhileShown(() => setNow(Date.now()), CLOCK_MS), [])
  useEffect(() => setNow(Date.now()), [snapshot, feed, pulse])
  useEffect(() => startNexusUsage((row) => void usage.logUsage(row).catch(() => {}), Date.now), [usage])

  const firstSeen = useRef<Record<string, number>>({})
  for (const id of sessionIds(snapshot)) firstSeen.current[id] ??= now

  const agents = useMemo(() => agentsOf(repos), [repos])
  const events: PulseEvent[] = useMemo(() => pulse.map((p) => p.event), [pulse])
  const ship = useMemo(() => buildShip({ snapshot, feed, agents, events, firstSeen: { ...firstSeen.current }, now }), [snapshot, feed, agents, events, now])

  const shipRef = useRef(ship)
  shipRef.current = ship
  useEffect(() => onShip(ship, feed), [onShip, ship, feed])
  // No milestone is logged from a ship built before this mount's first feed: a child deep in a CI
  // watch would read as stranded, and the log would keep that for good.
  const prev = useRef<Ship | null>(null)
  useEffect(() => {
    if (!fed.current) return
    nexusStore.getState().appendLog(logEvents(prev.current, ship, now))
    prev.current = ship
  }, [ship, now])

  // Triage asked for from the sidebar opens only on cards to triage: with none, the Nexus alone.
  useEffect(() => {
    if (triageAsked) nexusStore.getState().settleTriageAsk(ship.counts.need)
  }, [triageAsked, ship])

  // Opening is the view's (the drawer's); every other action is the command piece's.
  const run = useCallback(
    async (a: ShipAction): Promise<ActionResult> => {
      if (a.kind === 'open') {
        onOpen(a.id)
        return { ok: true, say: '', log: [] }
      }
      const r = await runAction(a, shipRef.current)
      nexusStore.getState().appendLog(r.log)
      return r
    },
    [onOpen],
  )
  const s = nexusStore.getState()

  // The view's keys, while it is open and nothing typed into has focus: Tab triages, ⌥1–9 opens the
  // bridge's Nth exception (⌘1–9 are the worktrees'), `/` focuses the fleet prompt, Esc drops the
  // selection, or else collapses the drawer (a tab's terminal has focus: Esc is its program's). The
  // app's chords (`actions/keys.ts`) run first, in the capture phase, and the drawer's (⌘\, Esc
  // on its quick diff) next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('[role="dialog"][data-state="open"]')) return
      const st = nexusStore.getState()
      const digit = /^Digit([1-9])$/.exec(e.code)
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && shipRef.current.counts.need > 0) st.setTriage(true)
      else if (digit && e.altKey && !e.metaKey && !e.ctrlKey && navigator.platform.toLowerCase().includes('mac')) {
        const x = shipRef.current.bridge.exceptions[Number(digit[1]) - 1]
        const id = !x ? null : x.kind === 'captain' ? x.captainId : 'robotId' in x ? x.robotId : null
        if (!id) return
        onOpen(id)
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const input = document.querySelector<HTMLInputElement>('[data-fleet-prompt] input')
        if (!input) return
        input.focus()
      } else if (e.key === 'Escape' && st.selection.size) st.clearSelection()
      else if (e.key === 'Escape' && st.tabs.length && !st.collapsed) st.setCollapsed(true)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onOpen])

  return (
    <>
      <ShipScene
        ship={ship}
        log={log}
        focusId={focusId}
        selection={selection}
        onOpen={onOpen}
        onSelect={s.toggleSelect}
        onAction={(a) => void run(a).then(sayFailure, (e: unknown) => toast.error(String(e)))}
        onTriage={() => s.setTriage(true)}
        bridge={<FleetPrompt ship={ship} run={run} />}
        reducedMotion={reducedMotion}
        visible={visible}
      />
      <Triage ship={ship} open={triage} onClose={() => s.setTriage(false)} onOpen={onOpen} run={run} />
      <SelectionBar ship={ship} selection={selection} onClear={s.clearSelection} run={run} />
    </>
  )
}

export type NexusViewProps = {
  client: ShipClient
  /** For `startNexusUsage`'s rows. */
  usage: NexusClient
  /** Where the left sidebar ends, in px: the Nexus covers the workbench from there. */
  leftEdge: number
  /** The drawer's sessions, views and diff; the app's by default. */
  drawer?: DrawerDeps
}

/** The Nexus: a full-window view over the workbench, from the left sidebar's edge (v2 spec, "Where
 *  it sits in the app"). Nothing is read, polled or animated while it is closed. The drawer sits
 *  beside the ship, which shrinks while it is open; the drawer stays mounted, hidden, while the
 *  Nexus is closed, so its tabs keep their terminals. */
export function NexusView({ client, usage, leftEdge, drawer = liveDrawer }: NexusViewProps) {
  const open = useNexus((s) => s.open)
  const tabs = useNexus((s) => s.tabs.length)
  const collapsed = useNexus((s) => s.collapsed)
  const width = useShownWidth()
  const [built, setBuilt] = useState<{ ship: Ship; feed: Feed | null } | null>(null)
  const onShip = useCallback((ship: Ship, feed: Feed | null) => setBuilt({ ship, feed }), [])
  const repos = useFleet((f) => f.repos)
  const reposRef = useRef(repos)
  reposRef.current = repos
  const builtRef = useRef(built)
  builtRef.current = built
  // A click on a figure, an exception's open, ⌥1–9, a breadcrumb: its tab, held as it opens.
  const onOpen = useCallback(
    (id: string) => {
      const o = openingOf(id, builtRef.current?.ship ?? null, reposRef.current, drawer.paneOfSession)
      if (o) drawer.drawer.open(o.tab, o.ref)
    },
    [drawer],
  )
  const beside = open && tabs > 0 && !collapsed ? width : 0
  return (
    <>
      {open && (
        <div
          data-nexus-view=""
          className="fixed z-drawer flex flex-col overflow-hidden bg-worktree-sidebar"
          style={{ left: leftEdge, right: beside, top: TOP_CHROME, bottom: STATUS_BAR }}
        >
          <ShipBody client={client} usage={usage} onOpen={onOpen} onShip={onShip} />
        </div>
      )}
      <NexusDrawer deps={drawer} ship={built?.ship ?? null} feed={built?.feed ?? null} repos={repos} shown={open} onOpen={onOpen} />
    </>
  )
}

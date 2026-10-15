import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATUS_BAR, TOP_CHROME } from '../dashboard/AgentDashboardDrawer'
import { useFleet } from '../fleet/store'
import type { RepoNode } from '../fleet/types'
import { useMission } from '../mission/app-store'
import { attachChild } from '../mission/rows'
import type { Snapshot } from '../mission/types'
import { usePulse } from '../pulse/app-store'
import type { PulseEvent } from '../pulse/types'
import { pollWhileShown } from '../shell/while-shown'
import { openNexus } from './actions'
import type { NexusClient } from './client'
import { runAction } from './command/actions'
import { FleetPrompt } from './command/FleetPrompt'
import { SelectionBar } from './command/SelectionBar'
import { Triage } from './command/Triage'
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

const robotsOf = (ship: Ship) => [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]
const captainsOf = (ship: Ship) => [...ship.decks.flatMap((d) => [...d.captains, ...d.quiet]), ...ship.docks.flatMap((d) => d.captains)]

/** Until the drawer lands (wave 2): a robot is attached in a new tab, a captain is revealed where
 *  its pane is, as v1 did. */
function openInterim(id: string, ship: Ship) {
  const robot = robotsOf(ship).find((r) => r.id === id)
  if (robot) return attachChild(robot.child)
  const cap = captainsOf(ship).find((c) => c.id === id)
  if (cap?.parent) openNexus({ sessionId: cap.parent.session_id, label: cap.name, cwd: cap.parent.cwd, pose: 'idle', halo: null, robots: [], parent: cap.parent })
}

function ShipBody({ client, usage }: { client: ShipClient; usage: NexusClient }) {
  const snapshot = useMission((s) => s.snapshot)
  const repos = useFleet((f) => f.repos)
  const pulse = usePulse((s) => s.log)
  const log = useNexus((s) => s.log)
  const selection = useNexus((s) => s.selection)
  const triage = useNexus((s) => s.triage)
  const focusId = useNexus((s) => s.focusId)
  const reducedMotion = useReducedMotion()
  const visible = useVisible()
  const [feed, setFeed] = useState<Feed | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const asks = useMemo(() => asksFrom(snapshot), [snapshot])
  const asksRef = useRef(asks)
  asksRef.current = asks
  useEffect(() => {
    let live = true
    const stop = pollWhileShown(async () => {
      const f = await client.feed(asksRef.current).catch(() => null)
      if (live && f) setFeed(f)
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
  const prev = useRef<Ship | null>(null)
  useEffect(() => {
    nexusStore.getState().appendLog(logEvents(prev.current, ship, now))
    prev.current = ship
  }, [ship, now])

  // Opening is the view's (the drawer's, from wave 2); every other action is the command piece's.
  const run = useCallback(async (a: ShipAction): Promise<ActionResult> => {
    if (a.kind === 'open') {
      openInterim(a.id, shipRef.current)
      return { ok: true, say: '', log: [] }
    }
    const r = await runAction(a, shipRef.current)
    nexusStore.getState().appendLog(r.log)
    return r
  }, [])
  const onOpen = useCallback((id: string) => openInterim(id, shipRef.current), [])
  const s = nexusStore.getState()

  // The view's keys, while it is open and nothing typed into has focus: Tab triages, ⌥1–9 opens the
  // bridge's Nth exception (⌘1–9 are the worktrees'), `/` focuses the fleet prompt, Esc drops the
  // selection. The app's chords (`actions/keys.ts`) run first, in the capture phase.
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
        if (!x || !('robotId' in x)) return
        onOpen(x.robotId)
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const input = document.querySelector<HTMLInputElement>('[data-fleet-prompt] input')
        if (!input) return
        input.focus()
      } else if (e.key === 'Escape' && st.selection.size) st.clearSelection()
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
        onAction={(a) => void run(a)}
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
}

/** The Nexus: a full-window view over the workbench, from the left sidebar's edge (v2 spec, "Where
 *  it sits in the app"). Nothing is read, polled or animated while it is closed. */
export function NexusView({ client, usage, leftEdge }: NexusViewProps) {
  const open = useNexus((s) => s.open)
  if (!open) return null
  return (
    <div
      data-nexus-view=""
      className="fixed z-drawer flex flex-col overflow-hidden bg-worktree-sidebar"
      style={{ left: leftEdge, right: 0, top: TOP_CHROME, bottom: STATUS_BAR }}
    >
      <ShipBody client={client} usage={usage} />
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@/ui'
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
import { setFigures } from './outside'
import { buildShip } from './ship'
import { asksFrom, type ShipClient } from './ship-client'
import type { ActionResult, AgentView, Feed, Ship, ShipAction } from './ship-types'
import { ShipScene } from './ShipScene'
import { useKnownRepos } from './repos'
import { nexusStore, useNexus } from './store'
import { startNexusUsage } from './usage'
import { NexusMenu } from './ui/Menu'
import { menuFor, type MenuItem, type MenuTarget } from './ui/menus'
import { WindowHost } from './ui/Window'
import { ConfirmHost } from './ui/confirm'
import { closeWindow, openWindow, windowsIn } from './ui/windows'
import { useVaultLevel } from './windows/memory/Level'

/** The SYSTEMS menu: every window registered in that group, in its order. */
const systemsItems = (): MenuItem[] => windowsIn('systems').map((d) => ({ id: d.id, label: d.title, run: () => openWindow(d.id) }))

/** What a menu is titled: the figure's, the deck's or the dock's name. */
function menuHead(t: MenuTarget, ship: Ship): string | undefined {
  if (t.kind === 'systems') return undefined
  if (t.kind === 'deck' || t.kind === 'dock') return [...ship.decks, ...ship.docks].find((d) => d.root === t.id)?.name
  const robots = [...ship.bridge.blocked, ...ship.decks.flatMap((d) => [...d.flight, ...d.hangar, ...d.stranded])]
  const captains = [...ship.decks.flatMap((d) => [...d.captains, ...d.quiet]), ...ship.docks.flatMap((d) => d.captains)]
  return t.kind === 'robot' ? robots.find((r) => r.id === t.id)?.label : captains.find((c) => c.id === t.id)?.name
}

/** What is open over the ship and keeps its keys: Triage, a window, the accounts' list (dialogs, open),
 *  a confirmation, a menu. */
const OVER_THE_SHIP = '[role="dialog"][data-state="open"], [role="alertdialog"], [role="menu"][data-nx-menu]'

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
  /** Opens a captain or a robot in the drawer; false when the ship has no such figure. */
  onOpen(id: string): boolean
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
  const focusId = useNexus((s) => s.focusId)
  const known = useKnownRepos()
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
  // The vault's level beside each archive, read again as soon as the vault learns a rule.
  const learned = useMemo(() => {
    for (let i = pulse.length - 1; i >= 0; i--) if (pulse[i].event.kind === 'learned') return pulse[i].id
    return 0
  }, [pulse])
  const level = useVaultLevel(undefined, undefined, undefined, learned)
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

  // The fleet's command line: `/` or the bridge's `/ commands` opens it, Esc or a click outside it
  // closes it. Triage takes its place.
  const [command, setCommand] = useState(false)
  useEffect(() => {
    if (triage) setCommand(false)
  }, [triage])

  // The view's keys, while nothing typed into has focus: Tab triages, ⌥1–9 opens the bridge's Nth
  // exception, `/` opens the command line, Esc drops the
  // selection, or else collapses the drawer (a tab's terminal has focus: Esc is its program's). With
  // anything open over the ship (`OVER_THE_SHIP`) they are that's. The app's chords (`actions/keys.ts`) run first, in the capture phase, and the drawer's (⌘\, Esc
  // on its quick diff) next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.defaultPrevented || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      if (document.querySelector(OVER_THE_SHIP)) return
      const st = nexusStore.getState()
      const digit = /^Digit([1-9])$/.exec(e.code)
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && shipRef.current.counts.need > 0) st.setTriage(true)
      else if (digit && e.altKey && !e.metaKey && !e.ctrlKey && navigator.platform.toLowerCase().includes('mac')) {
        const x = shipRef.current.bridge.exceptions[Number(digit[1]) - 1]
        const id = !x ? null : x.kind === 'captain' ? x.captainId : 'robotId' in x ? x.robotId : null
        if (!id) return
        onOpen(id)
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey) setCommand(true)
      else if (e.key === 'Escape' && st.selection.size) st.clearSelection()
      else if (e.key === 'Escape' && st.tabs.length && !st.collapsed) st.setCollapsed(true)
      else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onOpen])

  const [menu, setMenu] = useState<{ target: MenuTarget; x: number; y: number } | null>(null)

  return (
    <>
      <ShipScene
        onMenu={(target, x, y) => setMenu({ target, x, y })}
        ship={ship}
        log={log}
        focusId={focusId}
        selection={selection}
        onOpen={onOpen}
        onSelect={s.toggleSelect}
        onAction={(a) => void run(a).then(sayFailure, (e: unknown) => toast.error(String(e)))}
        onTriage={() => s.setTriage(true)}
        onCommand={() => setCommand(true)}
        command={<FleetPrompt ship={ship} repos={known} run={run} open={command} onClose={() => setCommand(false)} />}
        reducedMotion={reducedMotion}
        visible={visible}
        pulses={pulse}
        level={level}
      />
      <Triage ship={ship} open={triage} onClose={() => s.setTriage(false)} onOpen={onOpen} run={run} />
      <SelectionBar ship={ship} selection={selection} onClear={s.clearSelection} run={run} />
      {menu && (
        <NexusMenu
          x={menu.x}
          y={menu.y}
          head={menuHead(menu.target, ship)}
          items={menu.target.kind === 'systems' ? systemsItems() : menuFor(menu.target, ship, { open: onOpen })}
          onClose={() => setMenu(null)}
        />
      )}
      <WindowHost open={onOpen} />
      <ConfirmHost />
    </>
  )
}

export type NexusViewProps = {
  client: ShipClient
  /** For `startNexusUsage`'s rows. */
  usage: NexusClient
  /** The drawer's sessions, views and diff; the app's by default. */
  drawer?: DrawerDeps
}

/** The Nexus, the app: the whole window, under its native title bar (traffic lights and dragging
 *  included). The drawer sits beside the ship, which shrinks while it is open; collapsed, the drawer
 *  stays mounted, hidden, so its tabs keep their terminals. */
export function NexusView({ client, usage, drawer = liveDrawer }: NexusViewProps) {
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
    (id: string): boolean => {
      const o = openingOf(id, builtRef.current?.ship ?? null, reposRef.current, drawer.paneOfSession)
      if (o) drawer.drawer.open(o.tab, o.ref)
      return o !== null
    },
    [drawer],
  )
  // Every path in the app that goes to a session opens it here (`./outside`): a notification's
  // click. Its figure's tab, a window closed, as a window's own `ctx.open` does, so the tab is not
  // left under it.
  useEffect(
    () =>
      setFigures({
        open(id) {
          if (!onOpen(id)) return false
          closeWindow()
          return true
        },
      }),
    [onOpen],
  )
  const beside = tabs > 0 && !collapsed ? width : 0
  return (
    <>
      <div data-nexus-view="" className="fixed inset-0 z-drawer flex flex-col overflow-hidden bg-[#0c1326]">
        <div data-nexus-ship="" className="flex min-h-0 flex-1 flex-col" style={{ marginRight: beside }}>
          <ShipBody client={client} usage={usage} onOpen={onOpen} onShip={onShip} />
        </div>
      </div>
      <NexusDrawer deps={drawer} ship={built?.ship ?? null} feed={built?.feed ?? null} repos={repos} onOpen={onOpen} />
    </>
  )
}

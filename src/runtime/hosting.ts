// Which terminal shows a session, and when it is held. The hosted sessions are the drawer's
// tabs (`src/nexus/store.ts`, `src/nexus/drawer/sessions.ts`): one per terminal the app shows,
// held through the session host. The ship drew them as a drawer; the new front draws the one on
// stage (`LiveTerminal`). Keeping that one state is what lets the desktop MCP's
// `desktop_list_panes`, dictation's target and the notifier's "is it on screen" read the stage
// without a change: the tab of the session on stage is the active tab, and the "drawer" is
// collapsed whenever no live terminal is on stage.

import type { StoreApi } from 'zustand/vanilla'
import type { Agent } from '../agent/active'
import type { PaneId } from '../layout/tree'
import { sourceOfRow } from '../mission/account'
import type { ChildSession, Snapshot } from '../mission/types'
import type { SessionSpec } from '../nexus/drawer/open'
import type { Drawer } from '../nexus/drawer/sessions'
import type { DrawerTab, NexusState } from '../nexus/store'
import type { SessionHostState } from '../session/host'
import type { Outcome } from '../world/actions'
import type { Route } from '../world/route'
import { sessionOf } from '../world/store'
import type { Session, World } from '../world/types'
import { childRow, parentRow } from './rows'

export const OUTSIDE = 'It runs in a terminal outside the app. Opening it here would start a second copy of it.'
export const CHILD_ENDED = 'It has ended: there is no session to attach to.'
export const NO_FOLDER = 'It has ended, and its folder is not known: there is nowhere to resume it.'
export const GONE = 'That session is not here any more.'
export const NOT_HERE = 'It does not run in the app: there is nothing to close here.'

/** How long a child stays on stage before the app attaches to it: walking the roster past ten
 *  children starts no attach. A session in one of the app's own terminals is shown at once. */
export const ATTACH_SETTLE_MS = 350

/** How many attaches opened for the stage are kept at once. The oldest one off stage is let go
 *  (its child runs on; coming back attaches again). A session in a pane is never let go here. */
export const KEEP_ATTACHED = 3

/** How a session's terminal can be shown here and now. */
export type Way =
  /** One of the app's own terminals runs it. */
  | { kind: 'pane'; pane: PaneId }
  /** A live background child in no pane: `claude attach` on its account. */
  | { kind: 'attach'; child: ChildSession }
  /** An ended session the maintainer talks to, with a folder: `open` resumes it. */
  | { kind: 'resume'; root: string }
  | { kind: 'none'; why: string }

/** What `LiveTerminal` draws for a session. */
export type TerminalView =
  /** `key`: the session host's key, the same whatever its tab is called. `pty`: the terminal to
   *  draw; null while its attach starts. */
  | { state: 'held'; tab: string; key: string; pty: number | null; error: string | null }
  /** A child about to be attached to (`ATTACH_SETTLE_MS`). */
  | { state: 'waiting' }
  /** Its terminal was let go while it was on stage; `open` takes it back. */
  | { state: 'detached' }
  | { state: 'none' }

/** A terminal the app holds: a session's, a shell's, a command's. */
export type Hosted = { id: string; kind: DrawerTab['kind']; label: string; cwd: string | null; sessionId: string | null; pty: number | null }

export type HostingDeps = {
  world(): World
  snapshot(): Snapshot
  /** The hosted sessions and which is shown (`nexusStore`). */
  nexus: StoreApi<Pick<NexusState, 'tabs' | 'activeTab' | 'collapsed' | 'activateTab' | 'setCollapsed'>>
  host: StoreApi<Pick<SessionHostState, 'sessions'>>
  drawer: Pick<Drawer, 'open' | 'close'>
  sessions: {
    openSession(spec: SessionSpec): Promise<void>
    paneOf(sessionId: string): PaneId | null
    endSession(pane: PaneId): Promise<void>
  }
  route: { get(): Route; subscribe(fn: () => void): () => void }
  /** The session key of the terminal `LiveTerminal` draws now, or null: what is on screen is what
   *  is drawn. Without it, the stage is taken to draw what the route names. */
  drawn?(): string | null
  /** Hears the world and the app's terminals change. */
  watch(fn: () => void): () => void
  /** The account a session runs on, as a row that lists it says: a resume runs there. */
  agentOf(sessionId: string): Agent | null
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(timer: unknown): void
}

export type Hosting = ReturnType<typeof createHosting>

const ok = (note?: string): Outcome => (note ? { ok: true, note } : { ok: true })
const no = (why: string): Outcome => ({ ok: false, why })
const said = (e: unknown) => (e instanceof Error ? e.message : String(e))
const paneOfKey = (key: string | null | undefined): PaneId | null => (key?.startsWith('pane:') ? Number(key.slice(5)) : null)

export function createHosting(d: HostingDeps) {
  /** The session on Console's stage, as the route last said. */
  let staged: string | null = null
  /** The staged session whose terminal went while it was on stage (closed with the app's close
   *  chord, its attach ended by itself): it is not held again until asked for. */
  let dismissed: string | null = null
  /** Whether the staged session's terminal was held at the last look. */
  let held = false
  /** Tabs of the attaches opened for the stage, oldest first. */
  let attached: string[] = []
  let timer: unknown = null
  /** A hold is being made: the host has the session before the tab says so, and a look in
   *  between would see a terminal with no tab. The look that follows sees both. */
  let showing = false
  const listeners = new Set<() => void>()
  const tell = () => listeners.forEach((fn) => fn())

  const tabs = () => d.nexus.getState().tabs
  const session = (id: string) => sessionOf(d.world(), id)

  function wayOf(s: Session): Way {
    const pane = d.sessions.paneOf(s.id)
    if (pane !== null) return { kind: 'pane', pane }
    if (s.role === 'child') {
      const child = childRow(d.snapshot(), s)
      return child?.live ? { kind: 'attach', child } : { kind: 'none', why: CHILD_ENDED }
    }
    if (s.live) return { kind: 'none', why: OUTSIDE }
    const root = s.cwd ?? s.root
    return root ? { kind: 'resume', root } : { kind: 'none', why: NO_FOLDER }
  }

  /** The tab holding the terminal of session `id` (or the tab `id` itself: a shell's), if any. */
  function tabOf(id: string): DrawerTab | null {
    const all = tabs()
    const s = session(id)
    const sid = s?.id ?? id
    const direct = all.find((t) => t.id === sid) ?? all.find((t) => t.sessionId !== null && t.sessionId === sid)
    if (direct) return direct
    if (!s) return null
    const pane = d.sessions.paneOf(s.id)
    const onPane = pane === null ? undefined : all.find((t) => t.key === `pane:${pane}`)
    if (onPane) return onPane
    const child = s.role === 'child' ? childRow(d.snapshot(), s) : undefined
    return (child && all.find((t) => t.id === child.id)) ?? null
  }

  const heldTab = (id: string): DrawerTab | null => {
    const t = tabOf(id)
    return t && t.key !== null ? t : null
  }

  /** The app's terminal running session `id`, or the one a hosted tab `id` shows. */
  function paneOf(id: string): PaneId | null {
    const s = session(id)
    return (s ? d.sessions.paneOf(s.id) : null) ?? paneOfKey(tabOf(id)?.key)
  }

  /** Lets go of the oldest attaches off stage, beyond `KEEP_ATTACHED`. */
  function trim() {
    const open = new Set(tabs().map((t) => t.id))
    const onStage = staged ? heldTab(staged)?.id : undefined
    attached = attached.filter((id) => open.has(id))
    while (attached.length > KEEP_ATTACHED) {
      const old = attached.find((id) => id !== onStage)
      if (old === undefined) break
      attached = attached.filter((id) => id !== old)
      void d.drawer.close(old)
    }
  }

  /** Holds the terminal of `s`: a hold on its pane, or an attach to it. Starts nothing else. */
  function show(s: Session): DrawerTab | null {
    const had = heldTab(s.id)
    if (had) return had
    const way = wayOf(s)
    if (way.kind !== 'pane' && way.kind !== 'attach') return null
    const snap = d.snapshot()
    const child = way.kind === 'attach' ? way.child : s.role === 'child' ? childRow(snap, s) : undefined
    const source = sourceOfRow(child ?? parentRow(snap, s.id))
    const tab: DrawerTab = {
      id: child ? child.id : s.id,
      kind: child ? 'robot' : 'captain',
      key: null,
      readOnly: null,
      label: s.title,
      sessionId: child ? (child.session_id ?? s.id) : s.id,
      cwd: s.cwd ?? child?.cwd ?? null,
      ...(source ? { source } : {}),
    }
    showing = true
    try {
      d.drawer.open(tab, way.kind === 'pane' ? { pane: way.pane } : { child: way.child })
      if (way.kind === 'attach') {
        attached = [...attached.filter((id) => id !== tab.id), tab.id]
        trim()
      }
    } finally {
      showing = false
    }
    return heldTab(s.id)
  }

  /** The drawer's state says what is on screen: the staged session's tab while its terminal is
   *  drawn, or nothing. */
  function settle() {
    const on = staged ? heldTab(staged) : null
    const tab = on && (!d.drawn || d.drawn() === on.key) ? on : null
    const n = d.nexus.getState()
    if (tab) {
      if (n.activeTab !== tab.id || n.collapsed) n.activateTab(tab.id)
    } else if (n.tabs.length > 0 && !n.collapsed) n.setCollapsed(true)
  }

  function unschedule() {
    if (timer === null) return
    d.clearTimeout(timer)
    timer = null
  }

  /** Reads the route and holds what the stage needs. Run at every change of the route, the world,
   *  the app's terminals and the tabs; each run is cheap and changes nothing when nothing did. */
  function look() {
    if (showing) return
    const r = d.route.get()
    const id = r.view === 'console' ? r.session : null
    if (id !== staged) {
      staged = id
      dismissed = null
      held = false
      unschedule()
    }
    if (id !== null) {
      const now = heldTab(id) !== null
      // Held at the last look and not now: its terminal was closed, or its attach ended.
      if (held && !now) {
        dismissed = session(id)?.id ?? id
        unschedule()
      }
      const s = session(id)
      if (s && !now && dismissed !== s.id) {
        const way = wayOf(s)
        if (way.kind === 'pane') show(s)
        else if (way.kind === 'attach' && timer === null) {
          timer = d.setTimeout(() => {
            timer = null
            const still = staged === id ? session(id) : undefined
            if (still && dismissed !== still.id) show(still)
            look()
          }, ATTACH_SETTLE_MS)
        }
      }
      held = heldTab(id) !== null
    }
    settle()
    tell()
  }

  return {
    wayOf,
    tabOf,

    /** Whether the stage can show this session's terminal live, here and now. */
    canHost(s: Session): boolean {
      if (heldTab(s.id)) return true
      const way = wayOf(s)
      return way.kind === 'pane' || way.kind === 'attach'
    },

    /** What `LiveTerminal` draws for `id`: a session's id, or a hosted terminal's own. */
    view(id: string): TerminalView {
      const tab = heldTab(id)
      if (tab) {
        const h = d.host.getState().sessions[tab.key!]
        return { state: 'held', tab: tab.id, key: tab.key!, pty: h?.pty ?? null, error: h?.error ?? null }
      }
      const s = session(id)
      if (!s) return { state: 'none' }
      if (dismissed === s.id) return { state: 'detached' }
      return wayOf(s).kind === 'attach' ? { state: 'waiting' } : { state: 'none' }
    },

    /** Every terminal the app holds, in the order they were opened. */
    hosted(): Hosted[] {
      const sessions = d.host.getState().sessions
      return tabs().flatMap((t): Hosted[] => (t.key === null ? [] : [{ id: t.id, kind: t.kind, label: t.label, cwd: t.cwd, sessionId: t.sessionId, pty: sessions[t.key]?.pty ?? null }]))
    },

    paneOf,

    /** `Actions.open`: holds the session's terminal, attaches to it, or resumes it. */
    async open(id: string): Promise<Outcome> {
      const s = session(id)
      if (!s) return heldTab(id) ? ok() : no(GONE)
      if (dismissed === s.id) dismissed = null
      if (heldTab(s.id)) return ok()
      const way = wayOf(s)
      if (way.kind === 'none') return no(way.why)
      if (way.kind === 'resume') {
        const agent = d.agentOf(s.id)
        try {
          await d.sessions.openSession({ kind: 'claude', root: way.root, resume: s.id, ...(agent ? { agent } : {}) })
        } catch (e) {
          return no(said(e))
        }
        look()
        return ok('Resumed in a terminal here.')
      }
      show(s)
      look()
      return ok()
    },

    /** `Actions.close`: ends a session's terminal here, or lets go of an attach. */
    async close(id: string): Promise<Outcome> {
      const pane = paneOf(id)
      const tab = tabOf(id)
      try {
        if (pane !== null) {
          await d.sessions.endSession(pane)
          return ok('Its terminal ended, and the session with it.')
        }
        if (tab?.key) {
          await d.drawer.close(tab.id)
          return ok('Let go of. It runs on.')
        }
      } catch (e) {
        return no(said(e))
      }
      return no(NOT_HERE)
    },

    /** Hears every look: what `canHost` and `view` answer may have changed. */
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },

    /** Follows the route, the world, the terminals and the tabs. Returns how to stop. */
    start(): () => void {
      const stops = [d.route.subscribe(look), d.watch(look), d.nexus.subscribe(look), d.host.subscribe(look)]
      look()
      return () => {
        stops.forEach((stop) => stop())
        unschedule()
      }
    },
  }
}

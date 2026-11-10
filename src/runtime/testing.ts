// What the runtime's tests stand on: the synthetic world as a live one, the mission snapshot
// that world would have come from, and the hosting over the real drawer, the real session host and
// the real nexus store, with a PTY and a session starter that only record what was asked of them.

import { child, parent } from '../mission/fixtures'
import type { RepoGroup, Snapshot } from '../mission/types'
import type { SessionSpec } from '../nexus/drawer/open'
import { createDrawer } from '../nexus/drawer/sessions'
import { nexusStore } from '../nexus/store'
import type { PaneId, PtyClient } from '../pty/client'
import { createSessionHost } from '../session/host'
import { HOME, type Route } from '../world/route'
import { sampleWorld } from '../world/sample'
import { sessionOf } from '../world/store'
import type { Session, World } from '../world/types'
import { createHosting } from './hosting'

/** The synthetic world, as this machine's. */
export const liveWorld = (): World => ({ ...sampleWorld(), source: 'live' })

/** The sample session whose title starts with `text`. */
export function titled(world: World, text: string): Session {
  const hit = world.sessions.find((s) => s.title.startsWith(text))
  if (!hit) throw new Error(`no sample session titled "${text}…"`)
  return hit
}

/** The mission snapshot `world` would have been built from: each live parent, and each child
 *  under its parent's repo, by its short id, in its own worktree. */
export function snapshotOf(world: World): Snapshot {
  const repos = new Map<string, RepoGroup>()
  const group = (root: string) => {
    let g = repos.get(root)
    if (!g) repos.set(root, (g = { root, name: root.split('/').pop() ?? root, parents: [], missions: [], children: [] }))
    return g
  }
  for (const s of world.sessions) {
    if (s.role === 'parent') {
      if (s.live) group(s.root ?? '').parents.push(parent({ session_id: s.id, cwd: s.cwd ?? '', name: s.title }))
      continue
    }
    const up = sessionOf(world, s.parent)
    const pr = s.prs[0]
    group(up?.root ?? s.root ?? '').children.push(
      child({
        id: s.short,
        session_id: s.id,
        cwd: s.cwd ?? '',
        live: s.live,
        state: s.live ? 'working' : 'done',
        parent_session: s.parent,
        pr: pr ? { number: pr.number, url: pr.url, state: 'OPEN', head: 'feat/x', ci: 'pass' } : null,
      }),
    )
  }
  return { repos: [...repos.values()], errors: [], at: '2026-11-09T21:30:00Z' }
}

/** A pty client that records what is done to which PTY, in order. */
export function fakePty() {
  let next = 500
  const log: string[] = []
  const exits: Record<PaneId, (code: number | null) => void> = {}
  const pty: PtyClient = {
    async spawn() {
      const id = next++
      log.push(`spawn ${id}`)
      return id
    },
    write: async (id, data) => void log.push(`write ${id} ${JSON.stringify(data)}`),
    resize: async () => {},
    kill: async (id) => void log.push(`kill ${id}`),
    onExit: async (id, cb) => {
      exits[id] = cb
      return () => {}
    },
  }
  return { pty, log, exits }
}

/** The hosting, over the real drawer, session host and nexus store. `run(session, pane)` says one
 *  of the app's terminals runs that session; `go` moves the route; `changed` says the world or
 *  the terminals did. */
export function hostingBench(world: World = liveWorld()) {
  /** `agentFor`: the session a row says runs on another account. */
  const state: { world: World; snapshot: Snapshot; agentFor?: string } = { world, snapshot: snapshotOf(world) }
  const p = fakePty()
  const host = createSessionHost({ pty: p.pty, shell: () => 'posix', feed: () => {}, forget: () => {}, storage: null })
  nexusStore.setState({ tabs: [], activeTab: null, collapsed: false, focusId: null })
  /** Panes a tab let go of, as `Release.letGo` hears them. */
  const letGo: PaneId[] = []
  const drawer = createDrawer(host, nexusStore, { letGo: (pane) => void letGo.push(pane) })

  const panes = new Map<string, PaneId>()
  let nextPane = 1
  const opened: SessionSpec[] = []
  const ended: PaneId[] = []
  const sessions = {
    paneOf: (id: string) => panes.get(id) ?? null,
    async openSession(spec: SessionSpec) {
      opened.push(spec)
      const pane = nextPane++
      if (spec.kind === 'claude') {
        const id = spec.resume ?? spec.sessionId ?? `new-${pane}`
        panes.set(id, pane)
        drawer.open({ id, kind: 'captain', key: null, readOnly: null, label: 'claude', sessionId: id, cwd: spec.root }, { pane })
      } else drawer.open({ id: `session:${pane}`, kind: 'session', key: null, readOnly: null, label: spec.kind === 'command' ? spec.label : 'shell', sessionId: null, cwd: spec.root }, { pane })
    },
    async endSession(pane: PaneId) {
      ended.push(pane)
      for (const [id, at] of panes) if (at === pane) panes.delete(id)
      host.getState().paneGone(pane)
    },
  }

  let route: Route = { ...HOME }
  const routed = new Set<() => void>()
  const watching = new Set<() => void>()
  const hosting = createHosting({
    world: () => state.world,
    snapshot: () => state.snapshot,
    nexus: nexusStore,
    host,
    drawer,
    sessions,
    route: { get: () => route, subscribe: (fn) => (routed.add(fn), () => void routed.delete(fn)) },
    watch: (fn) => (watching.add(fn), () => void watching.delete(fn)),
    agentOf: (id) => (id === state.agentFor ? { kind: 'grok', config_dir: '/Users/you/.grok-work' } : null),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  })
  const stop = hosting.start()

  return {
    hosting,
    host,
    drawer,
    pty: p,
    state,
    opened,
    ended,
    letGo,
    stop() {
      stop()
      drawer.dispose()
    },
    /** One of the app's terminals runs `s` from now on. */
    run(s: Session, pane = nextPane++): PaneId {
      panes.set(s.id, pane)
      watching.forEach((fn) => fn())
      return pane
    },
    go(patch: Partial<Route>) {
      route = { ...route, ...patch }
      routed.forEach((fn) => fn())
    },
    /** The world, the snapshot or the terminals changed. */
    changed() {
      watching.forEach((fn) => fn())
    },
    nexus: () => nexusStore.getState(),
    session: (text: string) => titled(state.world, text),
  }
}

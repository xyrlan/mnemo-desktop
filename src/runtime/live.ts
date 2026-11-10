// The runtime as the app runs it: the real stores and paths behind `./hosting`, `./actions` and
// `./Terminals`, and what the ship's view started as a side effect and the app still needs. It is
// loaded only when a live world starts it (`startRuntime` in `./index`), so nothing here runs on
// the sample world, in the preview of a view, or in a view's test.
//
// The ship's own logic is used where it is (`src/nexus/drawer/app.ts`: the drawer's sessions, the
// restore of the tabs kept from the last run, the session ids learned from running terminals;
// those start as that module loads, flag or no flag). Nothing of it is changed.

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'
import { activeAgent } from '../agent/active'
import { externalUrl } from '../browser/open'
import { ptySendPrompt } from '../chat-input/pty'
import { paneRunsClaude } from '../chrome/running'
import { cockpitStore } from '../cockpit/app-store'
import { runJob } from '../cockpit/job'
import { fleetStore } from '../fleet/store'
import { contractDispatchKey, dispatchContract, dispatchIssues, dispatchKey } from '../github/actions'
import { homeStore } from '../home/app-store'
import { sessionAgent } from '../home/types'
import { store as layout } from '../layout/app-store'
import { learned, learnedClient } from '../learned/app-store'
import { settled } from '../learned/store'
import { readTerminal } from '../mcp/app'
import { answerQuestion, answerQuestionOther } from '../mission/ask'
import { missionStore } from '../mission/app-store'
import { allChildren, type ChildSession } from '../mission/types'
import { firstRun, NexusToasts } from '../nexus/boot'
import { appPaths, jobEnded, outcomeOf } from '../nexus/command/actions'
import { liveDrawer, liveSessions } from '../nexus/drawer/app'
import type { SessionSpec } from '../nexus/drawer/open'
import { nexusRoutes, setFigures, setNexusRoutes } from '../nexus/outside'
import { knownRepos } from '../nexus/repos'
import { nexusStore } from '../nexus/store'
import { chooseRepo } from '../nexus/windows/memory/repo'
import { tauriPty } from '../pty/client'
import { paneShell } from '../pty/typed'
import { sessionHost } from '../session/app-host'
import { settingsStore } from '../settings/app-store'
import { setup } from '../setup/app-store'
import { afterStartup } from '../shell/after-startup'
import TerminalPane from '../terminal/view'
import { setActions, type DispatchOptions } from '../world/actions'
import { go, routeStore } from '../world/route'
import { sessionOf, worldStore } from '../world/store'
import { createActions, type Did } from './actions'
import { runtimeStore } from './current'
import { createHosting } from './hosting'
import { createRedraw } from './redraw'
import { sessionIdOf } from './rows'
import { stopChild } from './stop'
import { createTerminals } from './Terminals'

const world = () => worldStore.getState().world
const snapshot = () => missionStore.getState().snapshot
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const running = (key: string) => cockpitStore.getState().jobs[key]?.running === true

/** Starts `spec` in a terminal the app holds (`openSession` in `src/nexus/drawer/start.ts`); the
 *  id it is held under: a Claude session's own id, `session:<pane>` for a shell or a command. */
async function openSession(spec: SessionSpec): Promise<string | null> {
  const before = new Set(nexusStore.getState().tabs.map((t) => t.id))
  await liveSessions.openSession(spec)
  const fresh = nexusStore.getState().tabs.filter((t) => !before.has(t.id))
  return fresh.at(-1)?.id ?? (spec.kind === 'claude' ? (spec.resume ?? spec.sessionId ?? null) : null)
}

const paneOfTab = (id: string | null): number | null => {
  const key = id === null ? null : nexusStore.getState().tabs.find((t) => t.id === id)?.key
  return key?.startsWith('pane:') ? Number(key.slice(5)) : null
}

/** A terminal's exit code once its shell has ended, or `'running'` after `ms`. */
function exited(pane: number, ms: number): Promise<number | null | 'running'> {
  return new Promise((resolve) => {
    const look = () => {
      const p = layout.getState().panes[pane]
      if (p && p.exitCode === undefined) return false
      done(p?.exitCode ?? null)
      return true
    }
    const done = (v: number | null | 'running') => {
      clearTimeout(timer)
      unwatch()
      resolve(v)
    }
    const unwatch = layout.subscribe(() => void look())
    const timer = setTimeout(() => done('running'), ms)
    look()
  })
}

const flags = (o: DispatchOptions) => [...(o.model ? ['--model', o.model] : []), ...(o.advisor ? ['--advisor', o.advisor] : []), ...(o.effort ? ['--effort', o.effort] : []), ...(o.may ? ['--may', o.may] : [])]

/** A dispatch as the GitHub view runs it (`src/github/actions.ts`), once it has ended. That path
 *  carries a model, an effort and a may; with an advisor the same job runs with `--advisor` too. */
async function dispatched(key: string, title: string, root: string, argv: string[], o: DispatchOptions, plain: () => void): Promise<Did> {
  if (running(key)) return { ok: false, why: 'the same dispatch is already running' }
  if (o.advisor) void runJob(key, title, root, [...argv, ...flags(o)])
  else plain()
  return outcomeOf(await jobEnded(key))
}

/** Every repo the app knows, as the ship's windows listed them. */
const knownRoots = () => knownRepos(fleetStore.getState().repos, homeStore.getState().snapshot.repos, settingsStore.getState().projects).map((r) => r.root)

let settingsRead = false

/** The app's one toaster, which the ship's view mounted in the shell's slot: every `toast(...)`
 *  lands in it. Here it is drawn in a root of the runtime's own, beside the page: a shell slot
 *  is for a folder `App.tsx` imports a `view.tsx` of, and the runtime is started by the frame. */
function toaster(): () => void {
  const at = document.createElement('div')
  at.setAttribute('data-runtime-toasts', '')
  document.body.appendChild(at)
  const root = createRoot(at)
  root.render(createElement(NexusToasts))
  // Not while React is committing the tree that asked for the stop.
  return () =>
    void setTimeout(() => {
      root.unmount()
      at.remove()
    }, 0)
}

/** Starts the runtime. Returns how to stop it. */
export function start(): () => void {
  // The hosting asks what is drawn; the terminals ask the hosting what to draw.
  const drawing: { terminals?: ReturnType<typeof createTerminals> } = {}
  const hosting = createHosting({
    world,
    snapshot,
    nexus: nexusStore,
    host: sessionHost,
    drawer: liveDrawer.drawer,
    sessions: liveSessions,
    route: { get: () => routeStore.getState().route, subscribe: (fn) => routeStore.subscribe(fn) },
    drawn: () => drawing.terminals?.drawn() ?? null,
    watch(fn) {
      const stops = [
        drawing.terminals?.onDrawn(fn) ?? (() => {}),
        worldStore.subscribe(fn),
        missionStore.subscribe((s, p) => void (s.snapshot !== p.snapshot && fn())),
        layout.subscribe((s, p) => void (s.panes !== p.panes && fn())),
      ]
      return () => stops.forEach((stop) => stop())
    },
    agentOf: (id) => sessionAgent(homeStore.getState().snapshot, id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  })

  const terminals = createTerminals({
    hosting,
    nexus: nexusStore,
    host: sessionHost,
    terminal: TerminalPane,
    close: (tab) => void liveDrawer.drawer.close(tab),
  })
  drawing.terminals = terminals

  /** On Console's stage: a session of the world, or a terminal the app holds by its own id. */
  const stage = (id: string) => go({ view: 'console', session: sessionOf(world(), id)?.id ?? id, pending: null, panel: null })

  const actions = createActions({
    world,
    snapshot,
    hosting,
    stage,
    child: {
      answerQuestion: (child, index) => answerQuestion(child, index),
      answerQuestionOther: (child, text) => answerQuestionOther(child, text),
      answerPrompt: (child, choice) => appPaths.answerPrompt(child, choice),
      // Through the mission store, as the mission's own reply box sends: the child's suggested
      // reply is never sent as the maintainer's, and what left is kept in `sent`.
      async asMe(child, text) {
        const m = missionStore.getState()
        m.setDraft(child.id, text)
        if (!(await m.replyAsMe(child.id, child.suggested_reply))) throw new Error(missionStore.getState().replyErrors[child.id] || 'It was not typed.')
      },
      async inbox(id, text) {
        const m = missionStore.getState()
        m.setDraft(id, text)
        if (!(await m.sendReply(id))) throw new Error(missionStore.getState().replyErrors[id] || 'It was not sent.')
      },
    },
    pane: {
      screen: (pane) => readTerminal(pane),
      runsClaude: paneRunsClaude,
      write: (pane, data) => tauriPty.write(pane, data),
      prompt: ptySendPrompt,
      sleep,
    },
    merge: (root, pr) => appPaths.merge(root, pr),
    land: (root, mission) => appPaths.land(root, mission),
    dispatch: (root, issues, o) =>
      dispatched(dispatchKey(root, issues), `dispatch · ${issues.map((n) => `#${n}`).join(', ')}`, root, ['mnemo', 'dispatch', ...issues.map(String)], o, () => dispatchIssues(root, issues, o)),
    dispatchContract: (root, path, o) =>
      dispatched(contractDispatchKey(root, path), `dispatch · contract ${path}`, root, ['mnemo', 'dispatch', '--contract', path], o, () => dispatchContract(root, path, o)),
    stop: (root, child) =>
      stopChild(
        {
          shell: () => paneShell(),
          run: async (cwd, command, label) => paneOfTab(await openSession({ kind: 'command', root: cwd, command, label })),
          exited,
          end: (pane) => liveSessions.endSession(pane),
        },
        root,
        child,
      ),
    openSession,
    activeKind: () => activeAgent().kind,
    shot: (ask, id) => invoke<string>('insight_shot', { ask, id }),
    async page(url) {
      const target = externalUrl(url)
      if (!target) throw new Error(`Not a web page: ${url}`)
      await invoke<void>('browser_open_external', { url: target })
    },
    file: (path) => invoke<void>('system_open', { path }),
  })

  /** The child an `attach · <id>` terminal is for (`answerPrompt` opens one to answer by hand). */
  const attachOf = (label: string): ChildSession | undefined => {
    const id = /^attach · (\S+)$/.exec(label)?.[1]
    return id === undefined ? undefined : allChildren(snapshot()).find((c) => c.id === id && c.live)
  }

  // The routes the app's own paths open things through (`src/nexus/outside.ts`): a terminal goes
  // on the stage, a page to the system browser, the vault's pages to the Memory panel.
  const shipRoutes = nexusRoutes()
  const unsetRoutes = setNexusRoutes({
    async terminal(cwd, command, label) {
      // An attach to a child is the child's own terminal on stage, not a second one.
      const child = attachOf(label)
      if (child) {
        stage(sessionIdOf(child))
        await hosting.open(sessionIdOf(child))
        return
      }
      const id = await openSession({ kind: 'command', root: cwd ?? (await homeDir()), command, label })
      if (id !== null) stage(id)
    },
    async page(url) {
      const target = externalUrl(url)
      if (!target) throw new Error(`not a web page: ${url}`)
      await invoke<void>('browser_open_external', { url: target })
    },
    pages: () => go({ panel: 'memory' }),
  })

  // A notification's click opens its session: on the stage.
  const unsetFigures = setFigures({
    open(id) {
      const child = allChildren(snapshot()).find((c) => c.id === id)
      const s = sessionOf(world(), child ? sessionIdOf(child) : id) ?? sessionOf(world(), id)
      if (!s) return false
      stage(s.id)
      return true
    },
  })

  if (!settingsRead && !settingsStore.getState().loaded) void settingsStore.getState().load()
  settingsRead = true

  // The first run's check (`src/nexus/boot`), asking in the frame's panels where the ship asked
  // in its windows: Setup when `claude` or `mnemo` is missing, then What mnemo learned.
  const stopFirstRun = firstRun({
    checkTools: () => afterStartup().then(() => setup.getState().check()),
    toolRows: () => setup.getState().rows,
    subscribeTools: (fn) => setup.subscribe(fn),
    review: {
      client: learnedClient,
      cwds: knownRoots,
      subscribe: (fn) => {
        const stops = [fleetStore.subscribe(fn), homeStore.subscribe(fn), settingsStore.subscribe(fn)]
        return () => stops.forEach((stop) => stop())
      },
    },
    ask: (target, dry) => {
      if (!settled(learned.getState().phase)) return false
      learned.getState().ask(target, dry)
      chooseRepo(target.root)
      return true
    },
    stillAsking: () => learned.getState().phase.kind === 'consent',
    openWindowId: () => routeStore.getState().route.panel,
    subscribeWindow: (fn) => routeStore.subscribe(fn),
    open: (id) => go({ panel: id }),
  })

  const stops = [
    toaster(),
    setActions(actions),
    hosting.start(),
    stopFirstRun,
    unsetFigures,
    () => {
      unsetRoutes()
      setNexusRoutes(shipRoutes)
    },
  ]
  // The stage was drawn before the runtime started: it looks again (`./redraw`).
  const redraw = createRedraw({
    staged() {
      const r = routeStore.getState().route
      return r.view === 'console' ? sessionOf(world(), r.session) : undefined
    },
    canHost: hosting.canHost,
    again() {
      const w = worldStore.getState()
      if (w.ready) w.set({ ...w.world })
    },
  })
  stops.push(hosting.subscribe(redraw))
  runtimeStore.setState({ runtime: { canHost: hosting.canHost, Terminal: terminals.LiveTerminal, hosted: hosting.hosted, subscribe: hosting.subscribe, focus: terminals.focus } })
  redraw()

  return () => {
    runtimeStore.setState({ runtime: null })
    stops.forEach((stop) => stop())
    terminals.dispose()
  }
}

// What the menu holds, worked out from the world with no DOM
// (docs/superpowers/specs/2026-11-10-session-menu.md, "What it holds"). An item is here only
// when it applies; one whose absence would be the surprise is here switched off, with the reason
// in a few words. Nothing in this list fails when chosen for a reason the world already shows.

import { setOrbit } from '../orbit/state'
import { answer } from '../pending/state'
import type { Hosted } from '../runtime'
import { actions, type Outcome } from '../world/actions'
import { go, openOnStage, routeStore, type Route } from '../world/route'
import { pendingOf, sessionOf } from '../world/store'
import type { Pending, Project, PullRequest, Session, World } from '../world/types'

/** What a menu is on: a session, a project's name, or a terminal the app holds that is no
 *  session of the world. */
export type Target = { kind: 'session'; id: string } | { kind: 'project'; name: string } | { kind: 'terminal'; id: string }

/** One of the things a row of choices offers (Copy: its id, its resume line, its folder). */
export interface Part {
  id: string
  label: string
}

/** Which part of the menu an item belongs to; a hairline stands between two parts. go: to the
 *  session. end: what ends it or speaks to it. read: its changes and its pull request. new:
 *  what starts beside it. take: what is carried away of it. */
export type Group = 'go' | 'end' | 'read' | 'new' | 'take'

export interface Item {
  id: string
  group: Group
  label: string
  /** A few words beside the label: a pull request's number, what waits. */
  hint?: string
  /** Why it cannot be chosen. It is shown, switched off, with these words. */
  off?: string
  /** What ends something is asked first, in these words, on the same item. */
  ask?: string
  /** A line is typed first: what the empty field says. */
  type?: string
  /** A row of choices on one item; left and right move among them. */
  parts?: Part[]
  /** What the foot of the frame says once it ran. Without it nothing is said, unless the action
   *  added a note of its own. */
  says?: string
  /** `part`: the choice of a row. `text`: the line that was typed. */
  run(given: { part?: string; text?: string }): Outcome | Promise<Outcome>
}

export interface Menu {
  target: Target
  /** What the menu is on, for its head. */
  title: string
  sub: string
  session: Session | null
  items: Item[]
}

const OK: Outcome = { ok: true }

/** The folder's own name: what a project is called when the world gave it none. */
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Selecting another session leaves the card that was open behind. */
const onto = (id: string): Partial<Route> => (routeStore.getState().route.session === id ? {} : { session: id, pending: null })

/** In Orbit the cursor can stand on the centre, and the centre can be open: an item that goes
 *  to a session takes the cursor to it. */
const leaveCentre = (): void => {
  if (routeStore.getState().route.view === 'orbit') setOrbit({ core: false, vault: false, find: null })
}

/** The pull request a session's item is about: the one that waits to merge, else an open one,
 *  else the newest. */
export function pullOf(world: World, s: Session): PullRequest | null {
  const waits = pendingOf(world, s.id).find((p) => p.kind === 'merge' && p.pr)?.pr
  return waits ?? s.prs.find((p) => p.state === 'open') ?? s.prs[s.prs.length - 1] ?? null
}

/** Why a merge that waits cannot be chosen yet; null when it can. */
export function mergeBlock(pr: PullRequest): string | null {
  if (pr.draft) return 'still a draft'
  if (pr.ci === 'green') return null
  return pr.ci === 'running' ? 'checks still running' : pr.ci === 'red' ? 'checks are red' : 'no checks yet'
}

/** The merge card of a session whose pull request is still open; null when there is none. */
function mergeOf(world: World, s: Session): (Pending & { pr: PullRequest }) | null {
  const p = pendingOf(world, s.id).find((x) => x.kind === 'merge' && x.pr && x.pr.state !== 'merged' && x.pr.state !== 'closed' && x.choices.length > 0)
  return p ? (p as Pending & { pr: PullRequest }) : null
}

const copy = async (text: string): Promise<Outcome> => {
  try {
    await navigator.clipboard.writeText(text)
    return OK
  } catch {
    // A webview that refuses the async clipboard still copies a selection.
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;left:-99em;top:0;opacity:0'
    document.body.appendChild(field)
    const back = document.activeElement
    field.select()
    let done = false
    try {
      done = document.execCommand('copy')
    } catch {
      done = false
    }
    field.remove()
    if (back instanceof HTMLElement) back.focus({ preventScroll: true })
    return done ? OK : { ok: false, why: 'The clipboard refused it.' }
  }
}

/** A session's menu, in the spec's order. */
export function sessionItems(world: World, s: Session): Item[] {
  const items: Item[] = []
  const waits = pendingOf(world, s.id)
  const runs = s.role === 'child' && s.live && s.state !== 'ended'
  const place = s.project ?? (s.root ? folderName(s.root) : null)

  items.push({
    id: 'open',
    group: 'go',
    label: 'Open on stage',
    run() {
      leaveCentre()
      openOnStage(s.id)
      return OK
    },
  })

  if (waits.length) {
    const first = waits[0]
    items.push({
      id: 'answer',
      group: 'go',
      label: 'Answer…',
      hint: waits.length > 1 ? `${waits.length} wait` : first.kind,
      run() {
        leaveCentre()
        // Its card opens where the session is drawn, at now: a card is answered there.
        go({ session: s.id, pending: first.id, at: null, panel: null })
        return OK
      },
    })
  }

  if (s.hosted) {
    items.push({ id: 'close', group: 'end', label: 'Close session', ask: 'Close it, and end what runs in it?', says: 'Closed', run: () => actions().close(s.id) })
  } else if (s.live && s.role === 'parent') {
    // The app does not run it, so it cannot end it: said, because Close is looked for.
    items.push({ id: 'close', group: 'end', label: 'Close session', off: 'runs outside this app', run: () => OK })
  }

  if (s.role === 'parent' && !s.live && !s.hosted) {
    const folder = s.cwd ?? s.root
    items.push({
      id: 'resume',
      group: 'end',
      label: 'Resume here',
      off: folder ? undefined : 'its folder is not known',
      says: 'Resumed',
      async run() {
        const out = await actions().open(s.id)
        if (out.ok) {
          leaveCentre()
          openOnStage(s.id)
        }
        return out
      },
    })
  }

  if (runs) {
    items.push({ id: 'stop', group: 'end', label: 'Stop', ask: 'Stop it where it stands?', says: 'Stopped', run: () => actions().stop(s.id) })
    items.push({ id: 'message', group: 'end', label: 'Message…', type: 'a message to its inbox', says: 'Message', run: ({ text }) => actions().message(s.id, text ?? '') })
  }

  if (s.cwd) {
    items.push({
      id: 'changes',
      group: 'read',
      label: 'Changes',
      run() {
        go({ ...onto(s.id), panel: 'changes', command: false })
        return OK
      },
    })
  }

  const pr = pullOf(world, s)
  if (pr) items.push({ id: 'pr', group: 'read', label: 'Open pull request', hint: `#${pr.number}`, run: () => actions().external(pr.url) })

  const merge = mergeOf(world, s)
  if (merge) {
    const block = mergeBlock(merge.pr)
    const first = merge.choices[0]
    items.push({
      id: 'merge',
      group: 'read',
      label: 'Merge',
      hint: `#${merge.pr.number}`,
      off: block ?? undefined,
      ask: `Merge #${merge.pr.number}?`,
      says: `Merge #${merge.pr.number}`,
      // Its merge card's first choice, through the card's own state: every drawing of the card
      // shows the answer on its way.
      run: async () => (await answer(merge, first.key)) ?? { ok: false, why: 'It is already being answered.' },
    })
  }

  if (s.root && place) {
    const root = s.root
    items.push({ id: 'new-session', group: 'new', label: `New session in ${place}`, says: `New session in ${place}`, run: () => actions().newSession(root) })
    items.push({ id: 'new-shell', group: 'new', label: `New shell in ${place}`, says: `New shell in ${place}`, run: () => actions().newShell(root) })
  }

  const texts: Record<string, string> = { id: s.id }
  const parts: Part[] = [{ id: 'id', label: 'id' }]
  if (s.agent === 'claude') {
    texts.resume = `claude --resume ${s.id}`
    parts.push({ id: 'resume', label: 'resume line' })
  }
  if (s.cwd) {
    texts.folder = s.cwd
    parts.push({ id: 'folder', label: 'folder' })
  }
  items.push({ id: 'copy', group: 'take', label: 'Copy', parts, says: 'Copied', run: ({ part }) => copyPart(texts, parts, part) })

  if (s.cwd) {
    const folder = s.cwd
    items.push({ id: 'folder', group: 'take', label: 'Open folder', run: () => actions().external(folder) })
  }
  return items
}

async function copyPart(texts: Record<string, string>, parts: Part[], part: string | undefined): Promise<Outcome> {
  const which = parts.find((p) => p.id === part) ?? parts[0]
  const out = await copy(texts[which.id])
  return out.ok ? { ok: true, note: which.id === 'id' ? 'its id' : which.id === 'resume' ? texts.resume : 'its folder' } : out
}

/** How many frames the Missions panel is given to draw a project's part: under a second. */
const MISSIONS_FRAMES = 40

/** The search for a project's part of the Missions panel that is going on: a newer one ends it. */
let looking = 0

/** The Missions panel has one list for every repo and no way to be opened on one: once it has
 *  drawn this project's part, that part is brought into sight. It is looked for over a few
 *  frames (the panel reads its repos as it opens) and then left alone; a panel that was closed
 *  meanwhile is not looked into. */
function showInMissions(root: string | null): void {
  const mine = ++looking
  if (!root || typeof requestAnimationFrame !== 'function') return
  const look = (left: number): void => {
    if (left <= 0) return
    requestAnimationFrame(() => {
      if (mine !== looking || routeStore.getState().route.panel !== 'missions') return
      const part = [...document.querySelectorAll<HTMLElement>('[data-panel="missions"] [data-root]')].find((el) => el.dataset.root === root)
      if (part) part.scrollIntoView?.({ block: 'start' })
      else look(left - 1)
    })
  }
  look(MISSIONS_FRAMES)
}

/** A project's menu. */
export function projectItems(p: Project): Item[] {
  const root = p.root
  const nowhere = root ? undefined : 'its folder is not known'
  return [
    { id: 'new-session', group: 'new', label: 'New session here', off: nowhere, says: `New session in ${p.name}`, run: () => (root ? actions().newSession(root) : OK) },
    { id: 'new-shell', group: 'new', label: 'New shell here', off: nowhere, says: `New shell in ${p.name}`, run: () => (root ? actions().newShell(root) : OK) },
    {
      id: 'dispatch',
      group: 'go',
      label: 'Dispatch…',
      hint: 'Missions',
      run() {
        go({ panel: 'missions', command: false })
        showInMissions(root)
        return OK
      },
    },
    {
      id: 'projects',
      group: 'go',
      label: 'Projects',
      run() {
        go({ panel: 'projects', command: false })
        return OK
      },
    },
  ]
}

/** The menu of a terminal the app holds that is no session: there is nothing to read of it but
 *  what it prints, so it can be put on stage, ended, and found on disk. */
export function terminalItems(t: Hosted): Item[] {
  const items: Item[] = [
    {
      id: 'open',
      group: 'go',
      label: 'Open on stage',
      run() {
        openOnStage(t.id)
        return OK
      },
    },
    { id: 'close', group: 'end', label: 'End terminal', ask: 'End it, and what runs in it?', says: 'Ended', run: () => actions().close(t.id) },
  ]
  if (t.cwd) {
    const folder = t.cwd
    items.push({ id: 'copy', group: 'take', label: 'Copy', parts: [{ id: 'folder', label: 'folder' }], says: 'Copied', run: async () => ((await copy(folder)).ok ? { ok: true, note: 'its folder' } : { ok: false, why: 'The clipboard refused it.' }) })
    items.push({ id: 'folder', group: 'take', label: 'Open folder', run: () => actions().external(folder) })
  }
  return items
}

/** A project by its name: the world's own entry, else one put together from the sessions that
 *  name it (a live world can know a session's project before it lists the project). */
export function projectOf(world: World, name: string): Project | null {
  const listed = world.projects.find((p) => p.name === name)
  if (listed) return listed
  const mine = world.sessions.filter((s) => s.project === name)
  if (!mine.length) return null
  return { name, root: mine.find((s) => s.role === 'parent' && s.root)?.root ?? null, sessions: mine.map((s) => s.id) }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The menu on `target` as the world stands, or null when what it was on is not there (any
 *  more): the menu does not open, and one that is open closes. */
export function menuOf(world: World, target: Target, hosted: readonly Hosted[], name: (t: Hosted) => string = (t) => t.label || t.id): Menu | null {
  if (target.kind === 'session') {
    const s = sessionOf(world, target.id)
    if (!s) return null
    return { target: { kind: 'session', id: s.id }, title: s.title, sub: s.project ?? '', session: s, items: sessionItems(world, s) }
  }
  if (target.kind === 'project') {
    const p = projectOf(world, target.name)
    if (!p) return null
    const n = world.sessions.filter((s) => s.project === p.name).length
    return { target, title: p.name, sub: plural(n, 'session', 'sessions'), session: null, items: projectItems(p) }
  }
  const t = hosted.find((h) => h.id === target.id)
  // A terminal that became a session of the world is that session's menu.
  if (!t || sessionOf(world, t.id) || (t.sessionId && sessionOf(world, t.sessionId))) return null
  return { target, title: name(t), sub: 'terminal', session: null, items: terminalItems(t) }
}

/** The same thing, said as one word: what an element is marked with, and what a menu is told
 *  apart by. */
export const keyOf = (t: Target): string => `${t.kind}:${t.kind === 'project' ? t.name : t.id}`

export function targetFrom(key: string | null | undefined): Target | null {
  const at = key?.indexOf(':') ?? -1
  if (!key || at < 1) return null
  const kind = key.slice(0, at)
  const rest = key.slice(at + 1)
  if (!rest) return null
  if (kind === 'session' || kind === 'terminal') return { kind, id: rest }
  return kind === 'project' ? { kind, name: rest } : null
}

/* ---- walking it ---- */

/** The item `by` steps from `at` among the ones that can be chosen, wrapping. -1 when none can. */
export function stepItem(items: readonly Item[], at: number, by: 1 | -1): number {
  const n = items.length
  for (let i = 1; i <= n; i++) {
    const to = (((at + by * i) % n) + n) % n
    if (!items[to].off) return to
  }
  return -1
}

/** The first item that can be chosen, or the last. -1 when none can. */
export function edgeItem(items: readonly Item[], last: boolean): number {
  const order = items.map((_, i) => i)
  if (last) order.reverse()
  return order.find((i) => !items[i].off) ?? -1
}

/** A first letter: the next item after `at` whose label starts with it, wrapping, and whether
 *  it is the only one (so the letter chooses it, as a menu's letters do). Null when none does. */
export function letterItem(items: readonly Item[], at: number, letter: string): { at: number; only: boolean } | null {
  const l = letter.toLowerCase()
  const hits = items.map((item, i) => ({ item, i })).filter(({ item }) => !item.off && item.label.toLowerCase().startsWith(l))
  if (!hits.length) return null
  const next = hits.find(({ i }) => i > at) ?? hits[0]
  return { at: next.i, only: hits.length === 1 }
}

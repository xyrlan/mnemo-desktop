import type { Agent } from '../../agent/active'
import type { PaneId } from '../../layout/tree'
import { captainById, isGreen, isRunning, otherRepo, repoRootOf, robotById } from '../command/find'
import type { SessionSpec } from '../drawer/open'
import type { ActionResult, Captain, LogEvent, Ship, ShipAction, ShipRobot } from '../ship-types'
import type { ConfirmOptions } from '../ui/confirm'
import type { MenuContext, MenuItem, MenuProvider, MenuTarget } from '../ui/menus'

/** What the menus do through the app (`app.ts` wires the real ones; a test hands in its own). */
export type MenuDeps = {
  openSession(spec: SessionSpec): Promise<void>
  /** The pane the app runs Claude session `sessionId` in, else null. */
  paneOf(sessionId: string): PaneId | null
  /** The account session `sessionId` runs on, as a row that lists it says (Home's), else null:
   *  a resume runs on it, its own CLI and home. */
  agentOf?(sessionId: string): Agent | null
  endSession(pane: PaneId): Promise<void>
  confirm(opts: ConfirmOptions): Promise<boolean>
  runAction(action: ShipAction, ship: Ship): Promise<ActionResult>
  openWindow(id: string, params: Record<string, unknown>): void
  /** Opens `url` in the system browser. */
  openUrl(url: string): Promise<void>
  copy(text: string): Promise<void>
  /** Repo `root`'s saved commands, in the order saved. */
  savedCommands(root: string): { label: string; command: string }[]
  /** Milestones for the ship's log. */
  log(events: LogEvent[]): void
  /** A line for the person: `error` when something did not go through. */
  say(text: string, error?: boolean): void
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The right-click menus (spec `2026-10-15-nexus-app-design.md`, Q2): a captain's, a robot's, and a
 *  deck's or a dock's. What does not apply to a figure's state is disabled with a hint, never an
 *  item that fails; what never applies to it is absent. */
export function makeShipMenu(d: MenuDeps): MenuProvider {
  /** Runs `fn`, saying why when it throws: a menu item's promise has nobody waiting on it. */
  const guarded = (fn: () => unknown) => async () => {
    try {
      await fn()
    } catch (e) {
      d.say(why(e), true)
    }
  }
  /** An action through the command piece: its milestones go to the log, a refusal says why. */
  const act = async (action: ShipAction, ship: Ship) => {
    const r = await d.runAction(action, ship)
    d.log(r.log)
    if (!r.ok) d.say(r.say || 'That did not go through.', true)
  }
  const copy = (text: string): MenuItem => ({
    id: 'copy-id',
    label: 'Copy id',
    hint: text,
    run: guarded(async () => {
      await d.copy(text)
      d.say(`Copied ${text}`)
    }),
  })

  /** A deck's or a dock's: what can start in repo `root`. */
  const repoItems = (root: string): MenuItem[] => [
    { id: 'new-session', label: 'New session', hint: 'claude', run: guarded(() => d.openSession({ kind: 'claude', root })) },
    { id: 'terminal', label: 'Terminal here', hint: 'a shell', run: guarded(() => d.openSession({ kind: 'shell', root })) },
    ...d.savedCommands(root).map(
      (c, i): MenuItem => ({ id: `command:${i}`, label: c.label, hint: c.command, run: guarded(() => d.openSession({ kind: 'command', root, command: c.command, label: c.label })) }),
    ),
  ]

  const captainItems = (c: Captain, ship: Ship, ctx: MenuContext): MenuItem[] => {
    // The empty chair: no session of its own, only the repo its parentless children work in.
    if (c.id.startsWith('orphan:')) return repoItems(rootOfCaptain(ship, c.id) ?? c.id.slice('orphan:'.length))
    const parent = c.parent
    if (!parent) {
      const root = rootOfCaptain(ship, c.id)
      const agent = d.agentOf?.(c.id) ?? null
      const hint = agent?.kind === 'grok' ? 'grok -r' : 'claude --resume'
      return [
        { id: 'open', label: 'Open', hint: 'its session ended', disabled: true, run: () => {} },
        root === null
          ? { id: 'resume', label: 'Resume', hint: 'no repo to resume it in', disabled: true, run: () => {} }
          : { id: 'resume', label: 'Resume', hint, run: guarded(() => d.openSession({ kind: 'claude', root, resume: c.id, ...(agent ? { agent } : {}) })) },
        copy(c.id),
      ]
    }
    const pane = d.paneOf(parent.session_id)
    return [
      { id: 'open', label: 'Open', run: () => ctx.open(c.id) },
      pane === null
        ? { id: 'close', label: 'Close', hint: 'it runs outside the app', danger: true, disabled: true, run: () => {} }
        : {
            id: 'close',
            label: 'Close',
            danger: true,
            run: guarded(async () => {
              const ok = await d.confirm({ title: `Close ${c.name}?`, body: 'Its terminal ends, and the session with it.', confirm: 'Close', danger: true })
              if (ok) await d.endSession(pane)
            }),
          },
      copy(parent.session_id),
    ]
  }

  const robotItems = (r: ShipRobot, ship: Ship, ctx: MenuContext): MenuItem[] => {
    const pr = r.pr
    const merge = mergeRefusal(r, ship)
    return [
      { id: 'open', label: 'Open', run: () => ctx.open(r.id) },
      isRunning(r)
        ? {
            id: 'stop',
            label: 'Stop',
            hint: 'claude stop',
            danger: true,
            run: guarded(async () => {
              const ok = await d.confirm({ title: `Stop ${r.label}?`, body: 'claude stop: it keeps its conversation.', confirm: 'Stop', danger: true })
              if (ok) await act({ kind: 'stop', robotIds: [r.id] }, ship)
            }),
          }
        : { id: 'stop', label: 'Stop', hint: r.state === 'done' ? 'it has finished' : 'it is not running', danger: true, disabled: true, run: () => {} },
      merge || !pr
        ? { id: 'merge', label: 'Merge PR', hint: merge ?? 'no PR yet', disabled: true, run: () => {} }
        : {
            id: 'merge',
            label: 'Merge PR',
            hint: `#${pr.number}`,
            run: guarded(async () => {
              const ok = await d.confirm({ title: `Merge PR #${pr.number}?`, body: `${r.label}'s PR, merged once its checks pass.`, confirm: 'Merge' })
              if (ok) await act({ kind: 'merge', robotIds: [r.id] }, ship)
            }),
          },
      pr
        ? { id: 'open-pr', label: 'Open PR', hint: `#${pr.number}`, run: guarded(() => d.openUrl(pr.url)) }
        : { id: 'open-pr', label: 'Open PR', hint: 'no PR yet', disabled: true, run: () => {} },
      { id: 'changes', label: 'Changes', run: () => d.openWindow('changes', { robotId: r.id, worktree: r.child.cwd, label: r.label }) },
      copy(r.id),
    ]
  }

  return (target: MenuTarget, ship: Ship, ctx: MenuContext): MenuItem[] => {
    switch (target.kind) {
      case 'deck':
      case 'dock':
        return repoItems(target.id)
      case 'robot': {
        const r = robotById(ship, target.id)
        return r ? robotItems(r, ship, ctx) : []
      }
      case 'captain': {
        const c = captainById(ship, target.id)
        return c ? captainItems(c, ship, ctx) : []
      }
      case 'systems':
        return []
    }
  }
}

/** The repo a captain stands in: the deck or the dock it is on. */
function rootOfCaptain(ship: Ship, id: string): string | null {
  for (const deck of ship.decks) if ([...deck.captains, ...deck.quiet].some((c) => c.id === id)) return deck.root
  for (const dock of ship.docks) if (dock.captains.some((c) => c.id === id)) return dock.root
  return null
}

/** Why a robot's PR cannot be merged from here now, or null when it can (or it has none). */
function mergeRefusal(r: ShipRobot, ship: Ship): string | null {
  const pr = r.pr
  if (!pr) return null
  const state = (r.fate?.state ?? pr.state).toUpperCase()
  if (state === 'MERGED') return 'already merged'
  if (state === 'CLOSED') return 'the PR is closed'
  if (pr.draft) return 'a draft: mark it ready first'
  const elsewhere = otherRepo(repoRootOf(ship, r.child), pr)
  if (elsewhere) return elsewhere
  if (isGreen(r)) return null
  if (r.ci === 'red') return 'its checks failed'
  if (r.ci === 'wait' || r.ci === 'run') return 'its checks are still running'
  return 'no check has passed on it'
}

import { toast } from '@/ui'
import { accountsStore } from '../accounts/store'
import type { AccountsState } from '../accounts/types'
import { revealCard } from '../dashboard/store'
import { fleetStore } from '../fleet/store'
import type { Fleet } from '../fleet/types'
import { store as layoutStore } from '../layout/app-store'
import type { Actions } from '../layout/store'
import { onAccount, type AccountEnv, type OnAccount } from '../mission/account'
import { attachChild } from '../mission/rows'
import type { ChildSession } from '../mission/types'
import { shellStore } from '../shell/store'
import type { Archive, Nexus, Robot } from './types'

/** What a click does (spec Q15): a nexus shows its session's terminal (a dead one offers
 *  `claude --resume`; one alive outside the app is only named, never opened twice); a robot is
 *  `claude attach`ed; an archive opens its project's Memory panel. The drawer closes after. */

/** A toast's button. */
export type Offer = { label: string; run: () => void }

export type ActionDeps = {
  layout: () => Pick<Actions, 'switchWorktree' | 'goToPane' | 'openCommandTab'>
  fleet: () => Pick<Fleet, 'repos' | 'markRead'>
  /** Every account, to type a command on a parent session's own one; null until read. */
  accounts: () => AccountsState | null
  attach: (child: ChildSession) => void
  /** A sentence for the user, with a button when there is something to offer. */
  say: (text: string, offer?: Offer) => void
  /** Show the right sidebar's Memory panel for the worktree now shown. */
  showMemory: () => void
}

/** What a command typed for `nexus` needs to reach its account. A parent's own account comes from
 *  the accounts list; a dead parent has no `claude agents` row, so it takes its children's, which
 *  its own jobs dir holds. */
export function nexusAccount(nexus: Nexus, accounts: AccountsState | null): OnAccount | null {
  const id = nexus.parent?.account
  if (id && accounts && accounts.accounts.length > 1) {
    const a = accounts.accounts.find((x) => x.id === id)
    // The default account runs with `CLAUDE_CONFIG_DIR` unset, which a pane on another one needs said.
    if (a) return { account: id, account_env: { config_dir: a.isDefault ? null : a.configDir } satisfies AccountEnv }
  }
  return nexus.robots.find((r) => r.child.account_env)?.child ?? null
}

/** The pane running `sessionId` and the worktree that holds it, as the fleet knows them. */
function paneOf(fleet: Pick<Fleet, 'repos'>, sessionId: string): { worktreePath: string; paneId: number } | null {
  for (const r of fleet.repos)
    for (const w of r.worktrees)
      for (const a of w.agents) if (a.paneId !== null && (a.sessionId === sessionId || sessionId.startsWith(a.sessionId))) return { worktreePath: w.path, paneId: a.paneId }
  return null
}

export function makeActions(deps: ActionDeps) {
  const resumeCmd = (nexus: Nexus) => onAccount(`claude --resume ${nexus.sessionId}`, nexusAccount(nexus, deps.accounts()))

  return {
    openNexus(nexus: Nexus): void {
      if (nexus.pose === 'dead' || !nexus.parent) {
        deps.say(`${nexus.label} has ended; its children still run.`, {
          label: 'Resume',
          run: () => void deps.layout().openCommandTab(nexus.cwd || undefined, resumeCmd(nexus), nexus.sessionId),
        })
        return
      }
      const at = paneOf(deps.fleet(), nexus.sessionId)
      // Opening a live session a second time would fork it: one outside the app is only named.
      if (!at) return deps.say(`${nexus.label} runs outside the app, in ${nexus.cwd}.`)
      revealCard({ sessionId: nexus.sessionId, ...at }, { layout: deps.layout, fleet: deps.fleet })
    },

    openRobot(robot: Robot): void {
      deps.attach(robot.child)
    },

    openArchive(root: string, _archive: Archive): void {
      // The Memory panel reads the worktree shown, so the territory's main checkout is shown first.
      void deps.layout().switchWorktree(root)
      deps.fleet().markRead(root)
      deps.showMemory()
    },
  }
}

/** Opens the right sidebar and selects its Memory tab. The tab is the sidebar's own state, so it is
 *  picked the way the user would: by its button, once the sidebar is drawn. */
function showMemoryTab(): void {
  const shell = shellStore.getState()
  if (!shell.rightOpen) shell.toggleRight()
  const pick = (tries: number) => {
    const tab = document.querySelector<HTMLElement>('[data-right-sidebar] [role="tab"][aria-label^="Memory"]')
    if (tab) return void (tab.getAttribute('aria-selected') === 'true' || tab.click())
    if (tries > 0) requestAnimationFrame(() => pick(tries - 1))
  }
  pick(10)
}

const live = makeActions({
  layout: layoutStore.getState,
  fleet: fleetStore.getState,
  accounts: () => accountsStore.getState().state,
  attach: (child) => attachChild(child),
  say: (text, offer) => void toast(text, offer ? { action: { label: offer.label, onClick: offer.run } } : undefined),
  showMemory: showMemoryTab,
})

export const openNexus = (nexus: Nexus): void => live.openNexus(nexus)
export const openRobot = (robot: Robot): void => live.openRobot(robot)
export const openArchive = (root: string, archive: Archive): void => live.openArchive(root, archive)

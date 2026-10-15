import { mergeKey } from '../../cockpit/actions'
import { answerPrompt } from '../../cockpit/approve'
import { cockpitStore } from '../../cockpit/app-store'
import { runJob } from '../../cockpit/job'
import { mergeChecked } from '../../cockpit/merge'
import { jobState, type Job } from '../../cockpit/store'
import { ptySendPrompt } from '../../chat-input/pty'
import { fleetStore } from '../../fleet/store'
import { dispatchIssues, dispatchKey } from '../../github/actions'
import { stopCmd } from '../../mission/account'
import { answerQuestion, answerQuestionOther } from '../../mission/ask'
import { tauriMission } from '../../mission/client'
import type { ChildSession } from '../../mission/types'
import { paneShell, type Shell } from '../../pty/typed'
import { currentOs, type Os } from '../../setup/tools'
import { nexusRoutes } from '../outside'
import type { ActionResult, Ship, ShipAction } from '../ship-types'
import { basename } from '../../path/path'
import { act, type Outcome, type Paths } from './run'

/** What a job ended with, as one line: its error, else the last thing it printed. */
export function outcomeOf(j: Job | undefined): Outcome {
  if (!j) return { ok: false, why: 'it never started' }
  const last = [...j.lines].reverse().find((l) => l.line.trim())?.line.trim() ?? ''
  if (jobState(j) === 'ok') return { ok: true, why: last }
  return { ok: false, why: j.error ?? (last || `it exited ${j.code ?? 'on a signal'}`) }
}

/** Resolves once the cockpit job `key` is no longer running. */
export function jobEnded(key: string): Promise<Job> {
  return new Promise((resolve) => {
    let stop = () => {}
    const check = () => {
      const j = cockpitStore.getState().jobs[key]
      if (!j || j.running) return false
      stop()
      resolve(j)
      return true
    }
    stop = cockpitStore.subscribe(() => void check())
    check()
  })
}

const running = (key: string) => cockpitStore.getState().jobs[key]?.running === true

/** The key `land` runs under, one per contract. */
export const landKey = (root: string, contract: string) => `land:${root}#${contract}`

/** The suite `mnemo land`'s rehearsal runs after each merge, by repo: without `--suite` it runs
 *  mnemo's own default (`python -m pytest -q`), right for mnemo and red for any other repo. A
 *  rehearsal tree is a fresh worktree, so a pnpm repo installs first. On macOS this repo's suite
 *  takes the `DEVELOPER_DIR` / `PATH` prefix its `CLAUDE.md` gives. `mnemo land` splits the suite
 *  into argv and runs no shell, so the `&&`s go to one. */
const PNPM = 'pnpm install --frozen-lockfile && pnpm test && pnpm build'
const MAC_TOOLS = 'export DEVELOPER_DIR=/Library/Developer/CommandLineTools PATH=/Library/Developer/CommandLineTools/usr/bin:"$PATH"; '
export const LAND_SUITES: Record<string, Record<Os, string>> = {
  'mnemo-desktop': { mac: `sh -c '${MAC_TOOLS}${PNPM}'`, linux: `sh -c '${PNPM}'`, windows: `cmd /d /c "${PNPM}"` },
}

/** `mnemo land <contract> --merge`: the rehearsal (each piece merged in order in a throwaway
 *  worktree, the repo's suite after each), then the PRs merged in that order. It stops with
 *  nothing landed at the first conflict, missing signature or red suite. */
export function landArgv(root: string, contract: string, os: Os = currentOs()): string[] {
  const suite = LAND_SUITES[basename(root)]?.[os]
  return ['mnemo', 'land', contract, '--merge', ...(suite ? ['--suite', suite] : [])]
}

/** Commands typed on one line, one after the other whatever the last one did. */
const SEPARATOR: Record<Shell, string> = { posix: '; ', powershell: '; ', cmd: ' & ' }
export const stopLine = (children: ChildSession[], shell: Shell = paneShell()) => children.map((c) => stopCmd(c, shell)).join(SEPARATOR[shell])

/** The app's own paths (contract `command`): the mission's dialog answer, the cockpit's permission
 *  answer and checks-gated merge, `mnemo land` as a cockpit job, `claude stop` on each child's
 *  account typed into a terminal (as the home screen stops one), the inbox socket or a captain's
 *  pane (the chat input's prompt), and the GitHub view's dispatch. */
export const appPaths: Paths = {
  answerQuestion: (child, index) => answerQuestion(child, index),
  answerQuestionOther: (child, text) => answerQuestionOther(child, text),
  async answerPrompt(child, choice) {
    const a = await answerPrompt(child, choice)
    return a.phase === 'sent' ? { ok: true, why: '' } : { ok: false, why: a.error ?? 'not answered' }
  },
  async merge(root, pr) {
    if (running(mergeKey(root, pr))) return { ok: false, why: 'a merge of it is already running' }
    await mergeChecked(root, pr)
    return outcomeOf(cockpitStore.getState().jobs[mergeKey(root, pr)])
  },
  async land(root, mission) {
    const key = landKey(root, mission.contract_path)
    if (running(key)) return { ok: false, why: 'it is already landing' }
    void runJob(key, `land · ${mission.feature}`, root, landArgv(root, mission.contract_path))
    return outcomeOf(await jobEnded(key))
  },
  async stop(root, children) {
    // In a drawer tab, where the stop is asked from.
    await nexusRoutes().terminal(root, stopLine(children), `stop · ${basename(root) || root}`)
    return { ok: true, why: '(typed in a drawer tab)' }
  },
  reply: (id, text) => tauriMission.reply(id, text),
  paneOf(sessionId) {
    for (const r of fleetStore.getState().repos) for (const w of r.worktrees) for (const a of w.agents) if (a.sessionId === sessionId && a.paneId !== null) return a.paneId
    return null
  },
  prompt: (pane, text) => ptySendPrompt(pane, text),
  async dispatch(root, issues) {
    const key = dispatchKey(root, issues)
    if (running(key)) return { ok: false, why: 'the same dispatch is already running' }
    dispatchIssues(root, issues)
    return outcomeOf(await jobEnded(key))
  },
  now: () => Date.now(),
}

/** Does what an action says, with the app's own paths (spec "Acting from it"). The result says
 *  what happened in English and carries the `you` milestones for the ship's log. `open` is the
 *  view's. */
export async function runAction(action: ShipAction, ship: Ship): Promise<ActionResult> {
  return act(appPaths, action, ship)
}

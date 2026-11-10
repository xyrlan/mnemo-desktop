// Does what a parsed line asks, through `actions()` and nothing else. In the sample world the
// actions change the sample; in a live one `src/runtime/` carries the guards.

import { actions, type Outcome } from '../world/actions'
import { openOnStage } from '../world/route'
import { sessionOf } from '../world/store'
import type { World } from '../world/types'
import { nameOf, type Command } from './parse'

const failed = (e: unknown): Outcome => ({ ok: false, why: e instanceof Error ? e.message : String(e) })

/** Runs one command. A refusal comes back as words, never as an exception. */
export async function run(command: Command, world: World): Promise<Outcome> {
  const act = actions()
  try {
    switch (command.kind) {
      case 'go':
        openOnStage(command.session)
        return { ok: true }
      case 'new':
        return await act.newSession(command.root, { prompt: command.prompt ?? undefined, agent: command.agent ?? undefined })
      case 'shell':
        return await act.newShell(command.root)
      case 'dispatch':
        return await act.dispatch(command.root, command.issues, command.options)
      case 'contract':
        return await act.dispatchContract(command.root, command.path, command.options)
      case 'message':
        return await act.message(command.to, command.text)
      case 'merge-green':
        return await act.mergeGreen()
      case 'land':
        return await act.land(command.root, command.feature)
      case 'stop': {
        // One at a time, each reported: a stop that is refused does not hide the ones that went.
        const not: string[] = []
        let stopped = 0
        for (const id of command.sessions) {
          const s = sessionOf(world, id)
          const o = await act.stop(id).catch(failed)
          if (o.ok) stopped++
          else not.push(`${s ? nameOf(s) : id}: ${o.why}`)
        }
        if (not.length) return { ok: false, why: `${stopped ? `${stopped} stopped. ` : ''}Not stopped: ${not.join(' · ')}` }
        return { ok: true, note: command.sessions.length > 1 ? `${stopped} stopped` : undefined }
      }
    }
  } catch (e) {
    return failed(e)
  }
}

/** What the command line says once a command ran: the action's own note when it has one. */
export function said(says: string, outcome: Outcome): string {
  if (!outcome.ok) return outcome.why
  return outcome.note ? `${says} · ${outcome.note}` : says
}

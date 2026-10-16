/** What a pane types to start a session on an account's CLI (spec
 *  `2026-10-16-grok-accounts-design.md`, decisions 3 and 4): a new one, under an id the app chose,
 *  or one resumed. The pane runs on the account already (its environment came with it), so this is
 *  the CLI's own words alone; a command for another account goes through `onAccount`.
 *
 *  - **Claude:** `claude [--dangerously-skip-permissions] [--resume <id> | --session-id <id>]`, as the
 *    app always typed it.
 *  - **Grok:** `grok --leader [--always-approve] [-r <id> | -s <id>]`. `--leader` runs the TUI as a
 *    client of the home's leader, so the session is in its roster (decision 4); it is hidden in
 *    `grok --help` and read from `xai-grok-pager/src/app/cli.rs`. `--always-approve` is what Grok
 *    calls skipping its permission prompts (`--dangerously-skip-permissions` is an alias of it).
 *    `-s` names a new session (a UUID that is not in use; the TUI sends it to the leader as
 *    `session/new`'s `_meta.sessionId`), `-r` resumes one by id from any directory. All measured
 *    on grok 1.0.60's `--help` and read from `github.com/xai-org/grok-build` at `2bdd1d6`. */

import type { AgentKind } from './kind'

export type SessionOpts = { sessionId?: string; resume?: string; skipPermissions?: boolean }

/** The session `opts` asks for on `kind`'s CLI: `resume` when given (a session id given with it is
 *  not used: neither CLI names a resumed session anew without forking it), else a new session under
 *  `sessionId`, else a new one under an id of the CLI's choosing. */
export function sessionCommand(kind: AgentKind, opts: SessionOpts): string {
  const words: string[] =
    kind === 'grok'
      ? ['grok', '--leader', ...(opts.skipPermissions ? ['--always-approve'] : [])]
      : ['claude', ...(opts.skipPermissions ? ['--dangerously-skip-permissions'] : [])]
  if (opts.resume) words.push(kind === 'grok' ? '-r' : '--resume', opts.resume)
  else if (opts.sessionId) words.push(kind === 'grok' ? '-s' : '--session-id', opts.sessionId)
  return words.join(' ')
}

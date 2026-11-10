import { describe, expect, test } from 'vitest'
import { parent } from '../mission/fixtures'
import type { RepoGroup, Snapshot } from '../mission/types'
import type { HomeSnapshot } from '../home/types'
import type { RepoNode } from '../fleet/types'
import { buildRepos, knownRepos, worktreeName, type Tracked } from '../fleet/model'
import { alertFor, cardKey, onScreen } from '../notify/decide'
import { agentForCwd } from '../vault/search'

/** One repo as it reaches the front end on Windows: git prints `C:/…`; the OS, a folder picker and
 *  Claude Code `C:\…`; `canonicalize` `\\?\C:\…`. Each caller is given one and asked about another. */
const GIT = 'C:/Users/you/repo'
const OS = 'C:\\Users\\you\\repo'
const VERBATIM = '\\\\?\\C:\\Users\\you\\repo'
const GIT_WT = 'C:/Users/you/repo-wt-322'
const OS_WT = 'C:\\Users\\you\\repo-wt-322'

const home: HomeSnapshot = { repos: [], clone_base: '', errors: [], protected: 0 }
const tracked = (sessionId: string, cwd: string): Tracked => ({ sessionId, cwd, state: 'working', waitingFor: null, since: 1, flaggedAt: 1, hookAt: null, name: null })
const info = (path: string, isMain: boolean) => ({ path, branch: null, head: '', isMain, dispatched: !isMain, dirty: false, setupJob: null })

/** Git's listing of the repo and its tree; sessions run in the OS spelling. */
function fleet(): RepoNode[] {
  return buildRepos({
    repos: [{ root: GIT, name: 'repo' }],
    worktrees: new Map([[GIT, [info(GIT, true), info(GIT_WT, false)]]]),
    agents: [tracked('main-session', `${OS}\\src`), tracked('wt-session', OS_WT)],
    home,
    panes: {},
    prs: { byCwd: new Map(), byBranch: new Map() },
    readAt: new Map(),
  })
}

function snap(over: Partial<RepoGroup> = {}): Snapshot {
  return {
    repos: [{ root: GIT, name: 'repo', parents: [parent({ session_id: 'p', status: 'busy', cwd: OS, name: 'the parent' })], missions: [], children: [], ...over }],
    errors: [],
    at: '2026-10-14T00:00:00Z',
  }
}

describe('fleet (#322 finding 2)', () => {
  test('a session whose cwd is spelt with backslashes is in its worktree', () => {
    const [repo] = fleet()
    expect(repo.worktrees.map((w) => [w.path, w.agents.map((a) => a.sessionId), w.unread])).toEqual([
      [GIT, ['main-session'], true],
      [GIT_WT, ['wt-session'], true],
    ])
  })
  test('a worktree is named by its folder, and a repo Home spells otherwise is still one repo', () => {
    expect(worktreeName({ path: OS_WT, isMain: false }, VERBATIM)).toBe('322')
    const fromHome = { ...home, repos: [{ root: VERBATIM, name: 'repo' } as HomeSnapshot['repos'][number]] }
    expect(knownRepos(fromHome, snap()).map((r) => r.root)).toEqual([GIT])
  })
})

describe('notify', () => {
  test('an alert names the worktree and is seen as looked at in any spelling', () => {
    const a = alertFor({ sessionId: 's', cwd: `${OS_WT}\\src`, kind: 'stop', at: 1 }, fleet())
    expect(a).toMatchObject({ worktree: GIT_WT, name: '322', repo: 'repo' })
    expect(alertFor({ sessionId: 's', cwd: 'D:\\elsewhere\\notes\\', kind: 'stop', at: 1 }, fleet())?.name).toBe('notes')
    expect(cardKey('s', OS_WT, fleet())).toBe(`tree:${GIT_WT}`)
    expect(onScreen({ sessionId: 's', worktree: GIT_WT }, { focused: true, shown: { sessionId: null, worktree: VERBATIM + '-wt-322' } })).toBe(true)
  })
})

describe('vault (#323 finding 4)', () => {
  test("the vault knows the repo of a folder", () => {
    const agents = [{ name: 'repo', kind: 'repo' as const }]
    expect(agentForCwd(OS, agents)).toBe('repo')
    expect(agentForCwd(`${OS_WT}\\src`, agents)).toBe('repo')
  })
})

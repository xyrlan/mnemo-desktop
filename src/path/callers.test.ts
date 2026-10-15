import { describe, expect, test } from 'vitest'
import { parent } from '../mission/fixtures'
import type { RepoGroup, Snapshot } from '../mission/types'
import type { HomeSnapshot } from '../home/types'
import type { RepoNode } from '../fleet/types'
import { buildRepos, knownRepos, worktreeName, type Tracked } from '../fleet/model'
import { alertFor, cardKey, onScreen } from '../notify/decide'
import { prefill, resolvePath } from '../editor/paths'
import { agentForCwd } from '../vault/search'
import { focusedFirst, paneCwd, repoOfCwd } from '../mission/scope'
import { relativeTo } from '../conversation/run'

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

describe('Open file… (#321 finding 4)', () => {
  const root = OS
  const me = 'C:\\Users\\you'
  test('opens what is typed or picked, as an absolute Windows path', () => {
    expect(prefill(root)).toBe(`${OS}\\`)
    expect(prefill(GIT)).toBe(`${GIT}/`)
    expect(resolvePath(`${prefill(root)}src\\a.ts`, root, me)).toBe(`${GIT}/src/a.ts`)
    expect(resolvePath('C:/Users/you/repo/src/a.ts', root, me)).toBe(`${GIT}/src/a.ts`)
    expect(resolvePath('src/a.ts', root, me)).toBe(`${GIT}/src/a.ts`)
    expect(resolvePath('src\\..\\b.ts', root, me)).toBe(`${GIT}/b.ts`)
    expect(resolvePath('~/notes.md', root, me)).toBe('C:/Users/you/notes.md')
    expect(resolvePath('~\\notes.md', root, me)).toBe('C:/Users/you/notes.md')
    expect(resolvePath('d:\\x\\..\\..\\y.txt', root, me)).toBe('D:/y.txt')
    expect(resolvePath('\\\\server\\share\\..\\a.txt', root, me)).toBe('//server/share/a.txt')
  })
})

describe('vault (#323 finding 4)', () => {
  test("the vault knows the repo of a folder", () => {
    const agents = [{ name: 'repo', kind: 'repo' as const }]
    expect(agentForCwd(OS, agents)).toBe('repo')
    expect(agentForCwd(`${OS_WT}\\src`, agents)).toBe('repo')
  })
})

describe('mission scope', () => {
  test("an editor pane's folder, and the repo a folder is in, across spellings", () => {
    expect(paneCwd({ id: 1, view: 'editor', props: { path: `${OS}\\README.md` } }, snap())).toBe(GIT)
    expect(repoOfCwd(snap(), `${VERBATIM}\\src`)?.name).toBe('repo')
    const two: Snapshot = { ...snap(), repos: [{ ...snap().repos[0], root: 'C:/other', name: 'other' }, snap().repos[0]] }
    expect(focusedFirst(two, OS).map((r) => r.name)).toEqual(['repo', 'other'])
  })
})

describe('conversation (#322 finding 6)', () => {
  test('a path inside the worktree is shortened in its own spelling', () => {
    expect(relativeTo(`${OS}\\src\\app.ts`, OS)).toBe('src\\app.ts')
    expect(relativeTo(`${OS}\\src\\app.ts`, GIT)).toBe('src\\app.ts')
    expect(relativeTo(`${GIT}/src/app.ts`, VERBATIM)).toBe('src/app.ts')
    expect(relativeTo('D:\\other\\app.ts', OS)).toBe('D:\\other\\app.ts')
  })
})

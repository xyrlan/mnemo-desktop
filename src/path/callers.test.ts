import { describe, expect, test } from 'vitest'
import { child, parent } from '../mission/fixtures'
import type { RepoGroup, Snapshot } from '../mission/types'
import type { HomeSnapshot } from '../home/types'
import type { Pane, Tab } from '../layout/store'
import type { RepoNode } from '../fleet/types'
import { buildRepos, knownRepos, worktreeName, type Tracked } from '../fleet/model'
import { parentOf, wavesOf } from '../dispatch/model'
import { dispatchPane } from '../dispatch/open'
import { activePath } from '../sidebar/model'
import { alertFor, cardKey, looking } from '../notify/decide'
import { paneForSession, paneName } from '../layout/tabs'
import { barInfo, paneParent } from '../chrome/info'
import { resolveAgent } from '../browser/grab-agent'
import { noAgent } from '../checks/agent'
import { prefill, resolvePath } from '../editor/paths'
import { agentForCwd } from '../vault/search'
import { importCwd } from '../marketplace/cwd'
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
const leaf = (pane: number): Tab['root'] => ({ kind: 'leaf', pane })
const term = (id: number, cwd: string, over: Partial<Pane> = {}): Pane => ({ id, view: 'terminal', cwd, ...over })
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
  test('the active card matches the worktree shown in any spelling', () => {
    expect(activePath(OS_WT, fleet())).toBe(GIT_WT)
  })
})

describe('dispatch (#322 finding 2)', () => {
  const kid = child({ id: 'k', parent_session: 'p', cwd: `${OS}-wt-k`, updated_at: '2026-10-14T00:00:00Z' })
  test("a live parent's children are in its tab", () => {
    const s = snap({ children: [kid] })
    expect(parentOf(s, 'k', [GIT, GIT_WT])).toBe(GIT)
    expect(wavesOf(s, OS, [GIT, GIT_WT], () => undefined, Date.parse('2026-10-14T00:00:00Z')).flatMap((w) => w.rows.map((r) => r.key))).toEqual(['k'])
  })
  test("a parent's Dispatch tab is found whichever spelling asks", () => {
    const s = { tabs: [{ id: 't', root: leaf(1), focused: 1 }], panes: { 1: { id: 1, view: 'dispatch', props: { parent: GIT } } } }
    expect(dispatchPane(s, VERBATIM)?.pane).toBe(1)
  })
})

describe('notify', () => {
  test('an alert names the worktree and is seen as looked at in any spelling', () => {
    const a = alertFor({ sessionId: 's', cwd: `${OS_WT}\\src`, kind: 'stop', at: 1 }, fleet())
    expect(a).toMatchObject({ worktree: GIT_WT, name: '322', repo: 'repo' })
    expect(alertFor({ sessionId: 's', cwd: 'D:\\elsewhere\\notes\\', kind: 'stop', at: 1 }, fleet())?.name).toBe('notes')
    expect(cardKey('s', OS_WT, fleet())).toBe(`tree:${GIT_WT}`)
    expect(looking({ worktree: GIT_WT }, { focused: true, shown: VERBATIM + '-wt-322', shownPanes: [], pane: null })).toBe(true)
  })
})

describe('tabs and the pane bar (#324 finding 6)', () => {
  test('a pane is named by its folder and an editor tab by its file', () => {
    const empty: Snapshot = { repos: [], errors: [], at: '' }
    expect(paneName(term(1, OS), empty, home)).toBe('repo')
    expect(paneName({ id: 2, view: 'editor', props: { path: `${OS}\\src\\main.rs` } }, empty, home)).toBe('editor · main.rs')
    expect(barInfo(term(1, 'D:\\scratch\\'), empty).place).toBe('scratch')
  })
  test('a session is found in the terminal sitting in its folder, across spellings', () => {
    const s = { tabs: [{ id: 't', root: leaf(1), focused: 1 }], panes: { 1: term(1, GIT) } }
    expect(paneForSession(s, { session_id: null, cwd: OS })).toBe(1)
    expect(paneParent(term(1, `${GIT}/`), GIT, snap())?.session_id).toBe('p')
    expect(barInfo(term(1, VERBATIM), snap())).toMatchObject({ place: 'repo', tokens: undefined })
  })
  test('Design Mode and Checks find the agent of the worktree shown', () => {
    const w = { worktree: OS_WT, repos: fleet(), panes: {}, children: [child({ id: 'c', cwd: `${GIT_WT}/src` })] }
    expect(resolveAgent({ ...w, repos: [] })).toEqual({ kind: 'mission', id: 'c', title: 'c' })
    expect(resolveAgent({ ...w, repos: [], children: [] })).toEqual({ kind: 'none', reason: 'no agent is running in repo-wt-322' })
    expect(resolveAgent({ ...w, children: [] })).toMatchObject({ kind: 'none', reason: expect.stringContaining('runs outside') })
    expect(noAgent({ ...w, repos: [] })).toBe(false)
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

describe('vault and marketplace (#323 finding 4)', () => {
  test("the vault knows the repo of a pane's folder", () => {
    const agents = [{ name: 'repo', kind: 'repo' as const }]
    expect(agentForCwd(OS, agents)).toBe('repo')
    expect(agentForCwd(`${OS_WT}\\src`, agents)).toBe('repo')
  })
  test("the marketplace imports into the folder of an editor pane's file", () => {
    const s = { tabs: [{ id: 't', root: leaf(1), focused: 1 }], activeTab: 't', panes: { 1: { id: 1, view: 'editor', props: { path: `${OS}\\README.md` } } } }
    expect(importCwd(s)).toBe(GIT)
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

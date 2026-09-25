// The Dispatch tab (dispatch-b · dispatch-tab), open to the side of the parent's terminal: the
// parent session dispatched wave `dispatch-b` from the main checkout, and wave `tab-groups-view`
// before it. One section per wave, newest first, then Issues:
//
// - `dispatch-b`: two children need you, on top, each with its answer card open in its row (a
//   permission prompt: the approval card; the multiple-choice dialog: the question card), one
//   working, and one done, folded under "Show 1 done";
// - `tab-groups-view`: finished, every PR green, so it folds and says it can land;
// - `dispatch-a` is not there: its PRs are merged and none of its children runs;
// - Issues: a child dispatched with no contract.
//
// The tab's title carries the alert: "Dispatch · 2 need you". Nothing is selected: the right
// side says what picking a child shows.
//
// - `dispatch-tab-selected`: ⌘K's "Dispatch: … · dispatch-tab" picked; the working child is
//   selected, its conversation on the right.
// - `dispatch-tab-answering`: a child that needs you selected: its card is the conversation's
//   foot on the right, and its row points there instead of drawing it twice.
// - `dispatch-tab-opens`: the parent's terminal alone, then `dispatch-b`'s children show up in the
//   next snapshot: the tab opens by itself to the right, and the terminal keeps the keys (its
//   group's row carries the accent).
import { readFileSync } from 'node:fs'
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const PARENT = '0ff9d810-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
const NOW = Date.now()
const ago = (min) => new Date(NOW - min * 60_000).toISOString()
const wt = (piece) => `${HOME}/code/mnemo-desktop-wt-c-${piece}`
// A real child transcript, scrubbed (src/conversation/fixtures/README.md).
const TRANSCRIPT = readFileSync(new URL('../../../src/conversation/fixtures/bg-child.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean)

/** The transcript with one more call the child is parked on: no result has come back for it. */
function parkedOn(name, input) {
  const last = JSON.parse(TRANSCRIPT.findLast((l) => JSON.parse(l).uuid))
  const record = {
    parentUuid: last.uuid,
    isSidechain: false,
    type: 'assistant',
    uuid: `preview-${name}`,
    timestamp: new Date(NOW - 60_000).toISOString(),
    sessionId: last.sessionId,
    message: { role: 'assistant', type: 'message', content: [{ type: 'tool_use', id: `toolu_preview_${name}`, name, input }], stop_reason: 'tool_use' },
  }
  return [...TRANSCRIPT, JSON.stringify(record)]
}

const child = (id, piece, over) => ({
  id,
  session_id: `${id}-5c2f-4e1a-9b44-2e6f8c1d0b77`,
  name: piece,
  state: 'working',
  tempo: 'active',
  needs: null,
  detail: '',
  suggested_reply: null,
  cwd: wt(piece),
  tokens: 212_000,
  live: true,
  updated_at: ago(2),
  intent: null,
  branch: null,
  timeline_len: 3,
  parent_session: PARENT,
  waiting_for: null,
  model: 'opus[1m]',
  effort: 'xhigh',
  ...over,
})
const pr = (number, head, over) => ({ number, url: `https://github.com/xyrlan/mnemo-desktop/pull/${number}`, state: 'OPEN', head, ci: 'pass', draft: false, failing: [], ...over })
const piece = (feature, name, c, p = null) => ({ name, branch: `feat/${feature}/${name}`, child: c && { ...c, branch: `feat/${feature}/${name}` }, pr: p })
const contract = (name) => `${REPO}/docs/superpowers/contracts/2026-09-25-${name}.md`

const ROUTING = child('7c1e2a90', 'child-routing', {
  tempo: 'blocked',
  needs: 'approve Bash: pnpm test src/sidebar/',
  waiting_for: 'permission prompt',
  detail: 'running the sidebar tests',
  updated_at: ago(1),
})
const LINES = child('a43d3832', 'wave-lines', { tempo: 'blocked', needs: 'Where does a wave line go when its wave is finished?', waiting_for: 'input needed', updated_at: ago(3) })
const TAB = child('5e0b77c1', 'dispatch-tab', { detail: 'writing the tab’s rows and their answer cards', updated_at: ago(0.5) })
const TITLE = child('c93f4d12', 'tab-title', { state: 'done', live: false, detail: 'opened PR #274', updated_at: ago(24) })
const FLAKY = child('e2d4f6a8', 'fix-flaky-shot', { branch: 'fix/flaky-preview-shot', detail: 'rerunning the preview harness 20 times', updated_at: ago(6) })

const missions = [
  {
    feature: 'dispatch-a',
    contract_path: contract('dispatch-a'),
    landable: false,
    pieces: [
      piece('dispatch-a', 'wave-grouping', child('11aa22bb', 'wave-grouping', { state: 'done', live: false, updated_at: ago(300) }), pr(264, 'feat/dispatch-a/wave-grouping', { state: 'MERGED' })),
      piece('dispatch-a', 'child-answers', null, pr(266, 'feat/dispatch-a/child-answers', { state: 'MERGED' })),
    ],
  },
  {
    feature: 'tab-groups-view',
    contract_path: contract('tab-groups-view'),
    landable: true,
    pieces: [
      piece('tab-groups-view', 'workbench-groups', child('33cc44dd', 'workbench-groups', { state: 'done', live: false, updated_at: ago(90) }), pr(270, 'feat/tab-groups-view/workbench-groups')),
      piece('tab-groups-view', 'file-open', child('55ee66ff', 'file-open', { state: 'done', live: false, updated_at: ago(80) }), pr(269, 'feat/tab-groups-view/file-open')),
    ],
  },
  {
    feature: 'dispatch-b',
    contract_path: contract('dispatch-b'),
    landable: false,
    pieces: [
      piece('dispatch-b', 'dispatch-tab', TAB),
      piece('dispatch-b', 'child-routing', ROUTING),
      piece('dispatch-b', 'wave-lines', LINES),
      piece('dispatch-b', 'tab-title', TITLE, pr(274, 'feat/dispatch-b/tab-title', { ci: 'fail', failing: ['test (macos-latest)'] })),
    ],
  },
]

const snapshot = {
  repos: [{ root: REPO, name: 'mnemo-desktop', parents: [{ session_id: PARENT, pid: 4242, name: 'dispatch-b', status: 'busy', cwd: REPO }], missions, children: [FLAKY] }],
  errors: [],
  at: new Date(NOW).toISOString(),
}

const transcripts = {
  [ROUTING.session_id]: parkedOn('Bash', { command: 'pnpm test src/sidebar/', description: 'Run the sidebar tests' }),
  [LINES.session_id]: parkedOn('AskUserQuestion', {
    questions: [
      {
        question: 'Where does a wave line go when its wave is finished?',
        header: 'Wave lines',
        multiSelect: false,
        options: [
          { label: 'It stays, folded', description: 'Until every PR is merged' },
          { label: 'It leaves the card', description: 'As soon as nothing runs' },
        ],
      },
    ],
  }),
}

const leaf = (pane) => ({ kind: 'leaf', pane })
let next = 1

/** The main checkout: the parent's terminal, and to its right the Dispatch tab when `withTab`. */
function workspace(withTab) {
  const terminal = { id: 'group-1', tabs: ['tab-1'], activeTab: 'tab-1' }
  return {
    version: 3,
    activeWorktree: REPO,
    worktrees: [
      {
        path: REPO,
        tabs: [{ id: 'tab-1', root: leaf(1), focused: 1 }, ...(withTab ? [{ id: 'tab-2', root: leaf(2), focused: 2 }] : [])],
        panes: { 1: { view: 'terminal', cwd: REPO, sessionId: PARENT }, ...(withTab ? { 2: { view: 'dispatch', props: { parent: REPO } } } : {}) },
        groups: withTab ? { 'group-1': terminal, 'group-2': { id: 'group-2', tabs: ['tab-2'], activeTab: 'tab-2' } } : { 'group-1': terminal },
        groupRoot: withTab
          ? { kind: 'split', dir: 'row', ratio: 0.36, children: [{ kind: 'group', group: 'group-1' }, { kind: 'group', group: 'group-2' }] }
          : { kind: 'group', group: 'group-1' },
        activeGroup: 'group-1',
        activeTab: 'tab-1',
      },
    ],
  }
}

const ipc = appIpc({
  home_snapshot: {
    repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 0, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
    clone_base: `${HOME}/code`,
    errors: [],
    protected: 0,
  },
  worktree_list: [
    { path: REPO, branch: 'refs/heads/main', head: 'abc', isMain: true, dispatched: false, dirty: false, setupJob: null },
    ...['dispatch-tab', 'child-routing', 'wave-lines', 'fix-flaky-shot'].map((p) => ({ path: wt(p), branch: `refs/heads/feat/dispatch-b/${p}`, head: 'def', isMain: false, dispatched: true, dirty: true, setupJob: null })),
  ],
  mission_snapshot: snapshot,
  mission_looked: {},
  mission_mark_looked: null,
  mission_timeline: { lines: [{ at: ago(40), state: 'working', detail: 'reading the contract', text: '' }], total: 1 },
  workspace_read: () => workspace(true),
  workspace_live_sessions: ({ ids }) => ids,
  pty_spawn: ({ onOutput }) => {
    setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
    return next++
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4242,
  chrome_repo: 'mnemo-desktop',
  chrome_branch: 'main',
  chrome_session: PARENT,
  gh_auth: { installed: true, logged: true, login: 'preview', scopes: ['repo'] },
  child_memory: { briefing: null, injected: [], friction: [], mcp_reads: null },
  conversation_follow: ({ sessionId, onEvent }) => {
    const lines = transcripts[sessionId] ?? TRANSCRIPT
    setTimeout(() => onEvent.send({ kind: 'lines', start: 0, end: lines.join('\n').length + 1, lines }), 50)
    return 1
  },
  conversation_unfollow: null,
  usage_log: null,
  // The detail's Diff and Checks, for whichever child is picked.
  worktree_diff_files: ({ worktree, base }) => ({
    root: worktree,
    truncated: false,
    base: base === undefined ? null : 'main @ c2a2e15',
    files: [
      { path: 'src/dispatch/model.ts', oldPath: null, status: 'added', additions: 164, deletions: 0, binary: false },
      { path: 'src/dispatch/list.tsx', oldPath: null, status: 'added', additions: 212, deletions: 0, binary: false },
    ],
  }),
  worktree_diff_file: () => ({ original: '', modified: "export const ISSUES = 'Issues'\n", binary: false, tooLarge: false }),
  checks_read: ({ worktree }) => ({
    root: worktree,
    branch: 'feat/dispatch-b/tab-title',
    pr: {
      number: 274,
      title: 'feat(dispatch): the tab carries the alert in its title',
      url: 'https://github.com/xyrlan/mnemo-desktop/pull/274',
      state: 'open',
      base: 'main',
      head: 'feat/dispatch-b/tab-title',
      headSha: 'de92f99410241cdcb2de6aad015b0482e065943e',
      author: 'xyrlan',
      mergeable: 'MERGEABLE',
      mergeState: 'UNSTABLE',
      reviewDecision: null,
      updatedAt: ago(20),
      additions: 48,
      deletions: 3,
      changedFiles: 2,
    },
    checks: [
      { name: 'test (macos-latest)', workflow: 'ci', verdict: 'fail', status: 'completed', conclusion: 'failure', url: null, description: null, startedAt: ago(30), completedAt: ago(22), jobId: null },
      { name: 'test (ubuntu-latest)', workflow: 'ci', verdict: 'pass', status: 'completed', conclusion: 'success', url: null, description: null, startedAt: ago(30), completedAt: ago(24), jobId: null },
    ],
    threads: [],
    comments: [],
    threadsError: null,
    mergeMethods: ['squash'],
  }),
})

scenario('dispatch-tab', { ipc })

// The first snapshot is what was there before anything watched: `dispatch-b` is not in it yet.
let polls = 0
const before = { ...snapshot, repos: [{ ...snapshot.repos[0], missions: missions.filter((m) => m.feature !== 'dispatch-b'), children: [] }] }
scenario('dispatch-tab-opens', {
  ipc: (cmd, args) => {
    if (cmd === 'workspace_read') return workspace(false)
    if (cmd === 'mission_snapshot') return polls++ === 0 ? before : { ...snapshot, at: new Date().toISOString() }
    return ipc(cmd, args)
  },
  // Nothing to emit: the shot waits for two more mission polls (every 3 s), the first of which may
  // land before the workspace restore has the parent's terminal back.
  events: [{ event: 'preview://wait', payload: null, afterMs: 7000 }],
})

scenario('dispatch-tab-selected', {
  ipc,
  events: [{ event: 'app://action', payload: { id: `dispatch.child.${TAB.id}` }, afterMs: 900 }],
})

scenario('dispatch-tab-answering', {
  ipc,
  events: [{ event: 'app://action', payload: { id: `dispatch.child.${ROUTING.id}` }, afterMs: 900 }],
})

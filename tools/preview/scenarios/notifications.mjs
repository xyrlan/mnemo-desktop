// Agents in worktrees that are not on screen finishing and asking: the notification stack at the
// bottom right, one card per agent, newest at the bottom.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const tree = (name, branch, extra = {}) => ({ path: `${REPO}/.claude/worktrees/${name}`, branch, head: 'a'.repeat(40), isMain: false, dispatched: false, dirty: false, setupJob: null, ...extra })

const agentEvent = (sessionId, cwd, kind, message, afterMs) => ({
  event: 'agent://event',
  payload: { sessionId, cwd, kind, at: Date.parse('2026-09-24T12:00:00Z') + afterMs, ...(message ? { message } : {}) },
  afterMs,
})

scenario('notifications', {
  ipc: appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 0, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    worktree_list: [
      { path: REPO, branch: 'main', head: 'b'.repeat(40), isMain: true, dispatched: false, dirty: false, setupJob: null },
      tree('feat-login', 'feat/login'),
      tree('fix-ci', 'fix/ci', { dispatched: true }),
      tree('docs', 'docs/readme'),
    ],
    agent_notify: null,
  }),
  // After the fleet has listed the worktrees; the main checkout is on screen, so its own stop
  // (the first event) raises nothing.
  events: [
    agentEvent('s-main', REPO, 'stop', null, 1500),
    agentEvent('s-login', `${REPO}/.claude/worktrees/feat-login`, 'stop', null, 1600),
    agentEvent('s-ci', `${REPO}/.claude/worktrees/fix-ci/src-tauri`, 'notification', 'Claude needs your permission to use Bash', 1700),
    agentEvent('s-docs', `${REPO}/.claude/worktrees/docs`, 'notification', 'Claude has a question: which README section?', 1800),
  ],
})

// Claude accounts (src/accounts/): two accounts, Personal active. The left sidebar's header shows
// Personal and its tightest limit; the accounts open from it. Work's token has expired, so its
// reading is two hours old and says why, and it carries a limit kind the app does not know. A
// terminal tab split in two: the right pane was spawned on Work before a switch, so its bar says
// it runs on Work. `accounts-one` is the same with only the default account: no pane says one.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const now = Date.now()
const at = (h) => new Date(now + h * 3600_000).toISOString()

const PERSONAL = { id: 'default', label: 'Personal', configDir: `${HOME}/.claude`, isDefault: true, email: 'me@example.com', problem: null }
const WORK = {
  id: 'work',
  label: 'Work',
  configDir: `${HOME}/.claude-work`,
  isDefault: false,
  email: 'me@work.example.com',
  problem: 'history.jsonl is no longer a link to ~/.claude/history.jsonl: Claude Code replaced it with a copy.',
}

const limit = (kind, group, percent, resetsH, more = {}) => ({ kind, group, model: null, percent, severity: 'normal', resetsAt: resetsH === null ? null : at(resetsH), active: false, ...more })

const USAGE = {
  default: {
    limits: [
      limit('session', 'session', 34, 3.2),
      limit('weekly_all', 'weekly', 36, 5 * 24 + 4, { active: true }),
      limit('weekly_scoped', 'weekly', 0, 5 * 24 + 4, { model: 'Fable' }),
    ],
    plan: 'max',
    fetchedAt: now - 20_000,
    stale: null,
  },
  work: {
    limits: [
      limit('session', 'session', 87, 1.5, { severity: 'warning', active: true }),
      limit('weekly_all', 'weekly', 62, 2 * 24 + 7),
      limit('weekly_scoped', 'weekly', 100, 2 * 24 + 7, { model: 'Opus', severity: 'critical' }),
      limit('monthly_extra', 'monthly', 12, null),
    ],
    plan: 'pro',
    fetchedAt: now - 2 * 3600_000 - 5 * 60_000,
    stale: 'The token has expired; Claude Code renews it the next time it runs on this account.',
  },
}

const leaf = (pane) => ({ kind: 'leaf', pane })

function ipc(accounts, panes) {
  let next = 1
  return appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 0, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    },
    worktree_list: [{ path: REPO, branch: 'refs/heads/main', head: 'abc', isMain: true, dispatched: false, dirty: false, setupJob: null }],
    mission_looked: {},
    workspace_read: {
      version: 3,
      activeWorktree: REPO,
      worktrees: [
        {
          path: REPO,
          tabs: [{ id: 'tab-1', root: { kind: 'split', dir: 'row', ratio: 0.5, children: [leaf(1), leaf(2)] }, focused: 1 }],
          panes: { 1: { view: 'terminal', cwd: REPO }, 2: { view: 'terminal', cwd: REPO } },
          groups: { 'group-1': { id: 'group-1', tabs: ['tab-1'], activeTab: 'tab-1' } },
          groupRoot: { kind: 'group', group: 'group-1' },
          activeGroup: 'group-1',
          activeTab: 'tab-1',
        },
      ],
    },
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
    accounts_list: { active: 'default', accounts },
    accounts_switch: ({ id }) => ({ active: id, accounts }),
    accounts_panes: panes,
    plan_usage: ({ configDir }) => {
      const a = accounts.find((x) => x.configDir === configDir)
      if (!a) throw `No account at ${configDir}.`
      return USAGE[a.id]
    },
  })
}

scenario('accounts', { ipc: ipc([PERSONAL, WORK], { 1: 'default', 2: 'work' }) })
scenario('accounts-one', { ipc: ipc([PERSONAL], { 1: 'default', 2: 'default' }) })

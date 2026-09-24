// The Tasks pane, open as the only tab: two repos' open issues and PRs after a GitHub read, one
// issue already worked on by a dispatch child.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO, HOME } from '../fixtures/app.mjs'

const OTHER = `${HOME}/code/mnemo`
const issue = (repo, number, title, labels = []) => ({
  number,
  title,
  labels,
  assignees: [],
  state: 'OPEN',
  url: `https://github.com/me/${repo}/issues/${number}`,
  updated_at: '2026-09-24T10:00:00Z',
  milestone: null,
  prs: [],
  pieces: [],
})
const pr = (repo, number, title, state, checks, child = null) => ({ number, title, state, checks, child, url: `https://github.com/me/${repo}/pull/${number}` })
const repo = (root, name, issues, prs) => ({ root, name, last_at: Date.parse('2026-09-24T11:00:00Z'), pinned: false, hidden: false, unresolved: false, sessions: [], children: [], issues, prs })

scenario('tasks', {
  ipc: appIpc({
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'tasks', cwd: REPO } },
      activeTab: 'tab-1',
    },
    home_snapshot: {
      repos: [
        repo(
          REPO,
          'mnemo-desktop',
          [
            issue('mnemo-desktop', 214, 'Terminal loses scrollback after the window sleeps', ['bug']),
            issue('mnemo-desktop', 209, 'Jump palette: show the branch under each worktree', ['ui', 'redesign']),
            issue('mnemo-desktop', 205, 'Onboarding asks for gh before git is found', ['bug', 'setup']),
            issue('mnemo-desktop', 198, 'Status bar: tokens of the focused pane'),
          ],
          [pr('mnemo-desktop', 193, "chore(vendor): Orca's look, to adapt from in wave B", 'open', 'pass'), pr('mnemo-desktop', 196, 'feat(sidebar): worktree cards', 'draft', 'pending', 'a1b2c3d4')],
        ),
        repo(OTHER, 'mnemo', [issue('mnemo', 88, 'dispatch: --may none still pushes', ['bug']), issue('mnemo', 91, 'Briefing names the wrong base branch')], [pr('mnemo', 90, 'fix(hooks): read both streams before the exit event', 'open', 'fail')]),
      ],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    },
    // #88 is on the branch `mnemo dispatch 88` makes, so a child is already working on it.
    mission_snapshot: {
      repos: [
        {
          root: OTHER,
          name: 'mnemo',
          parents: [],
          missions: [],
          children: [
            {
              id: 'c0ffee00-0000-0000-0000-000000000000',
              session_id: null,
              name: null,
              state: 'working',
              tempo: 'active',
              needs: null,
              detail: '',
              suggested_reply: null,
              cwd: `${OTHER}-wt-88`,
              tokens: 0,
              live: true,
              updated_at: '2026-09-24T11:59:00Z',
              intent: null,
              branch: 'fix/issue-88',
              timeline_len: 0,
            },
          ],
        },
      ],
      errors: [],
      at: '2026-09-24T12:00:00Z',
    },
    // What the sidebar has already seen of each child: nothing, so it reads the child as new.
    mission_looked: {},
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
  }),
})

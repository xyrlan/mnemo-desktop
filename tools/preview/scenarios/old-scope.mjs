// The screens that lived inside the old stylesheet scope (orca-redesign-f · legacy-look) and no
// other scenario shows: the setup pane, a job's log, the command palette, the editor's path
// prompt, mnemo's pulse over a pane with its enforcement toast, and a pane's own message. Each
// restores one worktree whose tab holds the pane in question.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const repo = { root: REPO, name: 'mnemo-desktop', last_at: 1_790_000_000, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }
const tree = { path: REPO, branch: 'main', head: '0a7a6a982878681f399c03bd5c438cba5634d7cd', isMain: true, dispatched: false, dirty: false, setupJob: null }

/** The repo's main checkout, its one tab holding `pane` (a saved pane: `{ view, props, cwd }`). */
const restoring = (pane, extra = {}) =>
  appIpc({
    home_snapshot: { repos: [repo], clone_base: `${HOME}/code`, errors: [], protected: 0 },
    worktree_list: [tree],
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [{ path: REPO, tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }], panes: { 1: pane }, activeTab: 'tab-1' }],
    },
    pty_list: [],
    memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
    ...extra,
  })

/** A terminal pane printing a shell's output; the home directory "Open file…" starts from. */
const terminal = {
  'plugin:path|resolve_directory': HOME,
  pty_spawn: ({ onOutput }) => {
    setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
    return 1
  },
  pty_write: null,
  pty_resize: null,
  pty_kill: null,
  pty_pid: 4242,
}

const tool = (name, path, version, managed = false) => ({ name, path, version, managed })

// Setup with git and gh missing (claude and mnemo found, so onboarding does not open over it).
scenario('setup-pane', {
  ipc: restoring(
    { view: 'setup', props: {}, cwd: REPO },
    {
      tools_status: [
        tool('git', null, null),
        tool('claude', '/opt/homebrew/bin/claude', '2.4.0 (Claude Code)'),
        tool('mnemo', `${HOME}/.mnemo-desktop/bin/mnemo`, 'mnemo 0.9.0', true),
        tool('gh', null, null),
      ],
    },
  ),
})

// A job's log pane restored after a restart: the log itself did not survive it.
scenario('job-log', { ipc: restoring({ view: 'job-log', props: { job: 'merge:42' }, cwd: REPO }) })

// ⌘K over a terminal.
scenario('command-palette', {
  ipc: restoring({ view: 'terminal', cwd: REPO }, terminal),
  events: [{ event: 'app://action', payload: { id: 'palette.open' }, afterMs: 900 }],
})

// "Open file…": the editor's one-field prompt, over a terminal.
scenario('path-prompt', {
  ipc: restoring({ view: 'terminal', cwd: REPO }, terminal),
  events: [{ event: 'app://action', payload: { id: 'editor.open' }, afterMs: 900 }],
})

const pulse = (kind, at, extra = {}) => ({ at, kind, project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: ['never-force-push'], ...extra })

// mnemo blocks a command in this pane's repo, then enriches a prompt: the enforcement toast
// stays in the corner, the octopus plays the enrichment over the pane.
scenario('pulse', {
  ipc: restoring({ view: 'terminal', cwd: REPO }, terminal),
  events: [
    { event: 'mnemo://pulse', payload: pulse('enforce', 1_790_000_000_000, { tool: 'git push --force' }), afterMs: 1200 },
    { event: 'mnemo://pulse', payload: pulse('enrich', 1_790_000_000_500, { slugs: ['conventional-commits'], tool: 'UserPromptSubmit' }), afterMs: 1500 },
  ],
})

// A pane whose view no piece registers (a workspace saved by a newer build): its message.
scenario('pane-message', { ipc: restoring({ view: 'no-such-view', props: {}, cwd: REPO }) })

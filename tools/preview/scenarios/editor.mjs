// The editor pane in the new look: just the path above the buffer, no file tree of its own. Monaco keeps its own theme.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const at = Date.parse('2026-09-24T12:00:00Z')
const OPEN = `${REPO}/src/editor/view.tsx`
const d = (name) => ({ name, is_dir: true })
const f = (name) => ({ name, is_dir: false })

const DISK = {
  [REPO]: [d('docs'), d('src'), d('tools'), f('CLAUDE.md'), f('package.json'), f('README.md')],
  [`${REPO}/src`]: [d('browser'), d('editor'), f('App.tsx'), f('main.tsx'), f('theme.css')],
  [`${REPO}/src/editor`]: [f('Prompt.tsx'), f('actions.ts'), f('editor.css'), f('view.tsx')],
}

const SOURCE = `import { useEffect, useRef, useState } from 'react'

function EditorPane({ id, props }) {
  const [loading, setLoading] = useState(false)
  return <div className="editor-pane" />
}
`

scenario('editor', {
  ipc: appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: at, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    mission_looked: {},
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [
        {
          path: REPO,
          tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
          panes: { 1: { view: 'editor', props: { path: OPEN, root: REPO }, title: 'view.tsx' } },
          activeTab: 'tab-1',
        },
      ],
    },
    memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'feat/orca-redesign-e/editor-restyle',
    fs_list: ({ dir }) => DISK[dir] ?? [],
    fs_read: ({ path }) => (path === OPEN ? SOURCE : ''),
  }),
})

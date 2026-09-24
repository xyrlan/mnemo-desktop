// The right sidebar's Explorer tab on a worktree: its files as a tree, the folders above the
// file the editor pane shows opened and that file selected, git's colours on what changed,
// dotfiles shown and what .gitignore names in italics. Memory is the sidebar's first tab: click
// Explorer (the shot waits for it, see `events`).
//
// Git's ignored list and the name filter's file list come from `job_run`, as `job-line` events
// under a fixed id, so they are emitted here every half second for a while: whichever read the
// explorer has started when one lands takes it.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const at = Date.parse('2026-09-24T12:00:00Z')
const OPEN = `${REPO}/src/explorer/FileExplorer.tsx`

const d = (name) => ({ name, is_dir: true })
const f = (name) => ({ name, is_dir: false })

const DISK = {
  [REPO]: [
    d('.claude'),
    d('.git'),
    d('.github'),
    d('dist'),
    d('docs'),
    d('node_modules'),
    d('src'),
    d('src-tauri'),
    d('tools'),
    f('.env'),
    f('.gitignore'),
    f('CLAUDE.md'),
    f('package.json'),
    f('pnpm-lock.yaml'),
    f('README.md'),
    f('tsconfig.json'),
    f('vite.config.ts'),
  ],
  [`${REPO}/src`]: [d('editor'), d('explorer'), d('rightbar'), d('shell'), d('ui'), f('App.tsx'), f('main.tsx'), f('theme.css')],
  [`${REPO}/src/explorer`]: [
    f('client.ts'),
    f('explorer.css'),
    f('FileExplorer.test.tsx'),
    f('FileExplorer.tsx'),
    f('FileExplorerRow.tsx'),
    f('FileExplorerToolbar.tsx'),
    f('rows.ts'),
    f('store.ts'),
    f('view.tsx'),
  ],
}

const CHANGES = [
  { path: 'src/explorer/FileExplorer.tsx', origPath: null, index: '.', worktree: 'M', conflicted: false },
  { path: 'src/explorer/rows.ts', origPath: null, index: '?', worktree: '?', conflicted: false },
  { path: 'src/explorer/store.ts', origPath: null, index: 'A', worktree: '.', conflicted: false },
  { path: 'src/rightbar/view.tsx', origPath: null, index: 'M', worktree: '.', conflicted: false },
  { path: 'README.md', origPath: null, index: '.', worktree: 'M', conflicted: false },
]

const IGNORED = ['.env', 'dist/', 'node_modules/']
const FILES = [
  ...Object.entries(DISK).flatMap(([dir, entries]) =>
    entries.filter((e) => !e.is_dir && !IGNORED.includes(e.name)).map((e) => `${dir}/${e.name}`.slice(REPO.length + 1)),
  ),
  'docs/superpowers/contracts/2026-09-24-orca-redesign-d.md',
  'src/rightbar/RightSidebar.tsx',
  'src/rightbar/view.tsx',
]

const SOURCE = `// adapted from stablyai/orca components/right-sidebar/FileExplorer.tsx
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useVirtualizer } from '@tanstack/react-virtual'

/** How often the tree, while drawn, reads the disk and git again. */
export const REFRESH_MS = 10_000
export const ROW_HEIGHT = 24
`

/** One answer to a \`job_run\` read: its lines, then its exit. */
const read = (id, lines, afterMs) => [
  ...lines.map((line) => ({ event: 'job-line', payload: { id, stream: 'out', line }, afterMs })),
  { event: 'job-exit', payload: { id, code: 0 }, afterMs },
]

const answers = []
for (let ms = 1000; ms <= 8000; ms += 500) {
  answers.push(...read(`explorer-ignored:${REPO}`, IGNORED, ms), ...read(`explorer-files:${REPO}`, FILES, ms))
}

scenario('explorer', {
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
          panes: { 1: { view: 'editor', props: { path: OPEN, root: REPO }, title: 'FileExplorer.tsx' } },
          activeTab: 'tab-1',
        },
      ],
    },
    memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'feat/orca-redesign-d/explorer',
    fs_list: ({ dir }) => DISK[dir] ?? [],
    fs_read: ({ path }) => (path === OPEN ? SOURCE : ''),
    commit_status: ({ worktree }) => ({
      root: worktree,
      branch: 'feat/orca-redesign-d/explorer',
      remote: 'origin',
      published: false,
      ahead: 0,
      behind: 0,
      base: 'main',
      unborn: false,
      changes: CHANGES,
    }),
    job_run: null,
  }),
  events: answers,
})

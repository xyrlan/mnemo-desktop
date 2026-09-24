// The right sidebar's Search panel over a worktree on screen. `search_worktree` searches a few
// files held here the way the Rust side does (case, whole word, regex, `*.ext` include and
// exclude), so the panel can be driven: pick the Search tab, type, open a match in the editor.
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const FILES = {
  'src/rightbar/view.tsx': [
    "import React from 'react'",
    "import { useShallow } from 'zustand/react/shallow'",
    "import { useApp } from '../layout/app-store'",
    '',
    'function LiveMemoryPanel(): React.JSX.Element {',
    '  const layout = useApp(',
    '    useShallow((s): LayoutView => ({ activeWorktree: s.activeWorktree, tabs: s.tabs, activeTab: s.activeTab, panes: s.panes })),',
    '  )',
    '  return <MemoryPanel store={memory} target={targetOf(layout, repos)} />',
    '}',
  ],
  'src/sidebar/WorktreeCard.tsx': [
    "import { useShallow } from 'zustand/react/shallow'",
    '',
    'export function WorktreeCard({ path }: { path: string }) {',
    '  const agents = useFleet(useShallow((f) => agentsOf(f, path)))',
    '  return <CardSurface agents={agents} />',
    '}',
  ],
  'src/tabs/TabStrip.tsx': [
    "import { useShallow } from 'zustand/react/shallow'",
    '// Store selectors return stored values or use useShallow (#212): a fresh array each render',
    '// loops React forever.',
    'const tabs = useApp(useShallow((s) => s.tabs.map((t) => t.id)))',
  ],
  'docs/superpowers/contracts/2026-09-24-orca-redesign-d.md': [
    '`useShallow` (#212). Popper content is not opened in jsdom tests.',
  ],
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const globRe = (list) =>
  list
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => new RegExp(`(^|/)${escape(g).replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*')}($|/)`))

function search({ root, query, opts }) {
  if (root !== REPO) throw new Error(`search_worktree asked for ${root}`)
  const source = opts.useRegex ? query : escape(query)
  let re
  try {
    re = new RegExp(opts.wholeWord ? `\\b(?:${source})\\b` : source, opts.caseSensitive ? 'g' : 'gi')
  } catch (e) {
    throw new Error(e.message.replace(/^Invalid regular expression: /, ''))
  }
  const include = globRe(opts.include)
  const exclude = globRe(opts.exclude)
  const files = []
  for (const [rel, lines] of Object.entries(FILES)) {
    if (include.length && !include.some((g) => g.test(rel))) continue
    if (exclude.some((g) => g.test(rel))) continue
    const matches = []
    lines.forEach((text, i) => {
      for (const m of text.matchAll(re)) if (m[0]) matches.push({ line: i + 1, column: m.index + 1, matchLength: m[0].length, lineContent: text })
    })
    if (matches.length) files.push({ filePath: `${REPO}/${rel}`, relativePath: rel, matches })
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { files, totalMatches: files.reduce((n, f) => n + f.matches.length, 0), truncated: false, timedOut: false }
}

scenario('search', {
  ipc: appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: Date.now() - 3_600_000, pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [{ path: REPO, tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }], panes: { 1: { view: 'terminal', cwd: REPO } }, activeTab: 'tab-1' }],
    },
    workspace_live_sessions: [],
    pty_spawn: 1,
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
    search_worktree: search,
    fs_read: ({ path }) => {
      const lines = FILES[path.slice(REPO.length + 1)]
      if (!lines) throw new Error(`${path}: No such file or directory`)
      return lines.join('\n') + '\n'
    },
    fs_list: [],
  }),
})

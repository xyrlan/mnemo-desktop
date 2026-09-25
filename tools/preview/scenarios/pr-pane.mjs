// The PR view Tasks opens (`src/home/pr-pane.tsx`), over the Tasks pane: a draft PR a dispatch
// child opened and is still working on, its checks failing, three files changed — one a lock
// file that starts folded. A scenario cannot click, so its own shot is the Tasks pane with the
// PR's row; the view is one click away on `[data-pr="241"] button[title="open the PR view"]`
// (a throwaway Playwright script on `preparePage`, as the preview README's tests do).
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'

const CHILD = 'c0ffee00-1111-4aaa-8bbb-000000000241'
const NOW = Date.parse('2026-09-24T12:00:00Z')

const add = (from, texts) => texts.map((text, i) => ({ kind: 'add', old: null, new: from + i, text }))
const ctx = (old, neu, texts) => texts.map((text, i) => ({ kind: 'ctx', old: old + i, new: neu + i, text }))

const review = {
  head: 'feat/orca-redesign-e/pr-pane-restyle',
  base: 'main',
  state: 'OPEN',
  draft: true,
  diff_error: null,
  truncated: false,
  files: [
    {
      path: 'src/home/pr-pane.tsx',
      old_path: null,
      status: 'modified',
      additions: 4,
      deletions: 2,
      binary: false,
      lines: 10,
      hunks: [
        {
          header: '@@ -171,8 +171,10 @@ export default function PrPane({ opened }: { opened: OpenedPr }) {',
          lines: [
            ...ctx(171, 171, ['  const check = CHECK[pr.checks]', '  const files = state.status === \'ready\' ? state.review.files : []']),
            { kind: 'del', old: 173, new: null, text: '  return (' },
            { kind: 'del', old: 174, new: null, text: '    <div className="hm-pr-view" style={{ \'--repo\': repoAccent(opened.repo) } as CSSProperties}>' },
            ...add(173, [
              '  const review = state.status === \'ready\' ? state.review : null',
              '  return (',
              '    // `data-ui`: new UI inside the old views\' root (`src/theme.css`), beside Tasks\' own.',
              '    <div data-ui className="hm-pr-view absolute inset-0 z-[2] flex flex-col">',
            ]),
            ...ctx(175, 177, ['      {/* Row 1: the breadcrumb strip. */}', '      <header className="hm-pr-crumbs">']),
          ],
        },
      ],
    },
    {
      path: 'src/home/home.css',
      old_path: null,
      status: 'modified',
      additions: 2,
      deletions: 1,
      binary: false,
      lines: 5,
      hunks: [
        {
          header: '@@ -1,3 +1,4 @@',
          lines: [
            { kind: 'del', old: 1, new: null, text: '/* The PR view (pr-pane.tsx, review/) and the diff look the conversation\'s cards share. */' },
            ...add(1, ['/* The diff look the PR view (review/DiffView.tsx) and the conversation\'s cards share: line', '   numbers, signs and colours. The rest of the PR view is Tailwind. */']),
            ...ctx(2, 3, ['.rv-counts { font-size: 11px; white-space: nowrap; }', '.rv-plus { color: var(--status-success); }']),
          ],
        },
      ],
    },
    {
      path: 'tools/preview/scenarios/pr-pane.mjs',
      old_path: null,
      status: 'added',
      additions: 3,
      deletions: 0,
      binary: false,
      lines: 3,
      hunks: [{ header: '@@ -0,0 +1,3 @@', lines: add(1, ["// The PR view Tasks opens (`src/home/pr-pane.tsx`), over the Tasks pane.", "import { scenario } from '../scenario.mjs'", "import { appIpc, REPO } from '../fixtures/app.mjs'"]) }],
    },
    {
      path: 'pnpm-lock.yaml',
      old_path: null,
      status: 'modified',
      additions: 12,
      deletions: 4,
      binary: false,
      lines: 16,
      hunks: [{ header: '@@ -1,4 +1,12 @@', lines: add(1, Array.from({ length: 12 }, (_, i) => `  line ${i + 1}`)) }],
    },
  ],
}

scenario('pr-pane', {
  ipc: appIpc({
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'tasks', cwd: REPO } },
      activeTab: 'tab-1',
    },
    home_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          last_at: NOW,
          pinned: false,
          hidden: false,
          unresolved: false,
          sessions: [],
          children: [{ id: CHILD, title: 'orca-redesign-e: pr-pane-restyle', cwd: `${REPO}-wt-c-pr-pane-restyle`, last_at: NOW - 4 * 60_000, transcript: true, live: 'bg', kind: 'background', agent: null }],
          issues: [],
          prs: [
            { number: 241, title: "feat(home): the PR pane in Orca's look (orca-redesign-e)", state: 'draft', checks: 'fail', child: CHILD.slice(0, 8), url: 'https://github.com/me/mnemo-desktop/pull/241' },
            { number: 238, title: 'fix(tasks): a closed issue leaves the list', state: 'open', checks: 'pass', child: null, url: 'https://github.com/me/mnemo-desktop/pull/238' },
          ],
        },
      ],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    mission_looked: {},
    review_pr: () => review,
    browser_create: null,
    browser_set_bounds: null,
    browser_navigate: null,
    browser_destroy: null,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
  }),
})

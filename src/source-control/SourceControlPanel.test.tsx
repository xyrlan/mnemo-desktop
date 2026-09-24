import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TooltipProvider } from '@/ui'
import type { ScmClient, ScmEntry, ScmStatus } from './client'
import { createScmStore } from './store'
import { SourceControlPanel } from './SourceControlPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const WT = '/code/app-wt-feat'
const e = (path: string, area: ScmEntry['area'], status: ScmEntry['status'] = 'modified', more: Partial<ScmEntry> = {}): ScmEntry => ({
  path,
  oldPath: null,
  area,
  status,
  added: null,
  removed: null,
  ...more,
})

const ENTRIES: ScmEntry[] = [
  e('src/new.ts', 'staged', 'renamed', { oldPath: 'src/old.ts', added: 2, removed: 1 }),
  e('src/a.ts', 'unstaged', 'modified', { added: 5, removed: 2 }),
  e('docs/gone.md', 'unstaged', 'deleted', { removed: 12 }),
  e('notes.md', 'untracked', 'untracked', { added: 3, removed: 0 }),
  e('scratch.txt', 'untracked', 'untracked'),
]

let current: ScmStatus
let calls: [string, unknown[]][]
let refuse: string | null
const client: ScmClient = {
  status: async (...a) => {
    calls.push(['status', a])
    return current
  },
  stage: async (...a) => void calls.push(['stage', a]),
  unstage: async (...a) => void calls.push(['unstage', a]),
  discard: async (...a) => {
    calls.push(['discard', a])
    if (refuse) throw refuse
  },
  watch: async () => {},
  onChanged: async () => () => {},
}

let root: Root
let host: HTMLElement
let opened: [string, string][]
let committed: string[]

async function show(entries: ScmEntry[] | null, worktree: string | null = WT, error?: string) {
  const store = createScmStore(client)
  if (entries) {
    current = { root: WT, branch: 'feat/source-control', entries, truncated: false }
    await store.getState().load(WT)
  } else if (error) store.setState({ trees: { [WT]: { status: null, loading: false, error } } })
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SourceControlPanel worktree={worktree} store={store} onOpen={(w, x) => void opened.push([w, x.path])} onCommit={(w) => void committed.push(w)} />
      </TooltipProvider>,
    ),
  )
  calls = []
  return store
}

beforeEach(() => {
  calls = []
  refuse = null
  opened = []
  committed = []
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const panel = () => host.querySelector<HTMLElement>('[data-source-control]')!
const section = (area: string) => host.querySelector<HTMLElement>(`[data-scm-section="${area}"]`)!
const row = (area: string, path: string) => host.querySelector<HTMLElement>(`[data-scm-area="${area}"][data-scm-path="${path}"]`)!
const within = (el: ParentNode, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const click = (el: HTMLElement) => act(async () => el.click())
const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

it('lists the changes by section, each with its count, files with their folder and line counts', async () => {
  await show(ENTRIES)
  const heads = [...host.querySelectorAll('[data-scm-section] [aria-expanded]')].map((b) => b.textContent)
  expect(heads).toEqual(['Staged Changes1', 'Changes2', 'Untracked Files2'])
  expect(panel().textContent).toContain('feat/source-control')
  const a = row('unstaged', 'src/a.ts')
  expect(a.textContent).toContain('a.ts')
  expect(a.textContent).toContain('src')
  expect(a.textContent).toContain('+5 -2')
  expect(row('staged', 'src/new.ts').title).toBe('src/old.ts → src/new.ts')
  expect(row('untracked', 'scratch.txt').textContent).not.toMatch(/[+-]\d/)
})

it('a section folds away under its header', async () => {
  await show(ENTRIES)
  await click(section('unstaged').querySelector<HTMLElement>('[aria-expanded]')!)
  expect(row('unstaged', 'src/a.ts')).toBeNull()
  expect(section('unstaged').querySelector('[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
  await click(section('unstaged').querySelector<HTMLElement>('[aria-expanded]')!)
  expect(row('unstaged', 'src/a.ts')).not.toBeNull()
})

it('a click on a file opens its diff, and marks the row', async () => {
  await show(ENTRIES)
  await click(row('unstaged', 'src/a.ts'))
  expect(opened).toEqual([[WT, 'src/a.ts']])
  expect(row('unstaged', 'src/a.ts').dataset.current).toBe('true')
  await act(async () => row('untracked', 'notes.md').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(opened.at(-1)).toEqual([WT, 'notes.md'])
  expect(row('unstaged', 'src/a.ts').dataset.current).toBeUndefined()
})

it('stages and unstages one file from its row, a rename by both its paths', async () => {
  await show(ENTRIES)
  expect(within(row('staged', 'src/new.ts'), 'Stage')).toBeNull()
  expect(within(row('unstaged', 'src/a.ts'), 'Unstage')).toBeNull()
  await click(within(row('unstaged', 'src/a.ts'), 'Stage'))
  await settle()
  await click(within(row('staged', 'src/new.ts'), 'Unstage'))
  await settle()
  expect(calls.filter(([c]) => c !== 'status')).toEqual([
    ['stage', [WT, ['src/a.ts']]],
    ['unstage', [WT, ['src/new.ts', 'src/old.ts']]],
  ])
  expect(opened).toEqual([])
})

it('stages and unstages a whole section from its header', async () => {
  await show(ENTRIES)
  await click(within(section('unstaged'), 'Stage all'))
  await settle()
  await click(within(section('untracked'), 'Stage all'))
  await settle()
  await click(within(section('staged'), 'Unstage all'))
  await settle()
  expect(calls.filter(([c]) => c !== 'status')).toEqual([
    ['stage', [WT, ['src/a.ts', 'docs/gone.md']]],
    ['stage', [WT, ['notes.md', 'scratch.txt']]],
    ['unstage', [WT, ['src/new.ts', 'src/old.ts']]],
  ])
  expect(within(section('staged'), 'Discard all')).toBeNull()
})

it('discards nothing until the dialog is confirmed', async () => {
  await show(ENTRIES)
  expect(within(row('staged', 'src/new.ts'), 'Discard changes')).toBeNull()
  await click(within(row('unstaged', 'src/a.ts'), 'Discard changes'))
  expect(dialog()!.textContent).toContain('Discard changes to "a.ts"?')
  expect(dialog()!.textContent).toContain('cannot be undone')
  expect(document.activeElement?.getAttribute('data-action')).toBe('confirm-discard')
  await click([...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!)
  expect(dialog()).toBeNull()
  expect(calls).toEqual([])

  await click(within(row('unstaged', 'docs/gone.md'), 'Restore file'))
  expect(dialog()!.textContent).toContain('Restore "gone.md"?')
  await click(dialog()!.querySelector<HTMLElement>('[data-action="confirm-discard"]')!)
  await settle()
  expect(dialog()).toBeNull()
  expect(calls.filter(([c]) => c !== 'status')).toEqual([['discard', [WT, ['docs/gone.md'], []]]])
})

it('deletes every untracked file at once, after saying how many', async () => {
  await show(ENTRIES)
  await click(within(section('untracked'), 'Delete all untracked'))
  expect(dialog()!.textContent).toContain('Delete 2 untracked files?')
  await click(dialog()!.querySelector<HTMLElement>('[data-action="confirm-discard"]')!)
  await settle()
  expect(calls.filter(([c]) => c !== 'status')).toEqual([['discard', [WT, [], ['notes.md', 'scratch.txt']]]])
})

it('shows what a failed step said until it is dismissed', async () => {
  const store = await show(ENTRIES)
  refuse = 'scratch.txt: a folder, not deleted'
  await click(within(row('untracked', 'scratch.txt'), 'Delete untracked file'))
  expect(dialog()!.textContent).toContain('Delete "scratch.txt"?')
  await click(dialog()!.querySelector<HTMLElement>('[data-action="confirm-discard"]')!)
  await settle()
  expect(host.querySelector('[role="status"]')!.textContent).toContain('scratch.txt: a folder, not deleted')
  await click(within(host.querySelector('[role="status"]')!, 'Dismiss'))
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(store.getState().failed[WT]).toBeNull()
})

it('the foot opens the commit composer, and says what a commit would find', async () => {
  await show(ENTRIES)
  const commit = host.querySelector<HTMLButtonElement>('[data-action="commit"]')!
  expect(commit.disabled).toBe(false)
  expect(commit.parentElement!.textContent).toContain('1 staged · 4 not staged')
  await click(commit)
  expect(committed).toEqual([WT])
})

it('a conflict comes first, can be marked resolved, and never discarded', async () => {
  await show([e('both.ts', 'conflicted', 'conflicted'), e('a.ts', 'unstaged')])
  expect([...host.querySelectorAll('[data-scm-section]')].map((s) => s.getAttribute('data-scm-section'))).toEqual(['conflicted', 'unstaged'])
  expect(within(row('conflicted', 'both.ts'), 'Discard changes')).toBeNull()
  expect(within(section('conflicted'), 'Stage all')).toBeNull()
  await click(within(row('conflicted', 'both.ts'), 'Mark resolved (stage)'))
  await settle()
  expect(calls.filter(([c]) => c !== 'status')).toEqual([['stage', [WT, ['both.ts']]]])
  expect(host.querySelector('[data-action="commit"]')!.parentElement!.textContent).toContain('1 conflict to resolve first')
})

it('a clean tree says so, with Commit off', async () => {
  await show([])
  expect(panel().textContent).toContain('No changes')
  expect(host.querySelector<HTMLButtonElement>('[data-action="commit"]')!.disabled).toBe(true)
})

it('says what is missing: a worktree, a read, a repository', async () => {
  await show(null, null)
  expect(host.textContent).toBe('Select a workspace to view changes')
  await show(null)
  expect(host.textContent).toBe('Reading the changes…')
  await show(null, WT, 'git rev-parse: fatal: not a git repository (or any of the parent directories): .git')
  expect(host.textContent).toBe('Source Control is only available for Git repositories')
  await show(null, WT, 'git status: something else')
  expect(host.textContent).toBe('Could not read the changes: git status: something else')
})

it('refresh reads the tree again', async () => {
  await show(ENTRIES)
  await click(within(panel(), 'Refresh'))
  expect(calls).toEqual([['status', [WT]]])
})

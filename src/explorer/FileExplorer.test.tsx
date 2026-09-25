import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Change } from '../commit/client'
import type { ExplorerClient } from './client'
import { FileExplorer, REFRESH_MS, type FileExplorerProps } from './FileExplorer'
import { createExplorerStore } from './store'
import { repoNameOf, rootOf } from './target'
import type { DirEntry } from './types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Popper content (the row's context menu, the toolbar's dropdown) is never opened here.

// The virtualizer sizes its window from the scroll viewport, which jsdom lays out at 0×0.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 300 })
})

const R = '/code/app'
const d = (name: string): DirEntry => ({ name, isDirectory: true })
const f = (name: string): DirEntry => ({ name, isDirectory: false })

const DISK: Record<string, DirEntry[]> = {
  [R]: [d('.github'), d('dist'), d('src'), f('.env'), f('README.md')],
  [`${R}/src`]: [d('ui'), f('main.ts')],
  [`${R}/src/ui`]: [f('button.tsx')],
  [`${R}/dist`]: [f('app.js')],
  '/code/other': [f('other.txt')],
}

function fakeClient(): ExplorerClient & { lists: string[] } {
  const lists: string[] = []
  return {
    lists,
    list: async (dir) => {
      lists.push(dir)
      const got = DISK[dir]
      if (!got) throw new Error(`${dir}: No such file or directory`)
      return got
    },
    changes: async () => [{ path: 'src/main.ts', origPath: null, index: '.', worktree: 'M', conflicted: false } satisfies Change],
    ignored: async () => ['dist/'],
    files: async () => ['src/main.ts', 'src/ui/button.tsx', 'README.md', '.github/ci.yml'],
  }
}

type Mounted = { host: HTMLElement; props: FileExplorerProps; render: (over: Partial<FileExplorerProps>) => Promise<void> }

async function mount(over: Partial<FileExplorerProps> = {}): Promise<Mounted> {
  const client = over.store ? null : fakeClient()
  const props: FileExplorerProps = {
    store: createExplorerStore(client!),
    root: R,
    repoName: 'app',
    activeFile: null,
    onOpenFile: vi.fn(),
    onOpenInTerminal: vi.fn(),
    onCopy: vi.fn(),
    ...over,
  }
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  await act(async () => root.render(<FileExplorer {...props} />))
  await flush()
  const m: Mounted = {
    host,
    props,
    render: async (next) => {
      Object.assign(m.props, next)
      await act(async () => root.render(<FileExplorer {...m.props} />))
      await flush()
    },
  }
  return m
}

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-file-explorer-row]')]
const labels = (host: HTMLElement) => rows(host).map((r) => `${'  '.repeat(Number(r.getAttribute('aria-level')) - 1)}${r.textContent}`)
const row = (host: HTMLElement, path: string) => host.querySelector<HTMLElement>(`[data-path="${path}"]`)!
const click = (el: HTMLElement) => act(async () => el.click())
async function key(el: HTMLElement, k: string, init: KeyboardEventInit = {}) {
  await act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
  // Focus moves on the next frame.
  await act(async () => void (await new Promise((r) => requestAnimationFrame(() => r(null)))))
}
async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('the explorer', () => {
  it('asks for a workspace when none is on screen', async () => {
    const { host } = await mount({ root: null })
    expect(host.textContent).toContain('Select a workspace to browse files')
  })

  it("draws the worktree's top level with git's colours, dotfiles and ignored files as Orca does", async () => {
    const { host } = await mount()
    expect(host.querySelector('[data-file-explorer]')?.hasAttribute('data-ui')).toBe(true)
    expect(host.textContent).toContain('app')
    expect(labels(host)).toEqual(['.github', 'dist', 'src•', '.env', 'README.md'])
    const src = row(host, `${R}/src`)
    expect(src.querySelector('span[style]')?.getAttribute('style')).toContain('--git-decoration-modified')
    const dist = row(host, `${R}/dist`)
    expect(dist.querySelector('.italic')).not.toBeNull()
    expect(dist.querySelector('[aria-label="Ignored by .gitignore"]')).not.toBeNull()
  })

  it('reads a folder when it is first opened, and closes it again', async () => {
    const m = await mount()
    const client = m.props.store
    expect(Object.keys(client.getState().dirs)).toEqual([R])
    await click(row(m.host, `${R}/src`))
    await flush()
    expect(labels(m.host)).toEqual(['.github', 'dist', 'src•', '  ui', '  main.tsM', '.env', 'README.md'])
    expect(row(m.host, `${R}/src`).getAttribute('aria-expanded')).toBe('true')
    await click(row(m.host, `${R}/src`))
    expect(labels(m.host)).toEqual(['.github', 'dist', 'src•', '.env', 'README.md'])
  })

  it('opens a clicked file as a preview, a double-clicked one kept, a Shift-clicked one to the side', async () => {
    const m = await mount()
    await click(row(m.host, `${R}/README.md`))
    expect(m.props.onOpenFile).toHaveBeenCalledWith(`${R}/README.md`, 'preview')
    await act(async () => void row(m.host, `${R}/README.md`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(m.props.onOpenFile).toHaveBeenLastCalledWith(`${R}/README.md`, 'keep')
    await act(async () => void row(m.host, `${R}/.env`).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(m.props.onOpenFile).toHaveBeenLastCalledWith(`${R}/.env`, 'side')
    // A double click on a folder only toggles it.
    const calls = (m.props.onOpenFile as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => void row(m.host, `${R}/dist`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect((m.props.onOpenFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls)
    expect(row(m.host, `${R}/.env`).dataset.selected).toBe('true')
  })

  it('moves with the arrow keys, opens folders with Right, and opens a file with Enter', async () => {
    const m = await mount()
    const tree = m.host.querySelector<HTMLElement>('[role="tree"]')!
    expect(row(m.host, `${R}/.github`).tabIndex).toBe(0)
    await key(tree, 'ArrowDown')
    expect(row(m.host, `${R}/.github`).dataset.selected).toBe('true')
    await key(tree, 'ArrowDown')
    await key(tree, 'ArrowDown')
    expect(row(m.host, `${R}/src`).dataset.selected).toBe('true')
    expect(document.activeElement).toBe(row(m.host, `${R}/src`))
    expect(row(m.host, `${R}/src`).tabIndex).toBe(0)
    expect(row(m.host, `${R}/.github`).tabIndex).toBe(-1)
    await key(tree, 'ArrowRight')
    await flush()
    expect(labels(m.host)).toContain('  main.tsM')
    await key(tree, 'ArrowRight')
    await key(tree, 'ArrowDown')
    expect(row(m.host, `${R}/src/main.ts`).dataset.selected).toBe('true')
    await key(tree, 'Enter')
    expect(m.props.onOpenFile).toHaveBeenLastCalledWith(`${R}/src/main.ts`, 'preview')
    await key(tree, 'Enter', { shiftKey: true })
    expect(m.props.onOpenFile).toHaveBeenLastCalledWith(`${R}/src/main.ts`, 'side')
    await key(tree, 'ArrowLeft')
    expect(row(m.host, `${R}/src`).dataset.selected).toBe('true')
    await key(tree, 'ArrowLeft')
    expect(labels(m.host)).not.toContain('  main.tsM')
  })

  it('filters by name across the whole worktree, and clears with Escape', async () => {
    const m = await mount()
    const input = m.host.querySelector<HTMLInputElement>('input[aria-label="Find files"]')!
    await type(input, 'ts')
    expect(labels(m.host)).toEqual(['src•', '  ui', '    button.tsx', '  main.tsM'])
    await click(row(m.host, `${R}/src/ui`))
    expect(labels(m.host)).toEqual(['src•', '  ui', '  main.tsM'])
    await type(input, 'nothing here')
    expect(m.host.textContent).toContain('No files match this filter')
    await key(input, 'Escape')
    expect(input.value).toBe('')
    expect(labels(m.host)).toEqual(['.github', 'dist', 'src•', '.env', 'README.md'])
  })

  it('steps from the filter into the tree with ArrowDown', async () => {
    const m = await mount()
    const input = m.host.querySelector<HTMLInputElement>('input[aria-label="Find files"]')!
    await type(input, 'readme')
    await key(input, 'ArrowDown')
    expect(document.activeElement).toBe(row(m.host, `${R}/README.md`))
  })

  it('hides dotfiles and ignored files when the toggles say so', async () => {
    const m = await mount()
    await act(async () => {
      m.props.store.getState().setShowDotfiles(R, false)
      m.props.store.getState().setShowIgnored(R, false)
    })
    expect(labels(m.host)).toEqual(['src•', 'README.md'])
  })

  it("reveals and selects the focused editor's file", async () => {
    const m = await mount()
    await m.render({ activeFile: `${R}/src/ui/button.tsx` })
    await flush()
    expect(labels(m.host)).toContain('    button.tsx')
    expect(row(m.host, `${R}/src/ui/button.tsx`).dataset.selected).toBe('true')
    // A file outside the worktree changes nothing.
    await m.render({ activeFile: '/elsewhere/x.ts' })
    expect(row(m.host, `${R}/src/ui/button.tsx`).dataset.selected).toBe('true')
  })

  it('follows the worktree on screen, and keeps what was open in each', async () => {
    const m = await mount()
    await click(row(m.host, `${R}/src`))
    await m.render({ root: '/code/other', repoName: 'other' })
    expect(labels(m.host)).toEqual(['other.txt'])
    await m.render({ root: R, repoName: 'app' })
    expect(labels(m.host)).toContain('  main.tsM')
  })

  it('says why a worktree cannot be read', async () => {
    const { host } = await mount({ root: '/code/missing' })
    expect(host.textContent).toContain('Could not load files for this workspace')
    expect(host.textContent).toContain('No such file')
  })

  it('reads the disk again while it is drawn, and on the refresh button', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const client = fakeClient()
    const m = await mount({ store: createExplorerStore(client) })
    const before = client.lists.length
    await act(async () => void vi.advanceTimersByTime(REFRESH_MS))
    await flush()
    expect(client.lists.length).toBeGreaterThan(before)
    const after = client.lists.length
    await click(m.host.querySelector<HTMLElement>('[aria-label="Refresh Explorer"]')!)
    await flush()
    expect(client.lists.length).toBeGreaterThan(after)
  })

  it('collapses every folder from the toolbar', async () => {
    const m = await mount()
    const collapse = m.host.querySelector<HTMLElement>('[aria-label="Collapse All"]')!
    expect(collapse.getAttribute('aria-disabled')).toBe('true')
    await click(row(m.host, `${R}/src`))
    await flush()
    expect(collapse.getAttribute('aria-disabled')).toBe('false')
    await click(collapse)
    expect(labels(m.host)).toEqual(['.github', 'dist', 'src•', '.env', 'README.md'])
  })
})

describe('the worktree it shows', () => {
  const repos = [
    {
      root: '/code/app',
      name: 'app',
      worktrees: [
        { path: '/code/app-wt', name: 'wt', branch: 'x', kind: 'workspace' as const, agents: [], pr: null, unread: false },
        { path: '/code/app', name: 'app', branch: 'main', kind: 'main' as const, agents: [], pr: null, unread: false },
      ],
    },
  ]

  it("is the shell's, else the first repo's main checkout", () => {
    expect(rootOf('/code/app-wt', repos)).toBe('/code/app-wt')
    expect(rootOf(null, repos)).toBe('/code/app')
    expect(rootOf(null, [])).toBeNull()
  })

  it("is named for its repo, else its folder", () => {
    expect(repoNameOf('/code/app-wt', repos)).toBe('app')
    expect(repoNameOf('/code/loose', repos)).toBe('loose')
  })
})

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { SearchFileResult, SearchMatch, SearchOpts, SearchResult } from './client'
import { SearchPanel } from './SearchPanel'
import { createSearchStore } from './store'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom lays nothing out, so the virtualizer would draw no rows: this stand-in draws them all.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize(i: number): number; getItemKey(i: number): string }) => {
    const items = Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: 0, size: estimateSize(index) }))
    items.forEach((it, i) => (it.start = i === 0 ? 0 : items[i - 1].start + items[i - 1].size))
    return { getVirtualItems: () => items, getTotalSize: () => items.reduce((n, it) => n + it.size, 0) }
  },
}))

// Popper-positioned content (tooltips, context menus) is never opened here: see src/ui/primitives.test.tsx.

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'))
  await act(async () => createRoot(host).render(node))
  return host
}
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const byLabel = (el: ParentNode, label: string) => el.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const click = (el: Element | null) => act(async () => void (el as HTMLElement).click())

/** Types into a React-controlled input. */
async function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

const RESULT: SearchResult = {
  files: [
    {
      filePath: '/r/src/main.ts',
      relativePath: 'src/main.ts',
      matches: [
        { line: 1, column: 7, matchLength: 3, lineContent: 'const foo = 1' },
        { line: 9, column: 3, matchLength: 3, lineContent: '  foo()' },
      ],
    },
    { filePath: '/r/README.md', relativePath: 'README.md', matches: [{ line: 2, column: 3, matchLength: 3, lineContent: '# foo' }] },
  ],
  totalMatches: 3,
  truncated: true,
  timedOut: false,
}

function setup(reply: (query: string, opts: SearchOpts) => Promise<SearchResult> = async () => RESULT) {
  const calls: { root: string; query: string; opts: SearchOpts }[] = []
  const store = createSearchStore({
    debounceMs: 0,
    search: (root, query, opts) => {
      calls.push({ root, query, opts })
      return reply(query, opts)
    },
  })
  const opened: [SearchFileResult, SearchMatch][] = []
  return { calls, store, opened, onOpenMatch: (f: SearchFileResult, m: SearchMatch) => void opened.push([f, m]) }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the search panel', () => {
  it('asks for a worktree before there is one', async () => {
    const { store, onOpenMatch } = setup()
    const host = await mount(<SearchPanel store={store} root={null} onOpenMatch={onOpenMatch} />)
    expect(host.textContent).toContain('Open a worktree to search its files.')
    expect(byLabel(host, 'Search files')).toBeNull()
  })

  it('searches as you type and draws the matches grouped by file, the match highlighted', async () => {
    const { store, calls, onOpenMatch } = setup()
    const host = await mount(<SearchPanel store={store} root="/r" onOpenMatch={onOpenMatch} />)
    const input = byLabel(host, 'Search files') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(host.textContent).toContain('Type to search in files')
    await type(input, 'foo')
    await flush()
    await flush()
    expect(calls.map((c) => [c.root, c.query])).toEqual([['/r', 'foo']])
    expect(host.querySelector('[role="status"]')?.textContent).toBe('3 results in 2 files (results truncated)')
    const rows = [...host.querySelectorAll('button')].map((b) => b.textContent)
    expect(rows.filter(Boolean)).toEqual(['main.tssrc2', '1const foo = 1', '9foo()', 'README.md1', '2# foo'])
    expect([...host.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['foo', 'foo', 'foo'])
  })

  it('opens a match; folds a file', async () => {
    const { store, onOpenMatch, opened } = setup()
    const host = await mount(<SearchPanel store={store} root="/r" onOpenMatch={onOpenMatch} />)
    await type(byLabel(host, 'Search files') as HTMLInputElement, 'foo')
    await flush()
    await flush()
    const match = [...host.querySelectorAll('button')].find((b) => b.textContent === '9foo()')!
    await click(match)
    expect(opened.map(([f, m]) => [f.relativePath, m.line])).toEqual([['src/main.ts', 9]])
    const header = [...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('main.ts'))!
    expect(header.getAttribute('aria-expanded')).toBe('true')
    await click(header)
    expect(host.querySelectorAll('mark')).toHaveLength(1)
    expect([...host.querySelectorAll('button')].find((b) => b.textContent?.startsWith('main.ts'))!.getAttribute('aria-expanded')).toBe('false')
  })

  it('runs on Enter, clears on Escape, and passes the switches and globs', async () => {
    const { store, calls, onOpenMatch } = setup()
    const host = await mount(<SearchPanel store={store} root="/r" onOpenMatch={onOpenMatch} />)
    const input = byLabel(host, 'Search files') as HTMLInputElement
    await click(byLabel(host, 'Match Case'))
    await click(byLabel(host, 'Match Whole Word'))
    await click(byLabel(host, 'Use Regular Expression'))
    expect(byLabel(host, 'Match Case')?.getAttribute('aria-pressed')).toBe('true')
    await click(byLabel(host, 'Toggle Search Details'))
    const [inc, exc] = [...host.querySelectorAll<HTMLInputElement>('input[placeholder^="files to"]')]
    await type(inc, '*.ts')
    await type(exc, 'dist')
    await type(input, 'fo+')
    await key(input, 'Enter')
    await flush()
    expect(calls.at(-1)).toEqual({ root: '/r', query: 'fo+', opts: { caseSensitive: true, wholeWord: true, useRegex: true, include: '*.ts', exclude: 'dist' } })
    await key(input, 'Escape')
    expect(input.value).toBe('')
    expect(host.textContent).toContain('Type to search in files')
  })

  it('says why a search failed, and when nothing matched', async () => {
    const { store, onOpenMatch } = setup(async (q) => {
      if (q === '(') throw 'unmatched ( for expression group'
      return { files: [], totalMatches: 0, truncated: false, timedOut: false }
    })
    const host = await mount(<SearchPanel store={store} root="/r" onOpenMatch={onOpenMatch} />)
    const input = byLabel(host, 'Search files') as HTMLInputElement
    await type(input, '(')
    await flush()
    await flush()
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('unmatched ( for expression group')
    await type(input, 'zzz')
    await flush()
    await flush()
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).toContain('No results found')
  })

  it('searches the new worktree when the one on screen changes', async () => {
    const { store, calls, onOpenMatch } = setup()
    const host = await mount(<SearchPanel store={store} root="/a" onOpenMatch={onOpenMatch} />)
    await type(byLabel(host, 'Search files') as HTMLInputElement, 'foo')
    await flush()
    await act(async () => createRoot(host).render(<SearchPanel store={store} root="/b" onOpenMatch={onOpenMatch} />))
    await flush()
    expect(calls.map((c) => c.root)).toEqual(['/a', '/b'])
  })
})

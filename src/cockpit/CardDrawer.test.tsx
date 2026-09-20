import { act } from 'react'
import { createRoot } from 'react-dom/client'
import CardDrawer, { PROMOTE, type CardDrawerProps } from './CardDrawer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TITLE = 'merge · PR #412'

/** The drawer beside a card row, as a consumer will mount it: a sibling of the list, in the
 *  same tree, never on its own root. `row` stands in for the board behind it. */
function board() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const clicks: string[] = []
  const show = async (p: Partial<CardDrawerProps> = {}) => {
    await act(async () =>
      root.render(
        <div className="ck-body">
          <div className="ck-inbox">
            <button id="row" onClick={() => clicks.push('row')}>
              a piece
            </button>
          </div>
          <CardDrawer open={p.open ?? true} onClose={p.onClose ?? (() => {})} title={p.title ?? TITLE} onPromote={p.onPromote}>
            {p.children ?? <p className="cd-line">a line</p>}
          </CardDrawer>
        </div>,
      ),
    )
  }
  const drawer = () => host.querySelector('.ck-drawer')
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)
  const drop = async () => {
    await act(async () => root.unmount())
    host.remove()
  }
  return { host, clicks, show, drawer, button, drop }
}

const escape = async (init: KeyboardEventInit = {}) => {
  await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, ...init })))
}

test('it is a panel in the board, not an overlay over it', async () => {
  const b = board()
  await b.show()
  const el = b.drawer()!
  // Rendered where the consumer put it — no portal, nothing appended to the body. `palette-overlay`
  // (marketplace/UrlPrompt.tsx) does the opposite, and is what this must not become.
  expect(el.parentElement).toBe(b.host.firstElementChild)
  expect([...document.body.children]).toEqual([b.host])
  expect(document.querySelector('.palette-overlay')).toBeNull()
  // No backdrop: nothing between the drawer and the list to swallow a click.
  expect(b.host.querySelectorAll('.ck-body > *').length).toBe(2)
  // Not a modal to a screen reader either.
  expect(el.getAttribute('role')).not.toBe('dialog')
  expect(el.getAttribute('aria-modal')).toBeNull()
  expect(el.getAttribute('aria-label')).toBe(TITLE)
  await b.drop()
})

test('the list beside it keeps its focus and its clicks: no focus trap', async () => {
  const b = board()
  await b.show({ open: false })
  const row = b.host.querySelector<HTMLButtonElement>('#row')!
  row.focus()
  // Opening must not pull the focus out of the list — nothing in here is autofocused, and
  // nothing pulls it back. Swapping the content must not either.
  await b.show()
  expect(document.activeElement).toBe(row)
  await b.show({ title: 'mnemo-desktop/103' })
  expect(document.activeElement).toBe(row)
  await act(async () => row.click())
  expect(b.clicks).toEqual(['row'])
  await b.drop()
})

test('closed, it is not in the tree and escape is not its key', async () => {
  const b = board()
  const onClose = vi.fn()
  await b.show({ open: false, onClose })
  expect(b.drawer()).toBeNull()
  expect(b.host.textContent).not.toContain('a line')
  await escape()
  expect(onClose).not.toHaveBeenCalled()
  await b.drop()
})

test('escape closes it, from wherever the focus is', async () => {
  const b = board()
  const onClose = vi.fn()
  await b.show({ onClose })
  b.host.querySelector<HTMLButtonElement>('#row')!.focus()
  await escape()
  expect(onClose).toHaveBeenCalledTimes(1)
  await b.drop()
})

test('a chord that happens to carry escape is not a close', async () => {
  const b = board()
  const onClose = vi.fn()
  await b.show({ onClose })
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) await escape(mod)
  expect(onClose).not.toHaveBeenCalled()
  await b.drop()
})

test('the header says what the drawer is a window onto, and closes it', async () => {
  const b = board()
  const onClose = vi.fn()
  await b.show({ onClose, title: 'mnemo-desktop/103' })
  expect(b.host.querySelector('.ck-drawer-title')!.textContent).toBe('mnemo-desktop/103')
  await act(async () => b.host.querySelector<HTMLButtonElement>('.ck-drawer .ck-close')!.click())
  expect(onClose).toHaveBeenCalledTimes(1)
  await b.drop()
})

test('"open in pane" appears only with onPromote, and hands over before it closes', async () => {
  const b = board()
  await b.show()
  expect(b.button(PROMOTE)).toBeUndefined()

  const order: string[] = []
  await b.show({ onPromote: () => order.push('promote'), onClose: () => order.push('close') })
  expect(b.button(PROMOTE)).toBeDefined()
  await act(async () => b.button(PROMOTE)!.click())
  // The pane gets the content first; the drawer gets out of the way after.
  expect(order).toEqual(['promote', 'close'])
  await b.drop()
})

test('another row swaps the content, it does not stack a second drawer', async () => {
  const b = board()
  await b.show({ title: 'merge · PR #412', children: <p className="cd-line">the merge log</p> })
  const first = b.drawer()
  await b.show({ title: 'mnemo-desktop/103', children: <p className="cd-line">the conversation</p> })
  expect(b.host.querySelectorAll('.ck-drawer').length).toBe(1)
  expect(b.drawer()).toBe(first)
  expect(b.host.querySelector('.ck-drawer-body')!.textContent).toBe('the conversation')
  expect(b.host.textContent).not.toContain('the merge log')
  await b.drop()
})

test('closing calls onClose and nothing else: a drawer is a window, not a lifetime', async () => {
  const b = board()
  const onClose = vi.fn()
  const onPromote = vi.fn()
  await b.show({ onClose, onPromote })
  await b.show({ open: false, onClose, onPromote })
  // Going away is not an act of its own — no cancel, no promote, no last call on the way out.
  expect(onPromote).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
  expect(b.drawer()).toBeNull()
  await b.drop()
})

/** The stylesheet that ships, read off disk: jsdom lays nothing out, and a `?raw` import of a
 *  `.css` comes back empty under vitest (the CSS plugin stubs it first). Same approach as
 *  `src/vaultlevel/square.test.tsx`; the `fs` types are declared here because the project
 *  carries no `@types/node`. */
type Fs = { readFileSync(path: string, encoding: string): string }
type Url = { fileURLToPath(url: URL): string }
const readCss = async (rel: string): Promise<string> => {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const url = (await import(/* @vite-ignore */ 'node:' + 'url')) as unknown as Url
  // `rel` stays a variable: Vite rewrites `new URL('<literal>', import.meta.url)` into an asset
  // URL, and the path comes back as `http://localhost/...`, which `fileURLToPath` refuses.
  // `fileURLToPath`, never `.pathname`: on Windows the latter yields `/D:/a/...`.
  return fs.readFileSync(url.fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}
const rule = (sheet: string, selector: string): string => {
  const found = sheet.split('\n').find((l) => l.trimStart().startsWith(`${selector} {`))
  if (!found) throw new Error(`${selector} not found`)
  return found
}

test('it slides in from the right of the board and never lies over it', async () => {
  const sheet = await readCss('./cockpit.css')
  const drawer = rule(sheet, '.ck-drawer')
  // Taken out of the flow it would cover the list; in the flow it can only push it.
  expect(drawer).not.toMatch(/position:\s*(fixed|absolute)/)
  expect(drawer).not.toMatch(/(^|[;{\s])inset:/)
  // A flex sibling of `.ck-inbox` inside `.ck-body`, on the right: its own edge is a left border.
  expect(rule(sheet, '.ck-body')).toMatch(/display:\s*flex/)
  expect(drawer).toMatch(/border-left:/)
  expect(drawer).toMatch(/animation:\s*ck-drawer-in/)
  const frames = rule(sheet, '@keyframes ck-drawer-in')
  expect(frames).toMatch(/from\s*\{[^}]*translateX\(100%\)/)
  expect(frames).toMatch(/to\s*\{[^}]*translateX\(0\)/)
  // A slide is motion, and motion is opt-out.
  expect(sheet).toMatch(/prefers-reduced-motion[\s\S]*\.ck-drawer\s*\{\s*animation:\s*none/)
})

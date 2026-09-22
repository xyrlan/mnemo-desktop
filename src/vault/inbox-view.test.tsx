import { act } from 'react'
import { createRoot } from 'react-dom/client'

const calls: [string, Record<string, unknown> | undefined][] = []

const LISTING = `2 staged pages for mnemo-desktop in shared/_inbox/ (median 2d, oldest 5d)

  reference/a  demotion  2d  About a
  reference/b  demotion  5d  About b

nothing was written — this is a listing only.
  \`mnemo inbox --promote KEY\` moves one into shared/<type>/, where recall sees it
  \`mnemo inbox --drop KEY\` archives it and takes it out of the queue
  \`mnemo inbox --show KEY\` prints one page
`

const ALL_LISTING = `2 staged pages across every project in shared/_inbox/ (median 2d, oldest 5d)

  reference/a  demotion  2d  About a
  reference/b  demotion  5d  About b
`

const SHOWN = `---
name: A
description: About a
---

Body of a.
`

const STATS = ['2 staged in shared/_inbox/ (median 2d, oldest 5d)', 'last 7 days: 1 offered at session start, 0 promoted, 1 dropped (1 resolved)', 'median offer → decision: no page has been both offered and decided yet'].join('\n')

const ran = (stdout: string, code: number | null = 0) => ({ stdout, stderr: code === 0 ? '' : stdout, code })

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class {},
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    calls.push([cmd, args])
    if (cmd === 'vault_run' && args?.action === 'inbox') {
      const a = args.args as string[]
      if (a[0] === '--show') return ran(SHOWN)
      if (a[0] === '--promote') return ran('promoted reference/a → shared/reference/a.md')
      if (a[0] === '--drop') return ran('dropped reference/a; archived to shared/_archive/dropped-x/reference/a.md')
      if (a[0] === '--restore') return ran('restored reference/a → shared/_inbox/reference/a.md')
      if (a[0] === '--stats') return ran(STATS)
      if (a[0] === '--all') return ran(ALL_LISTING)
      return ran(LISTING)
    }
    if (cmd === 'vault_tree' || cmd === 'vault_rules') return []
    return undefined
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))))
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())
const byText = (root: HTMLElement, sel: string, text: string) => [...root.querySelectorAll(sel)].find((b) => b.textContent === text)

async function mount() {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await import('./view')
  const { vault } = await import('./app-store')
  vault.setState({
    mode: 'inbox',
    inboxAll: false,
    inboxListing: null,
    inboxSelected: null,
    inboxShowing: false,
    inboxShown: null,
    inboxShownError: null,
    inboxNotice: null,
    inboxStats: null,
    inboxStatsLoading: false,
    inboxBusy: null,
  })
  const { paneView } = await import('../panes/registry')
  const Pane = paneView('vault')!
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(<Pane id={-1} props={{}} />))
  await flush()
  return { host, root }
}

test('lists staged pages with their reason, age and description', async () => {
  const { host, root } = await mount()
  expect([...host.querySelectorAll('.ib-key')].map((e) => e.textContent)).toEqual(['reference/a', 'reference/b'])
  expect(host.querySelector('.ib-row .ib-reason')?.textContent).toBe('demotion')
  expect(host.querySelector('.ib-row .ib-age')?.textContent).toBe('2d')
  expect(host.querySelector('.ib-row .ib-desc')?.textContent).toBe('About a')
  await act(async () => root.unmount())
})

test('Show reads the staged page and renders its body, with frontmatter collapsed', async () => {
  const { host, root } = await mount()
  await click(byText(host, '.ib-acts button', 'Show'))
  await flush()
  expect(host.querySelector('.vt-title')?.textContent).toBe('reference/a')
  expect(host.querySelector('.vt-body')?.textContent).toContain('Body of a.')
  expect(host.querySelector('.vt-frontmatter pre')?.textContent).toContain('name: A')
  await act(async () => root.unmount())
})

test('Promote runs mnemo inbox --promote and shows the CLI message as a notice', async () => {
  const { host, root } = await mount()
  await click(byText(host, '.ib-acts button', 'Promote'))
  await flush()
  expect(calls.some(([c, a]) => c === 'vault_run' && (a?.args as string[])[0] === '--promote' && (a?.args as string[])[1] === 'reference/a')).toBe(true)
  expect(host.querySelector('.ib-notice')?.textContent).toContain('promoted reference/a')
  await act(async () => root.unmount())
})

test('Drop asks twice, then offers Undo, which restores the page', async () => {
  const { host, root } = await mount()
  await click(byText(host, '.ib-acts button', 'Drop'))
  expect(byText(host, '.ib-acts button', 'really drop?')).toBeTruthy()
  await click(byText(host, '.ib-acts button', 'really drop?'))
  await flush()
  expect(calls.some(([c, a]) => c === 'vault_run' && (a?.args as string[])[0] === '--drop')).toBe(true)
  const undo = byText(host, '.ib-notice button', 'Undo')
  expect(undo).toBeTruthy()
  await click(undo)
  await flush()
  expect(calls.some(([c, a]) => c === 'vault_run' && (a?.args as string[])[0] === '--restore' && (a?.args as string[])[1] === 'reference/a')).toBe(true)
  await act(async () => root.unmount())
})

test('the every-project checkbox re-reads with --all', async () => {
  const { host, root } = await mount()
  const checkbox = host.querySelector('.ib-bar input[type="checkbox"]') as HTMLInputElement
  await click(checkbox)
  await flush()
  expect(calls.some(([c, a]) => c === 'vault_run' && a?.action === 'inbox' && (a?.args as string[])[0] === '--all')).toBe(true)
  await act(async () => root.unmount())
})

test('shows mnemo inbox --stats beneath the bar', async () => {
  const { host, root } = await mount()
  expect(host.querySelector('.ib-stats')?.textContent).toContain('2 staged')
  await act(async () => root.unmount())
})

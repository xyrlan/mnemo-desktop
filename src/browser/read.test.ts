import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_TEXT, PAGE_SCRIPT, formatPage, parsePage, readPage, snapshotPage } from './read'

/** Runs the page script against jsdom's document and wraps its value the way WebKit's
 *  evaluateJavaScript callback does (JSON of the returned string). */
function evaluate(html: string, title = 'Test page'): string {
  document.title = title
  document.body.innerHTML = html
  const value = new Function(`return ${PAGE_SCRIPT}`)()
  return JSON.stringify(value)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PAGE_SCRIPT', () => {
  it('reads headings, links, list items and paragraphs as light markdown', () => {
    const p = parsePage(
      evaluate(`
        <h1>Pull request</h1>
        <p>Fixes the   <a href="https://github.com/o/r/issues/4">bug</a> in parsing.</p>
        <ul><li>one</li><li>two</li></ul>
      `),
    )
    expect(p.title).toBe('Test page')
    expect(p.url).toBe(location.href)
    expect(p.truncated).toBe(false)
    expect(p.text).toBe('# Pull request\n\nFixes the [bug](https://github.com/o/r/issues/4) in parsing.\n\n- one\n- two')
  })

  it('skips scripts, styles, hidden elements and password fields', () => {
    const p = parsePage(
      evaluate(`
        <script>var secret = 1</script><style>p{}</style>
        <p hidden>gone</p><div aria-hidden="true">gone too</div>
        <input type="password" value="hunter2"><input placeholder="Search" value="mnemo">
        <p>kept</p>
      `),
    )
    expect(p.text).not.toMatch(/secret|gone|hunter2/)
    expect(p.text).toContain('[Search: mnemo]')
    expect(p.text).toContain('kept')
  })

  it('keeps a list item whose content is a block on one line', () => {
    const p = parsePage(evaluate('<ul><li><div>Actions</div></li></ul>'))
    expect(p.text).toBe('- Actions')
  })

  it('keeps a table row on one line and drops empty list items', () => {
    const p = parsePage(evaluate('<table><tr><td><div>a</div></td><td><div>b</div></td></tr></table><ul><li></li><li>x</li></ul>'))
    expect(p.text).toBe('| a | b\n\n- x')
  })

  it('keeps preformatted whitespace inside a fence', () => {
    const p = parsePage(evaluate('<pre>fn main() {\n    run()\n}</pre>'))
    expect(p.text).toBe('```\nfn main() {\n    run()\n}\n```')
  })

  it('stops at MAX_TEXT and says so', () => {
    const p = parsePage(evaluate(`<p>${'x'.repeat(MAX_TEXT + 500)}</p>`))
    expect(p.text.length).toBeLessThanOrEqual(MAX_TEXT)
    expect(p.text.length).toBeGreaterThan(MAX_TEXT - 5)
    expect(p.truncated).toBe(true)
  })
})

describe('parsePage', () => {
  it('accepts the page JSON quoted once or not at all', () => {
    const page = { url: 'https://a.test/', title: 'A', text: 'hi', truncated: false }
    expect(parsePage(JSON.stringify(JSON.stringify(page)))).toEqual(page)
    expect(parsePage(JSON.stringify(page))).toEqual(page)
  })

  it('turns an empty answer and a caught error into errors', () => {
    expect(() => parsePage('')).toThrow(/did not answer/)
    expect(() => parsePage(JSON.stringify(JSON.stringify({ error: 'boom' })))).toThrow(/boom/)
  })
})

describe('formatPage', () => {
  it('puts title and url first and marks truncation', () => {
    expect(formatPage({ url: 'https://a.test/', title: 'A', text: 'body', truncated: false })).toBe('# A\nhttps://a.test/\n\nbody')
    expect(formatPage({ url: 'u', title: '', text: '', truncated: true })).toBe(
      `# (untitled)\nu\n\n(no text on the page)\n\n[truncated at ${MAX_TEXT} characters]`,
    )
  })
})

describe('bridge calls', () => {
  it('reads through mcp_browser_eval and snapshots through mcp_browser_snapshot', async () => {
    const invoke = vi.fn(async (cmd: string) =>
      cmd === 'mcp_browser_eval'
        ? JSON.stringify(JSON.stringify({ url: 'https://a.test/', title: 'A', text: 'hi', truncated: false }))
        : { mime: 'image/png', data: 'AAAA' },
    ) as never
    expect(await readPage(invoke, -2)).toBe('# A\nhttps://a.test/\n\nhi')
    expect(await snapshotPage(invoke, -2)).toEqual({ mime: 'image/png', data: 'AAAA' })
    expect((invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[0], (c[1] as { id: number }).id])).toEqual([
      ['mcp_browser_eval', -2],
      ['mcp_browser_snapshot', -2],
    ])
  })
})

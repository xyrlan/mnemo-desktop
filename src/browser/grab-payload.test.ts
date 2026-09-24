import { expect, test } from 'vitest'
import { clampGrabPayload, elementLabel, formatGrab, GRAB_BUDGET, parseTake, sanitizeUrl, styleLines } from './grab-payload'
import { payload } from './grab-fixture'

test('what is not a payload is refused', () => {
  expect(clampGrabPayload(null)).toBeNull()
  expect(clampGrabPayload('x')).toBeNull()
  expect(clampGrabPayload({ page: {} })).toBeNull()
  expect(clampGrabPayload({ page: 'x', target: {} })).toBeNull()
})

test("the page's payload is held to the budgets, whatever it claims", () => {
  const p = clampGrabPayload({
    page: { sanitizedUrl: 'https://x.dev/a?token=1#h', viewportWidth: 'wide', devicePixelRatio: NaN },
    target: {
      tagName: 'div',
      htmlSnippet: 'x'.repeat(10_000),
      attributes: { onclick: 'evil()', id: 'a', href: 'https://x.dev/?session_id=9', 'aria-label': 'ok', title: 'my password' },
      cssClasses: 'csrf-token',
      nearbyElements: Array(20).fill('sibling'),
    },
    nearbyText: Array(30).fill('t'),
  })!
  expect(p.page.sanitizedUrl).toBe('https://x.dev/a')
  expect(p.page.viewportWidth).toBe(0)
  expect(p.page.devicePixelRatio).toBe(1)
  expect(p.target.htmlSnippet.length).toBe(GRAB_BUDGET.htmlSnippetMaxLength + ' (truncated)'.length)
  expect(p.target.attributes).toEqual({ id: 'a', href: '[redacted]', 'aria-label': 'ok', title: '[redacted]' })
  expect(p.target.cssClasses).toBe('[redacted]')
  expect(p.target.nearbyElements).toHaveLength(GRAB_BUDGET.nearbyElementsMaxEntries)
  expect(p.nearbyText).toHaveLength(GRAB_BUDGET.nearbyTextMaxEntries)
  expect(p.target.accessibility).toEqual({ role: null, accessibleName: null, ariaLabel: null, ariaLabelledBy: null })
})

test('only web and file URLs survive, without query or fragment', () => {
  expect(sanitizeUrl('javascript:alert(1)')).toBe('')
  expect(sanitizeUrl('about:srcdoc')).toBe('')
  expect(sanitizeUrl('about:blank')).toBe('about:blank')
  expect(sanitizeUrl('file:///a/b.html?x')).toBe('file:///a/b.html')
  expect(sanitizeUrl('not a url')).toBe('')
})

test("the page's answer is read whether WebKit quoted it once more or not", () => {
  const inner = JSON.stringify({ picked: { page: {}, target: { tagName: 'a' } } })
  const once = parseTake(inner)
  const twice = parseTake(JSON.stringify(inner))
  expect(once.kind).toBe('picked')
  expect(twice).toEqual(once)
  expect(parseTake('')).toEqual({ kind: 'unarmed' })
  expect(parseTake('true')).toEqual({ kind: 'unarmed' })
  expect(parseTake('{"armed":true}')).toEqual({ kind: 'waiting' })
  expect(parseTake('{"armed":false}')).toEqual({ kind: 'unarmed' })
  expect(parseTake('{"cancelled":true}')).toEqual({ kind: 'cancelled' })
  expect(parseTake('{"error":"boom"}')).toEqual({ kind: 'error', message: 'boom' })
  expect(parseTake('{"picked":42}').kind).toBe('error')
  expect(parseTake('{').kind).toBe('error')
})

test('defaults say nothing and are left out of the styles', () => {
  expect(styleLines(payload().target.computedStyles)).toEqual(['- display: inline-block', '- color: rgb(0, 0, 0)'])
})

test('the element is named by its accessible name, text, or tag', () => {
  expect(elementLabel(payload())).toBe('button "Save changes"')
  expect(elementLabel(payload({ target: { accessibility: { role: null, accessibleName: null, ariaLabel: null, ariaLabelledBy: null } } }))).toBe('button "Save"')
  expect(elementLabel(payload({ target: { reactComponents: '<Toolbar>' } }))).toBe('<Toolbar> button "Save changes"')
})

test('the write-up leads with the note and carries the element, its CSS, HTML and screenshot', () => {
  const text = formatGrab(payload(), '  Make it blue  ', { path: '/tmp/shot.png' })
  const lines = text.split('\n')
  expect(lines[0]).toBe('## Design feedback: /settings')
  expect(lines[2]).toBe('Make it blue')
  expect(text).toContain('**URL:** http://localhost:3000/settings')
  expect(text).toContain('**Selector:** `button#save`')
  expect(text).toContain('**Bounds:** x=10, y=21, 80x32')
  expect(text).toContain('**Screenshot:** /tmp/shot.png')
  expect(text).toContain('- display: inline-block')
  expect(text).toContain('- Unsaved changes')
  expect(text.endsWith('```html\n<button id="save">Save</button>\n```')).toBe(true)
  expect(formatGrab(payload(), ' ', { error: 'only on macOS' })).toContain('(no note)')
  expect(formatGrab(payload(), '', { error: 'only on macOS' })).toContain('**Screenshot:** none (only on macOS)')
})

test('page HTML cannot close its fence early', () => {
  const text = formatGrab(payload({ target: { htmlSnippet: '<pre>````\n# not a heading</pre>', selector: 'a`b' } }), '', { path: '/x.png' })
  expect(text).toContain('`````html\n<pre>````\n# not a heading</pre>\n`````')
  expect(text).toContain('**Selector:** ``a`b``')
})

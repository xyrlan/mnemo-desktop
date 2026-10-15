import { openTerminalLink } from './links'

function recorder() {
  const opened: string[] = []
  return { opened, open: (url: string) => void opened.push(url) }
}

test('an http(s) link opens, in the system browser', () => {
  const r = recorder()
  expect(openTerminalLink('https://github.com/o/r/pull/4', false, r.open)).toBe(true)
  expect(openTerminalLink('http://localhost:3000', false, r.open)).toBe(true)
  expect(r.opened).toEqual(['https://github.com/o/r/pull/4', 'http://localhost:3000/'])
})

test('non-http schemes and junk are refused', () => {
  const r = recorder()
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ssh://host', 'github.com', ''])
    expect(openTerminalLink(u, false, r.open)).toBe(false)
  expect(r.opened).toEqual([])
})

test('the mouseup that ends a selection does not open the link', () => {
  const r = recorder()
  expect(openTerminalLink('https://github.com/o/r/pull/4', true, r.open)).toBe(false)
  expect(r.opened).toEqual([])
})

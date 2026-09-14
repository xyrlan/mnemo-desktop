import { xtermTheme } from './theme'

test('xterm theme maps CSS variables', () => {
  const vars: Record<string, string> = { '--bg': '#000000', '--fg': '#ffffff', '--ansi-red': '#ff0000' }
  const t = xtermTheme((name) => vars[name] ?? '#123456')
  expect(t.background).toBe('#000000')
  expect(t.foreground).toBe('#ffffff')
  expect(t.red).toBe('#ff0000')
  expect(t.brightWhite).toBe('#123456')
})

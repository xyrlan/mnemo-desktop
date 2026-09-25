import { compile } from 'tailwindcss'
import { xtermTheme } from '../theme'

// jsdom lays nothing out and a `?raw` import of a `.css` comes back empty under vitest, so the
// stylesheet is compiled here the way @tailwindcss/vite does it, off disk. `node:` is spelled
// in two parts so tsc does not look for types the project does not have, and every path is a
// variable because Vite rewrites a literal `new URL('…', import.meta.url)` into an asset URL.
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string
  readdirSync(path: string, opts: { recursive: true }): string[]
  existsSync(path: string): boolean
}
type Path = { resolve(...parts: string[]): string; dirname(p: string): string }
type Url = { fileURLToPath(u: URL): string }

async function node() {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as Fs
  const path = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as Path
  const url = (await import(/* @vite-ignore */ 'node:' + 'url')) as unknown as Url
  return { fs, path, url }
}

async function paths() {
  const { path, url } = await node()
  const up = '..'
  const src = path.resolve(url.fileURLToPath(new URL(up, import.meta.url)))
  return { src, root: path.dirname(src) }
}

/** The CSS Tailwind generates from src/theme.css for these class names. */
async function build(candidates: string[]): Promise<string> {
  const { fs, path } = await node()
  const { src, root } = await paths()
  const file = path.resolve(src, 'theme.css')
  const compiler = await compile(fs.readFileSync(file, 'utf8'), {
    base: src,
    from: file,
    async loadStylesheet(id, base) {
      let target: string
      if (id.startsWith('.')) {
        target = path.resolve(base, id)
      } else {
        // A package's stylesheet: its `style` export, or the subpath named.
        const parts = id.split('/')
        const name = id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
        const sub = id.slice(name.length + 1)
        const dir = path.resolve(root, 'node_modules', name)
        if (sub) {
          target = path.resolve(dir, sub)
        } else {
          const pkg = JSON.parse(fs.readFileSync(path.resolve(dir, 'package.json'), 'utf8'))
          target = path.resolve(dir, pkg.exports?.['.']?.style ?? pkg.style ?? pkg.main)
        }
      }
      return { path: target, base: path.dirname(target), content: fs.readFileSync(target, 'utf8') }
    },
  })
  return compiler.build(candidates)
}

/** The declarations of every rule whose selector is exactly `selector`, joined. */
function rule(css: string, selector: string): string {
  let out = ''
  for (let at = css.indexOf(`${selector} {`); at >= 0; at = css.indexOf(`${selector} {`, at + 1)) {
    const before = css.slice(Math.max(0, at - 2), at)
    if (at > 0 && !/[\n}]\s*$|^\s+$/.test(before)) continue
    const open = css.indexOf('{', at)
    out += css.slice(open + 1, css.indexOf('}', open))
  }
  return out
}

describe('the utilities other pieces are written against', () => {
  const utilities: Array<[string, string]> = [
    ['bg-background', 'background-color: var(--background)'],
    ['text-foreground', 'color: var(--foreground)'],
    ['text-muted-foreground', 'color: var(--muted-foreground)'],
    ['bg-accent', 'background-color: var(--accent)'],
    ['bg-sidebar', 'background-color: var(--sidebar)'],
    ['border-border', 'border-color: var(--border)'],
    ['ring-ring', 'var(--ring)'],
    ['text-state-working', 'color: var(--state-working)'],
    ['text-state-needs-you', 'color: var(--state-needs-you)'],
    ['text-state-done', 'color: var(--state-done)'],
    ['text-state-idle', 'color: var(--state-idle)'],
    ['bg-brand', 'background-color: var(--brand)'],
    ['z-drawer', 'z-index: var(--z-index-drawer)'],
    ['z-popover', 'z-index: var(--z-index-popover)'],
    ['font-mono', 'font-family: var(--font-mono)'],
    ['font-sans', 'font-family: var(--font-sans)'],
    ['rounded-lg', 'border-radius: var(--radius)'],
  ]

  test.each(utilities)('%s is generated', async (cls, decl) => {
    const css = await build([cls])
    expect(rule(css, `.${cls}`)).toContain(decl)
  })

  test('tw-animate-css is in: the enter/exit animations the primitives use exist', async () => {
    const css = await build(['animate-in', 'fade-in-0', 'zoom-in-95'])
    expect(rule(css, '.animate-in')).toContain('animation:')
    expect(css).toContain('.zoom-in-95')
  })

  test('`dark:` follows the `dark` class on <html>', async () => {
    const css = await build(['dark:bg-input/30'])
    expect(css).toContain('.dark\\:bg-input\\/30')
    expect(css).toContain(':is(.dark *)')
  })
})

describe('tokens', () => {
  test('every token a utility names is defined, dark and light', async () => {
    const css = await build([])
    const light = rule(css, ':root')
    const dark = rule(css, '.dark')
    for (const token of ['background', 'foreground', 'muted-foreground', 'sidebar', 'ring', 'state-working', 'state-needs-you', 'state-done', 'state-idle']) {
      expect(light, token).toContain(`--${token}:`)
      expect(dark, token).toContain(`--${token}:`)
    }
  })

  test('the stacking scale puts popovers above drawers and dialogs, tooltips on top', async () => {
    const css = await build([])
    const z = (name: string) => Number(css.match(new RegExp(`--z-index-${name}: (\\d+)`))?.[1])
    expect(z('drawer')).toBeLessThan(z('modal'))
    expect(z('modal')).toBeLessThan(z('popover'))
    expect(z('popover')).toBeLessThan(z('menu'))
    expect(z('menu')).toBeLessThan(z('tooltip'))
    // A pane's own layers (its dividers, the pulse overlay, the drop zone) go up to 6.
    expect(z('drawer')).toBeGreaterThan(6)
  })

  test('JetBrains Mono stays the code font, on <html>, where the terminal reads it', async () => {
    const css = await build([])
    expect(css).toMatch(/:root, :host \{[^}]*--font-mono: 'JetBrains Mono'/)
  })

  test('one accent, today\'s blue in dark', async () => {
    const css = await build([])
    expect(rule(css, '.dark')).toContain('--brand: #7aa2f7')
    expect(css).not.toContain('data-accent')
  })
})

describe('one look: the pre-redesign stylesheet scope is gone', () => {
  test('no scope, no reverts, no legacy tokens', async () => {
    const css = await build([])
    for (const root of ['.app', '.palette-overlay', '.pulse-host', '.voice-host']) {
      expect(css, root).not.toMatch(new RegExp(`\\${root}(?![\\w-])`))
    }
    expect(css).not.toContain('revert-layer')
    for (const token of ['--legacy-accent', '--legacy-border', '--fg-muted', '--bg-elev', '--border-focus']) {
      expect(css, token).not.toContain(`${token}:`)
    }
  })

  test('--accent and --border are Orca’s, light and dark', async () => {
    const css = await build([])
    expect(rule(css, ':root')).toContain('--accent: #f5f5f5')
    expect(rule(css, ':root')).toContain('--border: #e5e5e5')
    expect(rule(css, '.dark')).toContain('--accent: #404040')
    expect(rule(css, '.dark')).toContain('--border: rgb(255 255 255 / 0.07)')
  })

  test('the UI font is sans', async () => {
    const css = await build([])
    expect(css).toMatch(/\bbody \{[^}]*font-family: var\(--font-sans\)/)
  })

  test('the terminal keeps its palette: every colour src/theme.ts hands xterm is defined', async () => {
    const root = rule(await build([]), ':root')
    const read: string[] = []
    xtermTheme((name) => (read.push(name), ''))
    expect(read).toContain('--bg')
    expect(read).toContain('--ansi-bright-white')
    for (const name of read) expect(root, name).toContain(`${name}:`)
  })

  test('every custom property a view reads is defined', async () => {
    const { fs, path } = await node()
    const { src } = await paths()
    const files = fs
      .readdirSync(src, { recursive: true })
      .filter((f) => /\.(css|tsx?)$/.test(f) && !f.startsWith('ui') && !/\.test\.tsx?$/.test(f))
    const used = new Set<string>()
    const defined = new Set<string>()
    for (const f of files) {
      const text = fs.readFileSync(path.resolve(src, f), 'utf8')
      for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1])
      // Read from <html> in script: the terminal's and the editors' fonts and colours.
      for (const m of text.matchAll(/cssVar\(\s*['"](--[\w-]+)/g)) used.add(m[1])
      // Declared in CSS (`--x:`), or set from a component (`'--x':` in a style object, or setProperty).
      for (const m of text.matchAll(/(?:^|[\s{;'"])(--[\w-]+)['"]?\s*:/gm)) defined.add(m[1])
      for (const m of text.matchAll(/setProperty\(\s*['"](--[\w-]+)/g)) defined.add(m[1])
    }
    // Tailwind's own, declared by the build rather than in a source file.
    const css = await build([])
    for (const m of css.matchAll(/(--[\w-]+):/g)) defined.add(m[1])
    const missing = [...used].filter((v) => !defined.has(v))
    expect(missing).toEqual([])
    expect(used.has('--accent') && used.has('--brand') && used.has('--font-mono') && used.has('--font-size')).toBe(true)
  })
})

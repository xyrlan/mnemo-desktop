// Reproduces #393 in headless Chromium: a hidden terminal comes back with its styled glyphs
// garbled after another terminal dropped the WebGL glyph atlas they share.
//
//   node tools/preview/repro/393-atlas.mjs [--fonts <fonts.ts>] [--trigger new-pane|merge] [--out <dir>]
//
// `--trigger merge` drops the new pane and instead has A print glyphs in enough colours to make
// the atlas merge its pages while B is hidden (slow: about a minute).
//
// The page runs the real xterm and WebGL addon from node_modules and the real
// `src/terminal/fonts.ts` (or the one `--fonts` names, e.g. main's from `git show`), and
// opens its terminals the way `src/terminal/view.tsx` does. Three terminals with the same font
// (so one atlas): A and B show Claude-Code-like styled output, B is hidden (`display: none`, as
// `PaneLayer` hides another tab), a new terminal C opens and, its faces loaded, redraws (#315),
// then B is shown again and its status line ticks. B's pixels are compared with the same output
// drawn by a terminal alone in a fresh page. Exit 1 when they differ.
import { chromium } from '../node_modules/playwright/index.mjs'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const fontsTs = resolve(arg('--fonts', join(repo, 'src/terminal/fonts.ts')))
const out = arg('--out')
const trigger = arg('--trigger', 'new-pane')
const nm = join(repo, 'node_modules')

const files = {
  '/xterm.mjs': [join(nm, '@xterm/xterm/lib/xterm.mjs'), 'text/javascript'],
  '/webgl.mjs': [join(nm, '@xterm/addon-webgl/lib/addon-webgl.mjs'), 'text/javascript'],
  '/xterm.css': [join(nm, '@xterm/xterm/css/xterm.css'), 'text/css'],
}
const serve = async (route) => {
  const path = new URL(route.request().url()).pathname
  if (path === '/fonts.mjs') {
    const js = stripTypeScriptTypes(readFileSync(fontsTs, 'utf8'))
    return route.fulfill({ body: js, contentType: 'text/javascript' })
  }
  if (path.startsWith('/jbm/')) {
    const file = join(nm, '@fontsource/jetbrains-mono', path.slice(5))
    const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'font/woff'
    return route.fulfill({ body: readFileSync(file), contentType: type })
  }
  if (files[path]) return route.fulfill({ body: readFileSync(files[path][0]), contentType: files[path][1] })
  if (path === '/') return route.fulfill({ body: PAGE, contentType: 'text/html' })
  return route.fulfill({ status: 404, body: '' })
}

const PAGE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/xterm.css">
<link rel="stylesheet" href="/jbm/400.css"><link rel="stylesheet" href="/jbm/700.css">
<style>body{margin:0;background:#111} .t{position:absolute;top:0;width:640px;height:300px}</style>
<div id="a" class="t" style="left:0"></div><div id="b" class="t" style="left:660px"></div>
<div id="c" class="t" style="left:0;top:320px"></div>`

// Runs in the page. `open` follows view.tsx: open, WebGL, ask for the faces, redraw on arrival.
async function page([mode, trigger]) {
  const { Terminal } = await import('/xterm.mjs')
  const { WebglAddon } = await import('/webgl.mjs')
  const fonts = await import('/fonts.mjs')
  const family = "'JetBrains Mono', ui-monospace, Menlo, monospace"
  const frames = (n = 4) => new Promise((r) => {
    const step = () => (n-- > 0 ? requestAnimationFrame(step) : r())
    step()
  })
  const write = (t, s) => new Promise((r) => t.write(s, r))
  const open = (id) => {
    const term = new Terminal({ fontFamily: family, fontSize: 13, cols: 80, rows: 16, cursorBlink: false })
    term.open(document.getElementById(id))
    const webgl = new WebglAddon(true)
    // A page merge removes the canvases merged; each terminal on the atlas hears it.
    webgl.onRemoveTextureAtlasCanvas(() => (window.merged = (window.merged ?? 0) + 1))
    term.loadAddon(webgl)
    const forget = fonts.track?.(term)
    void fonts.loadFaces(family, 13).then(() => fonts.redraw(term))
    fonts.onFaces(family, () => fonts.redraw(term))
    return { term, forget }
  }
  const E = '\x1b['
  const claude = (who) =>
    `${E}?25l${E}38;5;208m╭${'─'.repeat(40)}╮${E}0m\r\n` +
    `${E}38;5;208m│${E}0m ${E}1m✻ Welcome to Claude Code!${E}0m ${who}\r\n` +
    `${E}38;5;208m╰${'─'.repeat(40)}╯${E}0m\r\n\r\n` +
    `${E}1;32mRead${E}0m 4 files (ctrl+o to expand)\r\n` +
    `${E}1;35mUpdate${E}0m(src/terminal/view.tsx)\r\n` +
    `plain body text, default colour, the quick brown fox\r\n` +
    `${E}1;34mBash${E}0m(pnpm test) ${E}2m⎿ 2189 passed${E}0m\r\n` +
    `${E}38;5;244m${'─'.repeat(78)}${E}0m\r\n` +
    `${E}48;5;24;38;5;231m ▸▸ accept edits on ${E}0m ${E}33m◯ ide${E}0m`
  const status = (n) => `${E}16;1H${E}2K${E}48;5;24;38;5;231m ▸▸ accept edits on ${E}0m ${E}33m◯ tick ${n}${E}0m`

  if (mode === 'reference') {
    // B's output, drawn by a terminal alone, with every face long since loaded.
    await document.fonts.load(`400 13px ${family}`)
    await document.fonts.load(`700 13px ${family}`)
    const b = open('b')
    await write(b.term, claude('pane B'))
    await write(b.term, status(1))
    await frames(10)
    return
  }
  const a = open('a')
  const b = open('b')
  await write(a.term, claude('pane A').replace(/Read|Update|Bash/g, (w) => w.toUpperCase()) + '\r\n$ git status')
  await write(b.term, claude('pane B'))
  await document.fonts.ready
  await frames(10)
  // Another tab: B is hidden, as PaneLayer hides the panes of a tab not shown.
  document.getElementById('b').style.display = 'none'
  await frames(4)
  if (trigger === 'new-pane') {
    // A new pane opens in the shown tab; its faces are already here, so the load settles at
    // once and it redraws, dropping the atlas every terminal with this font shares.
    const c = open('c')
    await write(c.term, `${E}1;31mERROR${E}0m something else: ${E}4;36mhttps://example.com${E}0m\r\n~/code $ ls -la`)
    await frames(10)
  } else {
    // A, shown, prints glyphs in many colours until the atlas fills its pages and merges them.
    for (let round = 0; round < 200; round++) {
      let s = ''
      for (let i = 0; i < 12; i++) {
        s += `${E}38;5;${(round * 12 + i) % 256};48;5;${Math.floor((round * 12 + i) / 256)}m`
        for (let ch = 33; ch < 127; ch++) s += String.fromCharCode(ch)
        s += `${E}0m\r\n`
      }
      await write(a.term, s)
      await frames(1)
    }
    await frames(10)
  }
  // Back to B's tab. Claude Code's status line keeps ticking, so B draws a frame.
  document.getElementById('b').style.display = ''
  await frames(4)
  await write(b.term, status(1))
  await frames(10)
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const shoot = async (mode) => {
  const p = await browser.newPage({ viewport: { width: 1320, height: 640 } })
  const errors = []
  p.on('pageerror', (e) => errors.push(String(e)))
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await p.route('http://repro.local/**', serve)
  await p.goto('http://repro.local/')
  await p.evaluate(page, [mode, trigger])
  const webgl = await p.evaluate(() => document.querySelectorAll('#b canvas').length)
  const merged = await p.evaluate(() => window.merged ?? 0)
  const png = await p.locator('#b').screenshot()
  await p.close()
  if (errors.length) console.error(`${mode}: page errors\n  ${errors.join('\n  ')}`)
  return { png, webgl, merged }
}

const ref = await shoot('reference')
const got = await shoot('switch')
// Compare the two PNGs pixel by pixel in a page: decode both and count differing pixels.
const p = await browser.newPage()
const diff = await p.evaluate(
  async ([x, y]) => {
    const px = async (b64) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const c = new OffscreenCanvas(img.width, img.height)
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      return ctx.getImageData(0, 0, img.width, img.height).data
    }
    const [r, g] = [await px(x), await px(y)]
    let n = 0
    for (let i = 0; i < r.length; i += 4) {
      if (Math.abs(r[i] - g[i]) + Math.abs(r[i + 1] - g[i + 1]) + Math.abs(r[i + 2] - g[i + 2]) > 48) n++
    }
    return { n, of: r.length / 4 }
  },
  [ref.png.toString('base64'), got.png.toString('base64')],
)
await browser.close()

if (out) {
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'reference.png'), ref.png)
  writeFileSync(join(out, 'after-switch.png'), got.png)
}
console.log(`fonts: ${fontsTs}, trigger: ${trigger}`)
console.log(`atlas canvases merged away (heard by every terminal): ${got.merged}`)
console.log(`canvases in B: ${got.webgl} (WebGL renderer: ${got.webgl > 1 ? 'yes' : 'NO'})`)
console.log(`B after the switch differs from the reference in ${diff.n} of ${diff.of} pixels`)
console.log(diff.n === 0 ? 'clean' : 'GARBLED')
process.exit(diff.n === 0 ? 0 : 1)

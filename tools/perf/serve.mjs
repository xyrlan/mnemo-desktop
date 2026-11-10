// Serves the production bundle (`dist/`) where a debug core looks for its front, so the app
// that is measured runs the front a release runs, not a dev server's (React in development
// mode costs several times more).
//
//   pnpm exec vite build
//   node tools/perf/serve.mjs --world capture --view orbit      # port 1420, where `tauri dev` looks
//   node tools/perf/serve.mjs --port 1420 --world sample --view console --motion full
//
// A production front refuses `desktop_app_drive`, so where the app opens is said here: the
// page is served with a line that sets `mnemo.world`, `mnemo.route`, `mnemo.motion`,
// `mnemo.next` and `mnemo.boot` before the app's own code runs. `--world live` leaves the
// world to the core. Start the debug build after this (under a home of its own), give it a
// moment, and measure it with `rest.mjs`.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.webm': 'video/webm', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon' }

/** The line that says where the app opens, as a script the page runs first. */
export function opening({ world, view, motion }) {
  const set = { 'mnemo.next': '1', 'mnemo.boot': '0', 'mnemo.route': `#v=${view}`, 'mnemo.motion': motion }
  if (world !== 'live') set['mnemo.world'] = world
  const lines = Object.entries(set).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`)
  if (world === 'live') lines.push(`localStorage.removeItem('mnemo.world')`)
  return `<script>${lines.join(';')}</script>`
}

/** `index.html` with the opening line before anything else in its head. */
export const withOpening = (html, line) => (html.includes('<head>') ? html.replace('<head>', `<head>${line}`) : line + html)

function main() {
  const args = process.argv.slice(2)
  const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback)
  const dir = path.resolve(value('--dir', path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist')))
  const port = Number(value('--port', '1420'))
  const line = opening({ world: value('--world', 'sample'), view: value('--view', 'orbit'), motion: value('--motion', 'full') })
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
    const file = path.join(dir, name)
    try {
      if (!file.startsWith(dir)) throw new Error('outside')
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
      res.end(name === 'index.html' ? withOpening(body.toString('utf8'), line) : body)
    } catch {
      res.writeHead(404)
      res.end()
    }
  }).listen(port, '127.0.0.1', () => process.stdout.write(`serving ${dir} on http://localhost:${port}/\n`))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

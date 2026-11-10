// The front's bundle, measured: what `vite build` wrote to `dist/`, in all and by what it is.
// The design's budget is 6 MB with the art (docs/superpowers/specs/2026-11-10-recreation-design.md,
// "Motion and its budget").
//
//   pnpm exec vite build && node tools/perf/bundle.mjs            # a table
//   node tools/perf/bundle.mjs --json                              # the same, as JSON
//   node tools/perf/bundle.mjs --dir path/to/dist
//   node tools/perf/bundle.mjs --behind Frame-       # what only the chunks so named lead to
//
// With `--behind` it also says what stands behind one door: the files the pages reach only
// through the chunks so named. That is how a number over the budget is traced to what costs
// (the code editor of the interface the app had before, 13.39 MB, was found this way).
//
// A file a dev build alone reads (`world.capture.json`, the machine's own capture, copied from
// `public/` when it is there) is not part of what ships and is left out, and said.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUDGET_BYTES = 6 * 1024 * 1024

/** Files that `vite build` copies from `public/` on a developer's machine and no release has. */
export const LOCAL_ONLY = ['world.capture.json']

const KINDS = [
  ['art (clips and stills)', /\.(webm|mp4|jpe?g|png|gif|webp|avif)$/i],
  ['fonts', /\.(woff2?|ttf|otf)$/i],
  ['styles', /\.css$/i],
  ['scripts', /\.(m?js)$/i],
  ['pages', /\.html$/i],
]

/** What a file is, for the table. */
export const kindOf = (file) => KINDS.find(([, re]) => re.test(file))?.[0] ?? 'other'

/** Every file under `dir`, with its size. */
export function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const at = path.join(dir, name)
    const stat = statSync(at)
    if (stat.isDirectory()) out.push(...walk(at, base))
    else out.push({ file: path.relative(base, at).split(path.sep).join('/'), bytes: stat.size })
  }
  return out
}

/** The bundle's sizes: in all, by kind, the largest files, and what was left out. `groups` puts
 *  the chunks of one library under one name (the editor's languages are a hundred small files). */
export function measure(files, { localOnly = LOCAL_ONLY, top = 12 } = {}) {
  const shipped = files.filter((f) => !localOnly.includes(path.posix.basename(f.file)))
  const left = files.filter((f) => localOnly.includes(path.posix.basename(f.file)))
  const total = shipped.reduce((n, f) => n + f.bytes, 0)
  const byKind = {}
  for (const f of shipped) byKind[kindOf(f.file)] = (byKind[kindOf(f.file)] ?? 0) + f.bytes
  const largest = [...shipped].sort((a, b) => b.bytes - a.bytes).slice(0, top)
  return { total, budget: BUDGET_BYTES, within: total <= BUDGET_BYTES, files: shipped.length, byKind, largest, leftOut: left }
}

/** Which files each file names: a chunk names the chunks it imports, the workers it starts and
 *  the assets it shows by their file names, which the build made unique. `text(file)` reads one. */
export function references(files, text) {
  const names = new Map(files.map((f) => [path.posix.basename(f.file), f.file]))
  const out = new Map()
  for (const f of files) {
    if (!/\.(m?js|css|html)$/i.test(f.file)) continue
    const body = text(f.file)
    const found = new Set()
    for (const [name, file] of names) if (file !== f.file && body.includes(name)) found.add(file)
    out.set(f.file, found)
  }
  return out
}

/** Every file the pages reach, never going through a file `shut` says is closed. */
export function reached(files, refs, shut = () => false) {
  const seen = new Set()
  const walk = (file) => {
    if (seen.has(file) || shut(file)) return
    seen.add(file)
    for (const next of refs.get(file) ?? []) walk(next)
  }
  for (const f of files) if (/\.html$/i.test(f.file)) walk(f.file)
  return seen
}

/** What the pages reach only through the chunks whose names start with one of `doors`: the
 *  doors themselves and everything behind them. */
export function behind(files, refs, doors) {
  const isDoor = (file) => doors.some((d) => path.posix.basename(file).startsWith(d))
  const all = reached(files, refs)
  const without = reached(files, refs, isDoor)
  const only = files.filter((f) => all.has(f.file) && !without.has(f.file))
  return { files: only.length, bytes: only.reduce((n, f) => n + f.bytes, 0), unreached: files.filter((f) => !all.has(f.file)).map((f) => f.file) }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

function main() {
  const args = process.argv.slice(2)
  const at = args.indexOf('--dir')
  const dir = at >= 0 ? path.resolve(args[at + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist')
  let files
  try {
    files = walk(dir)
  } catch {
    process.stderr.write(`no bundle at ${dir}: run \`pnpm exec vite build\` first\n`)
    process.exit(2)
  }
  const m = measure(files)
  const doorAt = args.indexOf('--behind')
  const doors = doorAt >= 0 ? args[doorAt + 1].split(',') : null
  const shipped = files.filter((f) => !LOCAL_ONLY.includes(path.posix.basename(f.file)))
  const b = doors && behind(
    shipped,
    references(shipped, (file) => readFileSync(path.join(dir, file), 'utf8')),
    doors,
  )
  if (doors && b) m.behind = { doors, ...b, rest: m.total - b.bytes }
  if (args.includes('--json')) return void process.stdout.write(JSON.stringify(m, null, 2) + '\n')
  const lines = [`${mb(m.total)} in ${m.files} files (budget ${mb(m.budget)}: ${m.within ? 'within' : 'over'})`, '']
  for (const [kind, bytes] of Object.entries(m.byKind).sort((a, b) => b[1] - a[1])) lines.push(`  ${mb(bytes).padStart(9)}  ${kind}`)
  lines.push('', 'largest:')
  for (const f of m.largest) lines.push(`  ${mb(f.bytes).padStart(9)}  ${f.file}`)
  if (doors && b) lines.push('', `reached only through ${doors.join(', ')}: ${mb(b.bytes)} in ${b.files} files; everything else: ${mb(m.behind.rest)}`)
  for (const f of m.leftOut) lines.push('', `left out, a dev build's own: ${f.file} (${mb(f.bytes)})`)
  process.stdout.write(lines.join('\n') + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

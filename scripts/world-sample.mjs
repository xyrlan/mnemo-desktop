// The prototypes' capture, as JSON the front can import.
//
//   node scripts/world-sample.mjs          # data.sample.js -> src/world/sample.capture.json (committed)
//   node scripts/world-sample.mjs --real   # data.js        -> public/world.capture.json     (gitignored)
//
// `src/world/capture.ts` turns either into a `World`. The synthetic one is what `?world=sample`
// draws and what every view is developed against; the real one (`?world=capture`, a dev build
// only) is this machine's sessions as `prototypes/redesign/capture.py` last wrote them, for
// judging a view on real data before the live world exists. It never leaves the machine.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const real = process.argv.includes('--real')
const from = resolve(root, 'docs/superpowers/prototypes/redesign', real ? 'data.js' : 'data.sample.js')
const to = resolve(root, real ? 'public/world.capture.json' : 'src/world/sample.capture.json')

const text = readFileSync(from, 'utf8').trim()
const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
const capture = JSON.parse(json)
mkdirSync(dirname(to), { recursive: true })
writeFileSync(to, JSON.stringify(capture) + '\n')
console.log(`${to}: ${capture.sessions.length} sessions, ${capture.pending.length} pending`)

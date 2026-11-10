// The new front on the synthetic world (src/world/sample.ts): what a scenario of the recreation
// starts from. The world needs no core, so the launch fixture answers the rest of the app.
//
//   scenario('next-console', next({ v: 'console', s: sessionTitled('Order status history') }))
//   scenario('next-memory', { ...next({ v: 'console', s: id, r: 'memory' }), drive: async (page) => { … } })
import { readFileSync } from 'node:fs'
import { appIpc } from './app.mjs'

const capture = JSON.parse(readFileSync(new URL('../../../src/world/sample.capture.json', import.meta.url), 'utf8'))

/** The sample's sessions, as the capture has them: `id`, `short`, `title`, `state`, `role`. */
export const sessions = capture.sessions

/** The id of the sample session whose title starts with `text`. */
export function sessionTitled(text) {
  const hit = sessions.find((s) => s.title.startsWith(text))
  if (!hit) throw new Error(`no sample session titled "${text}…"; there are: ${sessions.map((s) => s.title).join(' | ')}`)
  return hit.id
}

/** A scenario setup: the new front, the sample world, at `route` (the keys of the hash:
 *  `v` view, `s` session, `r` reading, `at`, `p` pending, `panel`, `wide`, `cmd`). */
export function next(route = {}, ipc = {}) {
  return {
    storage: {
      'mnemo.next': '1',
      'mnemo.world': 'sample',
      'mnemo.route': '#' + new URLSearchParams(route).toString(),
    },
    ipc: appIpc(ipc),
  }
}

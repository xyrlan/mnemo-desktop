// The synthetic world: every name, prompt, path and number in it is invented
// (docs/superpowers/prototypes/redesign/sample.py), so it is the world screenshots are taken
// with and tests run on. Its actions change it and nothing else.

import type { Actions, Outcome } from './actions'
import { fromCapture } from './capture'
import capture from './sample.capture.json'
import type { Session, SessionState, World } from './types'

const shots = import.meta.glob<string>('./sample-shots/*.svg', { query: '?url', import: 'default', eager: true })

export const sampleWorld = (): World => fromCapture(capture, 'sample')

const ok = (note?: string): Outcome => ({ ok: true, note })

/** Actions over a world held in memory: an answer settles its item and moves its session on,
 *  as the real answer would, and nothing leaves the page. `said` collects what was done, for a
 *  test to read. */
export function sampleActions(get: () => World, set: (world: World) => void, said: string[] = []): Actions {
  const move = (id: string, state: SessionState, patch: Partial<Session> = {}) => {
    const world = get()
    set({ ...world, pending: world.pending.filter((p) => p.session !== id), sessions: world.sessions.map((s) => (s.id === id ? { ...s, state, lastAt: world.at, ...patch } : s)) })
  }
  const did = (line: string, note?: string): Outcome => {
    said.push(line)
    return ok(note)
  }
  return {
    open: async (id) => did(`open ${id}`),
    async answer(pendingId, key) {
      const world = get()
      const item = world.pending.find((p) => p.id === pendingId)
      const choice = item?.choices.find((c) => c.key === key)
      if (!item || !choice) return { ok: false, why: 'That is no longer waiting.' }
      const next: SessionState = item.kind === 'merge' ? 'ended' : choice.tone === 'bad' && item.kind !== 'permission' ? 'ended' : 'working'
      move(item.session, next)
      return did(`answer ${pendingId} ${key}`, choice.label)
    },
    async reply(id, text) {
      move(id, 'working', { lastPrompt: text })
      return did(`reply ${id} ${text}`)
    },
    async stop(id) {
      move(id, 'ended', { live: false })
      return did(`stop ${id}`)
    },
    async close(id) {
      move(id, 'ended', { live: false, hosted: false })
      return did(`close ${id}`)
    },
    newSession: async (root) => did(`new ${root}`, 'The sample world starts no session.'),
    newShell: async (root) => did(`shell ${root}`, 'The sample world starts no shell.'),
    dispatch: async (root, issues) => did(`dispatch ${root} ${issues.join(',')}`, 'The sample world dispatches nothing.'),
    dispatchContract: async (root, path) => did(`contract ${root} ${path}`, 'The sample world dispatches nothing.'),
    message: async (id, text) => did(`message ${id} ${text}`),
    async mergeGreen() {
      const world = get()
      const green = world.pending.filter((p) => p.kind === 'merge' && p.pr?.ci === 'green')
      for (const p of green) move(p.session, 'ended')
      return did('merge green', `${green.length} merged`)
    },
    land: async (root, feature) => did(`land ${root} ${feature}`),
    async shot(_id, shotId) {
      const name = shotId.split('/').pop()
      const hit = Object.entries(shots).find(([path]) => path.endsWith('/' + name))
      return hit ? hit[1] : null
    },
    external: async (target) => did(`external ${target}`),
  }
}

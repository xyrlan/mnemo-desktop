/** Who speaks in a room (spec "Motion"): as many bubbles as the room is wide. A line that just
 *  changed takes the floor from the voice that has spoken longest; when more robots than voices
 *  stand there, the rest take turns every `TURN_MS`. */

export type Voice = { id: string; at: number }

/** How long a voice keeps the floor before the next robot's turn. */
export const TURN_MS = 4_500
/** A line this fresh speaks first. */
export const FRESH_MS = 3_000

/** The voices after `prev` at `now`. `ids`: the room's robots in floor order. `saidAt(id)`: when
 *  its line last changed. `rotate`: whether turns are taken (not with reduced motion). Pure. */
export function pickVoices(prev: Voice[], ids: string[], saidAt: (id: string) => number, voices: number, now: number, rotate: boolean): Voice[] {
  if (!voices || !ids.length) return []
  const here = new Set(ids)
  let cur = prev.filter((v) => here.has(v.id))
  const speaking = (id: string) => cur.some((v) => v.id === id)
  for (const id of ids) {
    if (speaking(id) || now - saidAt(id) >= FRESH_MS) continue
    if (cur.length < voices) cur.push({ id, at: now })
    else {
      cur = [...cur].sort((a, b) => a.at - b.at)
      cur[0] = { id, at: now }
    }
  }
  for (const id of ids) {
    if (cur.length >= voices) break
    if (!speaking(id)) cur.push({ id, at: now })
  }
  if (rotate && ids.length > voices) {
    cur = [...cur].sort((a, b) => a.at - b.at)
    if (now - cur[0].at >= TURN_MS) {
      const last = Math.max(...cur.map((v) => ids.indexOf(v.id)))
      for (let k = 1; k <= ids.length; k++) {
        const next = ids[(last + k) % ids.length]
        if (!speaking(next)) {
          cur[0] = { id: next, at: now }
          break
        }
      }
    }
  }
  return cur.slice(-voices)
}

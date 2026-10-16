import { basename } from '../../path/path'
import type { RepoNode } from '../../fleet/types'
import type { DrawerTab } from '../store'
import { labelOf, repoOf, type Figure } from './model'

/** The drawer's session pills (#467): what each says, and how many fit in the header's two rows. */

/** The most a pill's name says, in characters: about two short words. */
export const SHORT_MAX = 14

/** The first words of `name` that fit in `max` characters; a first word longer than that, cut short.
 *  A word of marks only (`·`, `—`) never ends it. */
export function shortName(name: string, max = SHORT_MAX): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  if (words[0].length > max) return `${words[0].slice(0, max - 1)}…`
  let out = words[0]
  for (const w of words.slice(1)) {
    if (out.length + 1 + w.length > max) break
    out += ` ${w}`
  }
  return out.replace(/(\s+[^\p{L}\p{N}#$]+)+$/u, '')
}

/** What a tab's pill says: a child its issue (`#465`), a captain its emblem and the first words of
 *  its name, a shell `$ <repo>`. `full` is its whole name, for the hover and the menu. */
export function pillOf(tab: DrawerTab, figure: Figure | null, repos: readonly RepoNode[]): { text: string; full: string } {
  if (figure?.kind === 'captain') {
    const { emblem, name } = figure.captain
    return { text: `${emblem} ${shortName(name)}`, full: `${emblem} ${name}` }
  }
  if (figure) return { text: shortName(labelOf(figure)), full: labelOf(figure) }
  if (tab.kind === 'session') {
    const repo = tab.cwd ? (repoOf(tab.cwd, repos)?.name ?? basename(tab.cwd)) : ''
    return { text: repo ? `$ ${shortName(repo)}` : shortName(tab.label), full: tab.label }
  }
  return { text: shortName(tab.label), full: tab.label }
}

/** How many rows items of widths `widths` take when laid out as `flex-wrap` does, `gap` apart in
 *  `room` px. */
export function rowsOf(widths: readonly number[], room: number, gap: number): number {
  let rows = 0
  let x = 0
  for (const w of widths) {
    if (rows && x + gap + w <= room + 0.5) x += gap + w
    else {
      rows++
      x = w
    }
  }
  return rows
}

/** The order the pills are drawn in and how many of them are (`shown`): every one when they fit
 *  in `rows` rows; else as many as fit with a `+N` pill after them (`more(n)` is its width), the
 *  active one always among them. The rest are in the `+N` pill's menu. */
export function fitPills(
  ids: readonly string[],
  width: (id: string) => number,
  more: (n: number) => number,
  room: number,
  gap: number,
  active: string | null,
  rows = 2,
): { order: string[]; shown: number } {
  const fit = (order: readonly string[]) => {
    const ws = order.map(width)
    if (rowsOf(ws, room, gap) <= rows) return order.length
    for (let k = order.length - 1; k > 0; k--) if (rowsOf([...ws.slice(0, k), more(order.length - k)], room, gap) <= rows) return k
    return 0
  }
  let order = [...ids]
  let shown = fit(order)
  // The active pill takes the last place shown, as often as its width makes the room smaller.
  for (let i = 0; i < ids.length && active !== null && shown > 0 && order.indexOf(active) >= shown; i++) {
    order = order.filter((id) => id !== active)
    order.splice(shown - 1, 0, active)
    shown = fit(order)
  }
  return { order, shown }
}

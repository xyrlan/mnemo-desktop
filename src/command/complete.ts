// What the command line offers for the text typed so far: verbs, then whatever the verb takes
// next, completed against the world's own sessions, projects and contracts.

import { panels } from '../panels/registry'
import { MODELS } from '../tasks/model'
import { WORD } from '../world/format'
import { rosterOrder } from '../world/store'
import type { Session, SessionState, World } from '../world/types'
import { EFFORTS, MAY, OPTION_KEYS, VERBS, WHOLE, bare, features, greenPulls, nameOf, runningChildren, sessionCalled, verbOf } from './parse'

export interface Offer {
  kind: 'verb' | 'session' | 'project' | 'feature' | 'option' | 'word' | 'panel'
  /** The short mark before the row: a verb, a project, an option. A session shows its state. */
  tag: string
  label: string
  detail: string
  /** The line once this is taken (Tab, or Enter). */
  fill: string
  /** Taking it completes the line: Enter runs it at once. */
  runs: boolean
  state?: SessionState
}

const MOST = 8

/** The sessions a word finds: every part of the word in the title, the project, the short id,
 *  the piece or the issue, in roster order. */
export function matchSessions(word: string, world: World, keep: (s: Session) => boolean = () => true): Session[] {
  const w = word.toLowerCase()
  return rosterOrder(world).filter((s) => keep(s) && `${s.title} ${s.project ?? ''} ${s.short} ${s.contract?.piece ?? ''} ${s.issue != null ? `#${s.issue}` : ''}`.toLowerCase().includes(w))
}

const sessionRow = (s: Session, fill: string, runs: boolean): Offer => ({
  kind: 'session',
  tag: '',
  label: nameOf(s),
  detail: [s.project, WORD[s.state], s.short].filter(Boolean).join(' · '),
  fill,
  runs,
  state: s.state,
})

/** What `model=` completes to: the models `mnemo dispatch` names (`src/tasks/model.ts`, the
 *  Missions panel's own list), newest first, then the ones the fleet is running now, most used
 *  first. */
export function models(world: World): string[] {
  const count = new Map<string, number>()
  for (const s of world.sessions) if (s.model) count.set(s.model, (count.get(s.model) ?? 0) + 1)
  const running = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
  return [...new Set([...MODELS.filter(Boolean).reverse(), ...running])]
}

/** The panels a word finds: the ones whose name starts with it. Enter opens one. */
function panelOffers(word: string): Offer[] {
  const w = word.toLowerCase()
  return panels()
    .filter((p) => p.id.startsWith(w) || p.title.toLowerCase().startsWith(w))
    .map((p) => ({ kind: 'panel', tag: 'panel', label: p.title, detail: p.hint ?? 'a panel', fill: `panel ${p.id}`, runs: true }))
}

function optionOffers(head: string, word: string, world: World): Offer[] {
  const eq = word.indexOf('=')
  if (eq < 0) {
    if (!word) return []
    return OPTION_KEYS.filter((k) => k.startsWith(word.toLowerCase())).map((k) => ({ kind: 'option', tag: 'option', label: `${k}=`, detail: OPTION_DOES[k], fill: `${head}${k}=`, runs: false }))
  }
  const key = word.slice(0, eq).toLowerCase()
  const typed = word.slice(eq + 1).toLowerCase()
  const values: readonly string[] = key === 'may' ? MAY : key === 'effort' ? EFFORTS : key === 'model' || key === 'advisor' ? models(world) : []
  return values
    .filter((v) => v.toLowerCase().startsWith(typed) && v.toLowerCase() !== typed)
    .slice(0, MOST)
    .map((v) => ({ kind: 'option', tag: key, label: v, detail: key === 'may' ? MAY_DOES[v] : key === 'effort' ? 'effort' : MODELS.includes(v) ? 'a model' : 'a model the fleet runs now', fill: `${head}${key}=${v} `, runs: false }))
}

const OPTION_DOES: Record<string, string> = {
  model: 'the model each child runs',
  effort: EFFORTS.join(', '),
  may: 'what a child may publish: ' + MAY.join(', '),
  advisor: 'the model a child may ask',
}
const MAY_DOES: Record<string, string> = { pr: 'push and open a pull request', push: 'push its branch, no pull request', none: 'publish nothing' }

/** The rows under the line. Empty when the line is past what can be completed (free words). */
export function offers(line: string, world: World): Offer[] {
  const text = bare(line)
  const m = /^(\S*)(\s+)?([\s\S]*)$/.exec(text)!
  const first = m[1]
  const typingVerb = !m[2]
  const verb = verbOf(first)

  if (typingVerb || !verb) {
    const out: Offer[] = typingVerb
      ? VERBS.filter((v) => v.verb.startsWith(first.toLowerCase())).map((v) => {
          const whole = WHOLE.includes(v.verb)
          return { kind: 'verb', tag: v.verb, label: v.form, detail: v.does, fill: whole ? v.verb : `${v.verb} `, runs: whole }
        })
      : []
    // Part of a panel's name, or of a session's, typed with no verb, finds it: Enter opens it.
    const words = text.trim()
    if (words && typingVerb) out.push(...panelOffers(words))
    if (words) for (const s of matchSessions(words, world).slice(0, MOST)) out.push(sessionRow(s, `go ${s.short}`, true))
    return out
  }

  const rest = m[3]
  const words = rest.split(/\s+/)
  const word = words[words.length - 1] ?? ''
  const head = `${verb.verb} ${words.slice(0, -1).join(' ')}${words.length > 1 ? ' ' : ''}`
  const onFirst = words.length === 1

  switch (verb.verb) {
    case 'new':
    case 'shell':
    case 'dispatch': {
      if (onFirst) {
        return world.projects
          .filter((p) => p.name.toLowerCase().includes(word.toLowerCase()))
          .slice(0, MOST)
          .map((p) => ({ kind: 'project', tag: 'project', label: p.name, detail: `${p.sessions.length} ${p.sessions.length === 1 ? 'session' : 'sessions'}${p.root ? '' : ' · no folder known'}`, fill: `${verb.verb} ${p.name} `, runs: verb.verb === 'shell' && !!p.root }))
      }
      return verb.verb === 'dispatch' ? optionOffers(head, word, world) : []
    }
    case 'message':
    case 'stop':
    case 'go': {
      if (!onFirst) return []
      // A name already whole (and no longer being typed) needs no list.
      if (sessionCalled(word, world) && verb.verb === 'message') return []
      const out: Offer[] = []
      const crew = runningChildren(world)
      if (verb.verb !== 'go' && crew.length && 'all'.startsWith(word.toLowerCase())) {
        out.push({ kind: 'word', tag: 'all', label: `every running child (${crew.length})`, detail: 'asked about before it runs', fill: `${verb.verb} all${verb.verb === 'message' ? ' ' : ''}`, runs: verb.verb === 'stop' })
      }
      const keep = verb.verb === 'stop' ? (s: Session) => s.live : undefined
      for (const s of matchSessions(word, world, keep).slice(0, MOST)) out.push(sessionRow(s, `${verb.verb} ${s.short}${verb.verb === 'message' ? ' ' : ''}`, verb.verb !== 'message'))
      return out
    }
    case 'panel':
      return onFirst ? panelOffers(word) : []
    case 'merge': {
      if (!onFirst || !'green'.startsWith(word.toLowerCase())) return []
      const green = greenPulls(world)
      return [{ kind: 'word', tag: 'green', label: green.length ? green.map((p) => `#${p.number} ${p.title ?? ''}`.trim()).join(' · ') : 'no open pull request has green checks', detail: 'asked about before it runs', fill: 'merge green', runs: green.length > 0 }]
    }
    case 'land': {
      if (!onFirst) return []
      return features(world)
        .filter((f) => f.feature.toLowerCase().includes(word.toLowerCase()))
        .slice(0, MOST)
        .map((f) => ({ kind: 'feature', tag: 'feature', label: f.feature, detail: `${f.pieces} ${f.pieces === 1 ? 'piece' : 'pieces'} here`, fill: `land ${f.feature}`, runs: !!f.root }))
    }
  }
  return []
}

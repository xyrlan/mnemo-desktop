// A line typed at the command line, read against the world
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "The frame"). It is the parser of
// `src/nexus/command/parse.ts` on `World` instead of the ship: the same verbs, the same three
// batch verbs that are confirmed before they run, and a refusal is always a sentence.

import { panels } from '../panels/registry'
import type { DispatchOptions } from '../world/actions'
import type { PanelId } from '../world/route'
import { rosterOrder, sessionOf } from '../world/store'
import type { Project, PullRequest, Session, World } from '../world/types'

/** What a line asks for, with every name already resolved against the world. */
export type Command =
  | { kind: 'go'; session: string }
  | { kind: 'new'; root: string; project: string; prompt: string | null; agent: string | null }
  | { kind: 'shell'; root: string; project: string }
  | { kind: 'dispatch'; root: string; project: string; issues: number[]; options: DispatchOptions }
  | { kind: 'contract'; root: string; project: string; path: string; options: DispatchOptions }
  | { kind: 'message'; to: string; text: string }
  | { kind: 'merge-green' }
  | { kind: 'land'; root: string; feature: string }
  | { kind: 'stop'; sessions: string[] }
  | { kind: 'panel'; panel: PanelId }

/** `says` is what Enter will do, in words. `batch`: it reaches more than one session, so it is
 *  asked about before it runs. */
export type Parsed = { command: Command; says: string; batch: boolean } | { error: string }

export interface Verb {
  verb: string
  /** How it is written. */
  form: string
  does: string
}

export const VERBS: readonly Verb[] = [
  { verb: 'new', form: 'new <project> [first prompt]', does: 'start a session in a project' },
  { verb: 'shell', form: 'shell <project>', does: 'open a plain shell in a project' },
  { verb: 'dispatch', form: 'dispatch <project> <#issue … | contract.md> [model= effort= may=]', does: 'a child per issue, or the pieces of a contract' },
  { verb: 'message', form: 'message <session | all> <words>', does: 'say something to a session, or to every running child' },
  { verb: 'merge', form: 'merge green', does: 'merge every pull request whose checks are green' },
  { verb: 'land', form: 'land <feature>', does: "land a contract's feature" },
  { verb: 'stop', form: 'stop <session | all>', does: 'stop a session, or every running child' },
  { verb: 'go', form: 'go <session>', does: 'put a session on stage' },
  { verb: 'panel', form: 'panel <name>', does: 'open a panel: projects, missions, changes, memory, learned, accounts, setup, settings' },
]

const ALIAS: Record<string, string> = { msg: 'message', open: 'go' }

/** The verb a first word names, or null. */
export const verbOf = (word: string): Verb | null => {
  const w = word.toLowerCase()
  return VERBS.find((v) => v.verb === (ALIAS[w] ?? w)) ?? null
}

/** What `may=` takes, and the efforts Claude Code knows. */
export const MAY = ['pr', 'push', 'none'] as const
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const OPTION_KEYS = ['model', 'effort', 'may', 'advisor'] as const

/** A line without the sign people type from habit (`/dispatch`, `:dispatch`, `;dispatch`). */
export const bare = (line: string): string => line.replace(/^\s*[/:;]?\s*/, '')

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A session's name at the command line: its title, cut to fit a sentence. */
export const nameOf = (s: Session): string => (s.title.length > 48 ? s.title.slice(0, 47).trimEnd() + '…' : s.title) || s.short

const names = (list: Session[]) => (list.length > 4 ? `${list.slice(0, 3).map(nameOf).join(' · ')} and ${list.length - 3} more` : list.map(nameOf).join(' · '))

/** The children a batch verb reaches: every one a process is running now. */
export const runningChildren = (world: World): Session[] => rosterOrder(world).filter((s) => s.role === 'child' && s.live)

/** Every open pull request the world knows whose checks are green: what `merge green` merges. */
export function greenPulls(world: World): PullRequest[] {
  const seen = new Map<string, PullRequest>()
  const take = (pr: PullRequest | null) => {
    if (pr && pr.state !== 'merged' && pr.state !== 'closed' && pr.ci === 'green' && !/conflict/i.test(pr.mergeable ?? '')) seen.set(pr.url, pr)
  }
  for (const s of world.sessions) s.prs.forEach(take)
  for (const p of world.pending) take(p.pr)
  return [...seen.values()]
}

/** The features of the contracts in the world, each with the root it lands in. */
export function features(world: World): { feature: string; root: string | null; pieces: number }[] {
  const out = new Map<string, { feature: string; root: string | null; pieces: number }>()
  for (const s of world.sessions) {
    if (!s.contract) continue
    const had = out.get(s.contract.feature)
    if (had) {
      had.pieces++
      had.root ??= s.root
    } else out.set(s.contract.feature, { feature: s.contract.feature, root: s.root, pieces: 1 })
  }
  return [...out.values()]
}

/** The session a word names: its id or its first 8 characters, `#412` for the one working on
 *  that issue, or a contract piece's name. Null when the word names none, or more than one. */
export function sessionCalled(word: string, world: World): Session | null {
  const direct = sessionOf(world, word) ?? sessionOf(world, word.toLowerCase())
  if (direct) return direct
  const w = word.toLowerCase()
  const issue = /^#(\d+)$/.exec(w)
  const hits = world.sessions.filter((s) => (issue ? s.issue === Number(issue[1]) : s.contract?.piece.toLowerCase() === w))
  if (hits.length === 1) return hits[0]
  // Two sessions on one issue (a retry): the one still running is the one meant.
  const live = hits.filter((s) => s.live)
  return live.length === 1 ? live[0] : null
}

function projectCalled(name: string, world: World): (Project & { root: string }) | { error: string } {
  const want = name.toLowerCase()
  const exact = world.projects.find((p) => p.name.toLowerCase() === want)
  const starts = world.projects.filter((p) => p.name.toLowerCase().startsWith(want))
  const hit = exact ?? (starts.length === 1 ? starts[0] : null)
  if (!hit) {
    const known = world.projects.map((p) => p.name).join(', ')
    return { error: known ? `No project called ${name}. There are: ${known}.` : 'No project is known yet.' }
  }
  if (!hit.root) return { error: `${hit.name} has no folder the app knows, so nothing can start there.` }
  return { ...hit, root: hit.root }
}

/** The `key=value` words of a line, and the words that are not. */
function options(words: string[]): { options: DispatchOptions; rest: string[] } | { error: string } {
  const out: DispatchOptions = {}
  const rest: string[] = []
  for (const w of words) {
    const m = /^([a-z]+)=(.*)$/i.exec(w)
    if (!m) {
      rest.push(w)
      continue
    }
    const key = m[1].toLowerCase()
    if (!(OPTION_KEYS as readonly string[]).includes(key)) return { error: `No option called ${key}. There are: ${OPTION_KEYS.join(', ')}.` }
    if (!m[2]) return { error: `${key}= needs a value.` }
    if (key === 'may' && !(MAY as readonly string[]).includes(m[2].toLowerCase())) return { error: `may= is one of ${MAY.join(', ')}.` }
    out[key as keyof DispatchOptions] = key === 'may' || key === 'effort' ? m[2].toLowerCase() : m[2]
  }
  return { options: out, rest }
}

const withOptions = (o: DispatchOptions): string => {
  const said = OPTION_KEYS.filter((k) => o[k]).map((k) => `${k} ${o[k]}`)
  return said.length ? ` (${said.join(', ')})` : ''
}

function start(rest: string, world: World): Parsed {
  const m = /^(\S+)(?:\s+([\s\S]+))?$/.exec(rest)
  if (!m) return { error: 'new <project> [first prompt]: which project?' }
  const project = projectCalled(m[1], world)
  if ('error' in project) return project
  let prompt = m[2]?.trim() ?? ''
  // Only as the first word after the project: a prompt is free to hold an `=`.
  const agent = /^agent=(\S+)\s*/i.exec(prompt)
  if (agent) prompt = prompt.slice(agent[0].length)
  return {
    command: { kind: 'new', root: project.root, project: project.name, prompt: prompt || null, agent: agent?.[1] ?? null },
    says: `Start ${agent ? agent[1] : 'a session'} in ${project.name}${prompt ? `: ${prompt}` : ''}`,
    batch: false,
  }
}

function shell(rest: string, world: World): Parsed {
  if (!rest || /\s/.test(rest)) return { error: 'shell <project>: which project?' }
  const project = projectCalled(rest, world)
  if ('error' in project) return project
  return { command: { kind: 'shell', root: project.root, project: project.name }, says: `Open a shell in ${project.name}`, batch: false }
}

function dispatch(rest: string, world: World): Parsed {
  const usage = { error: 'dispatch <project> <#issue … | contract.md> [model= effort= may=]' }
  const [name, ...words] = rest.split(/[\s,]+/).filter(Boolean)
  if (!name) return usage
  const project = projectCalled(name, world)
  if ('error' in project) return project
  const read = options(words)
  if ('error' in read) return read
  if (!read.rest.length) return { error: `dispatch ${project.name}: which issues (#12 #14), or which contract file?` }
  const tail = withOptions(read.options)
  if (read.rest.every((w) => /^#?\d+$/.test(w))) {
    const issues = [...new Set(read.rest.map((w) => Number(w.replace('#', ''))))]
    return {
      command: { kind: 'dispatch', root: project.root, project: project.name, issues, options: read.options },
      says: `Dispatch ${plural(issues.length, 'child', 'children')} in ${project.name} for ${issues.map((n) => `#${n}`).join(' ')}${tail}`,
      batch: false,
    }
  }
  if (read.rest.length === 1 && !/^#?\d+$/.test(read.rest[0])) {
    return {
      command: { kind: 'contract', root: project.root, project: project.name, path: read.rest[0], options: read.options },
      says: `Dispatch the contract ${read.rest[0]} in ${project.name}${tail}`,
      batch: false,
    }
  }
  return usage
}

function message(rest: string, world: World): Parsed {
  const m = /^(\S+)(?:\s+([\s\S]+))?$/.exec(rest)
  if (!m) return { error: 'message <session | all> <words>: to whom?' }
  const text = m[2]?.trim() ?? ''
  if (m[1].toLowerCase() === 'all') {
    const crew = runningChildren(world)
    if (!crew.length) return { error: 'No child is running right now.' }
    if (!text) return { error: `message all: what should the ${plural(crew.length, 'running child', 'running children')} hear?` }
    return { command: { kind: 'message', to: 'all', text }, says: `Message ${plural(crew.length, 'running child', 'running children')}: ${names(crew)}`, batch: true }
  }
  const to = sessionCalled(m[1], world)
  if (!to) return { error: `No session called ${m[1]}. Type part of its name and take it from the list.` }
  if (!text) return { error: `message ${nameOf(to)}: what should it hear?` }
  return { command: { kind: 'message', to: to.id, text }, says: `Message ${nameOf(to)}: ${text}`, batch: false }
}

function merge(rest: string, world: World): Parsed {
  if (rest.toLowerCase() !== 'green') return { error: 'merge green: merges every open pull request whose checks are green.' }
  const green = greenPulls(world)
  if (!green.length) return { error: 'No open pull request has green checks right now.' }
  return { command: { kind: 'merge-green' }, says: `Merge ${plural(green.length, 'green pull request')}: ${green.map((p) => `#${p.number}`).join(' ')}`, batch: true }
}

function land(rest: string, world: World): Parsed {
  const known = features(world)
  const list = known.length ? `There ${known.length === 1 ? 'is' : 'are'}: ${known.map((f) => f.feature).join(', ')}.` : 'No contract is in the fleet right now.'
  if (!rest) return { error: `land <feature>: which one? ${list}` }
  const hit = known.find((f) => f.feature.toLowerCase() === rest.toLowerCase())
  if (!hit) return { error: `No feature called ${rest}. ${list}` }
  if (!hit.root) return { error: `${hit.feature} has no folder the app knows, so it cannot be landed from here.` }
  return { command: { kind: 'land', root: hit.root, feature: hit.feature }, says: `Land ${hit.feature} (${plural(hit.pieces, 'piece')} here)`, batch: false }
}

function stop(rest: string, world: World): Parsed {
  if (!rest) return { error: 'stop <session | all>: which one?' }
  if (rest.toLowerCase() === 'all') {
    const crew = runningChildren(world)
    if (!crew.length) return { error: 'No child is running right now.' }
    return { command: { kind: 'stop', sessions: crew.map((s) => s.id) }, says: `Stop ${plural(crew.length, 'running child', 'running children')}: ${names(crew)}`, batch: true }
  }
  const s = sessionCalled(rest, world)
  if (!s) return { error: `No session called ${rest}. Type part of its name and take it from the list.` }
  if (!s.live) return { error: `${nameOf(s)} is not running.` }
  return { command: { kind: 'stop', sessions: [s.id] }, says: `Stop ${nameOf(s)}`, batch: false }
}

/** The panel a word names, among those that exist: its id or its title, or the one panel either
 *  starts with the word. Null when it names none, or more than one. */
export function panelCalled(word: string): { id: PanelId; title: string } | null {
  const w = word.trim().toLowerCase()
  if (!w) return null
  const all = panels()
  const exact = all.find((p) => p.id === w || p.title.toLowerCase() === w)
  const starts = all.filter((p) => p.id.startsWith(w) || p.title.toLowerCase().startsWith(w))
  const hit = exact ?? (starts.length === 1 ? starts[0] : null)
  return hit ? { id: hit.id, title: hit.title } : null
}

function panel(rest: string): Parsed {
  const all = panels()
  const list = all.length ? `There ${all.length === 1 ? 'is' : 'are'}: ${all.map((p) => p.id).join(', ')}.` : 'This build has no panel.'
  if (!rest) return { error: `panel <name>: which one? ${list}` }
  const hit = panelCalled(rest)
  if (!hit) return { error: `No panel called ${rest}. ${list}` }
  return { command: { kind: 'panel', panel: hit.id }, says: `Open ${hit.title}`, batch: false }
}

function show(rest: string, world: World): Parsed {
  const s = rest ? sessionCalled(rest, world) : null
  // `open missions`: a word that names no session may name a panel.
  if (!s && rest && panelCalled(rest)) return panel(rest)
  if (!s) return { error: rest ? `No session called ${rest}. Type part of its name and take it from the list.` : 'go <session>: which one?' }
  return { command: { kind: 'go', session: s.id }, says: `On stage: ${nameOf(s)}`, batch: false }
}

/** Reads a line. Every name in the answer is one the world holds now; a line that cannot be
 *  run says why, and nothing is guessed. */
export function parse(line: string, world: World): Parsed {
  const m = /^(\S+)\s*([\s\S]*)$/.exec(bare(line).trim())
  if (!m) return { error: 'Type a verb (new, shell, dispatch, message, merge green, land, stop, panel), part of a session’s name, or a panel’s.' }
  const verb = verbOf(m[1])
  const rest = m[2].trim()
  if (!verb) {
    // A session named outright is put on stage: the short way to say `go`.
    const s = rest ? null : sessionCalled(m[1], world)
    if (s) return show(m[1], world)
    // A panel named outright is opened: the short way to say `panel`.
    if (!rest && panelCalled(m[1])) return panel(m[1])
    return { error: `No verb called ${m[1]}. There are: ${VERBS.map((v) => v.verb).join(', ')}.` }
  }
  switch (verb.verb) {
    case 'new':
      return start(rest, world)
    case 'shell':
      return shell(rest, world)
    case 'dispatch':
      return dispatch(rest, world)
    case 'message':
      return message(rest, world)
    case 'merge':
      return merge(rest, world)
    case 'land':
      return land(rest, world)
    case 'stop':
      return stop(rest, world)
    case 'panel':
      return panel(rest)
    default:
      return show(rest, world)
  }
}

// The live world, put together from what was read (`./input.ts`). Pure: the same input and
// the same previous world give the same world. `./engine.ts` decides when to build, and hands
// views the previous world's own objects wherever nothing changed (`./share.ts`).

import { explainErrors, type ErrorSource } from '../../mission/errors'
import type { PulseEvent } from '../../pulse/types'
import type { VaultPulse } from '../../insight/types'
import type { Account, Pending, Project, Session, World, WorldEvent } from '../types'
import type { LiveInput } from './input'
import { rosterOf } from './roster'
import { childSession, goneSession, parentSession, sumRows, type Around, type Built } from './session'

/** How many events the world keeps, oldest dropped first. */
export const EVENTS_MAX = 600

const SOURCES: readonly ErrorSource[] = ['sessions', 'children', 'prs', 'history', 'other']

const ms = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

function accountsOf(a: LiveInput['accounts']): Account[] {
  if (!a.state) return []
  return a.state.accounts.map((acc) => {
    const read = a.usage[acc.id]
    const usage = read?.usage ?? null
    return {
      id: acc.id,
      label: acc.label,
      kind: acc.kind,
      active: acc.id === a.state!.active,
      plan: usage?.plan ?? null,
      limits: (usage?.limits ?? []).map((l) => ({ kind: l.kind, group: l.group, model: l.model, percent: l.percent, severity: l.severity, resetsAt: ms(l.resetsAt), active: l.active })),
      // An old reading says why itself; one that could not be refreshed says what the read said.
      stale: usage?.stale ?? (usage && read?.error ? read.error : null),
    }
  })
}

function projectsOf(sessions: Session[], repos: LiveInput['repos']): Project[] {
  const out = new Map<string, Project>()
  for (const s of sessions) {
    if (!s.project) continue
    const p = out.get(s.project) ?? { name: s.project, root: s.root, sessions: [] }
    p.sessions.push(s.id)
    out.set(s.project, p)
  }
  const busy = [...out.values()].sort((a, b) => b.sessions.length - a.sessions.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  // A repo the app knows with no session in it is still a place to start one.
  const quiet = repos.filter((r) => !out.has(r.name)).map((r): Project => ({ name: r.name, root: r.root, sessions: [] }))
  return [...busy, ...quiet.filter((r, i) => quiet.findIndex((x) => x.name === r.name) === i)]
}

type Recent = VaultPulse['recent'][number]

/** The vault: the core's pulse, and what the app heard from mnemo while it ran, each event
 *  once. Before the core answers, the second is all there is. */
function vaultOf(vault: VaultPulse | null, pulses: PulseEvent[], sessions: Session[]): VaultPulse {
  const project = new Map<string, string | null>()
  const session = (id: string | undefined): string | null => {
    if (!id) return null
    return sessions.find((s) => s.id === id || (s.id.length < id.length && id.startsWith(s.id)))?.id ?? id
  }
  for (const s of sessions) project.set(s.id, s.project)
  const heard: Recent[] = pulses.flatMap((e) => {
    const kind = e.kind === 'learned' ? 'learned' : e.kind === 'tool' ? 'read' : e.kind === 'reflex' || e.kind === 'catchup' || e.kind === 'enrich' ? 'injected' : null
    if (!kind) return []
    const sid = session(e.session_id)
    return e.slugs.map((slug): Recent => ({ at: e.at, kind, slug, sessionId: sid, project: (sid && project.get(sid)) || e.project || null }))
  })
  const key = (r: Recent) => `${r.at}|${r.kind}|${r.slug}|${r.sessionId ?? ''}`
  const seen = new Set((vault?.recent ?? []).map(key))
  const recent = [...(vault?.recent ?? []), ...heard.filter((r) => !seen.has(key(r)) && !!seen.add(key(r)))].sort((a, b) => a.at - b.at)
  const known = new Set((vault?.learned ?? []).map((l) => l.slug))
  const learned = [
    ...(vault?.learned ?? []),
    ...pulses.filter((e) => e.kind === 'learned').flatMap((e) => e.slugs.filter((slug) => !known.has(slug) && !!known.add(slug)).map((slug) => ({ at: e.at, slug, name: slug, projects: e.project ? [e.project] : [] }))),
  ]
  return { rules: vault?.rules ?? null, prompts: vault?.prompts ?? 0, outcomes: vault?.outcomes ?? {}, learned, recent }
}

/** What happened in the fleet, oldest first: what each session's own data dates (it was
 *  dispatched, it finished, a rule reached it, its pull request merged, it asked), what the
 *  vault did, and the answers seen while the app ran, which nothing on disk dates. */
function eventsOf(sessions: Session[], pending: Pending[], vault: VaultPulse, prev: World | null, fates: LiveInput['feed']['prs'], now: number): WorldEvent[] {
  const out = new Map<string, WorldEvent>()
  const put = (e: WorldEvent) => void out.set(`${e.at}|${e.kind}|${e.session ?? ''}|${e.text}`, e)
  const here = new Set(sessions.map((s) => s.id))

  for (const s of sessions) {
    if (s.role === 'child' && s.startedAt) put({ at: s.startedAt, kind: 'dispatched', session: s.id, text: s.title })
    // Over, by its own word: one that died unfinished did not finish.
    if (s.role === 'child' && (s.state === 'ended' || s.state === 'ready') && s.lastAt) put({ at: s.lastAt, kind: 'finished', session: s.id, text: s.title })
    for (const r of s.memory.trail.injected) put({ at: r.at, kind: 'rule-injected', session: s.id, text: r.slug })
    for (const r of s.memory.trail.read) if (r.slug) put({ at: r.at, kind: 'rule-read', session: s.id, text: r.slug })
    for (const p of s.prs) {
      const merged = fates[p.url]?.mergedAt
      if (merged) put({ at: merged, kind: 'pr-merged', session: s.id, text: `#${p.number}` })
      // Nothing dates the opening itself: a session that ended opened it as it went.
      else if (!s.live && s.lastAt && p.state !== 'merged') put({ at: s.lastAt, kind: 'pr-opened', session: s.id, text: `#${p.number}` })
    }
  }
  for (const p of pending) if (p.since && p.kind !== 'merge' && p.kind !== 'stalled') put({ at: p.since, kind: 'asked', session: p.session, text: p.text })
  for (const r of vault.recent) {
    if (r.kind === 'learned') put({ at: r.at, kind: 'learned', session: null, text: r.slug })
    else if (r.sessionId && here.has(r.sessionId)) put({ at: r.at, kind: r.kind === 'injected' ? 'rule-injected' : 'rule-read', session: r.sessionId, text: r.slug })
  }
  for (const l of vault.learned) put({ at: l.at, kind: 'learned', session: null, text: l.slug })

  if (prev) {
    for (const e of prev.events) if (e.kind === 'answered' && e.session && here.has(e.session)) put(e)
    const waits = new Set(pending.map((p) => p.id))
    // A question or a permission that no longer waits, on a session that is still here, was answered.
    for (const p of prev.pending) if (!waits.has(p.id) && here.has(p.session) && (p.kind === 'question' || p.kind === 'permission' || p.kind === 'blocked')) put({ at: now, kind: 'answered', session: p.session, text: p.text })
  }
  return [...out.values()].sort((a, b) => a.at - b.at).slice(-EVENTS_MAX)
}

export function buildWorld(input: LiveInput, prev: World | null): World {
  const { now } = input
  const roster = rosterOf(input.snapshot, input.feed, now)
  const around: Around = {
    feed: input.feed,
    agents: input.agents,
    insights: input.insights,
    trails: input.trails,
    pulses: input.pulses,
    hosted: new Set(input.hosted),
    kinds: new Map((input.accounts.state?.accounts ?? []).map((a) => [a.id, a.kind])),
    now,
  }
  const built: Built[] = [...roster.parents.map((s) => parentSession(s, around)), ...roster.children.map((s) => childSession(s, around)), ...roster.gone.map((s) => goneSession(s, around))]

  // Families and totals, now that everyone is here.
  const kids = new Map<string, Session[]>()
  for (const { session: s } of built) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s])
  for (const { session: s } of built) {
    const mine = kids.get(s.id) ?? []
    if (mine.length) s.children = mine.map((c) => c.id)
    const own = s.tokens.own
    s.totals = { own, tree: mine.length ? sumRows([own, ...mine.map((c) => c.tokens.own)]) : own }
  }

  // Newest activity first; a session nothing dates goes last. Ids break a tie, so the order holds.
  const sessions = built.map((b) => b.session).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // Oldest first; one nothing dates has just begun.
  const pending = built
    .flatMap((b) => (b.pending ? [b.pending] : []))
    .sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const vault = vaultOf(input.vault, input.pulses, sessions)

  const errors = [...explainErrors(input.snapshot.errors, SOURCES).map((e) => e.text), ...input.notes, ...(input.accounts.error ? [`Accounts could not be read: ${input.accounts.error}`] : [])]

  return {
    source: 'live',
    at: now,
    sessions,
    pending,
    accounts: accountsOf(input.accounts),
    projects: projectsOf(sessions, input.repos),
    vault,
    events: eventsOf(sessions, pending, vault, prev, input.feed.prs, now),
    errors,
  }
}

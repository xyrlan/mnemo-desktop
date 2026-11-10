// A prototype capture (docs/superpowers/prototypes/redesign/DATA.md) as a `World`. The
// synthetic world is made this way from `sample.capture.json`, and a dev build can draw the
// machine's real capture the same way (scripts/world-sample.mjs).

import { choicesFor } from './pending'
import type { Account, Pending, PendingKind, PullRequest, Session, SessionState, TokenRow, World, WorldEvent } from './types'

// The capture is JSON another program wrote: it is read as loosely as it is shaped.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any

const ms = (iso: unknown): number | null => {
  if (typeof iso !== 'string' || !iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}
const at = (iso: unknown): number => ms(iso) ?? 0
const words = (w: Raw) => (w?.text ? { at: at(w.at), text: String(w.text) } : null)
const ZERO: TokenRow = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, thinking: 0 }
const row = (r: Raw): TokenRow => ({ ...ZERO, ...(r ?? {}) })

function pr(p: Raw): PullRequest {
  return { number: p.number, url: p.url, repo: p.repo ?? '', state: p.state ?? null, draft: p.draft ?? null, title: p.title ?? null, ci: p.ci ?? null, mergeable: p.mergeable ?? null }
}

function session(s: Raw): Session {
  const tokens = s.tokens ?? { main: ZERO, sidechain: ZERO, byModel: {}, subagents: [] }
  const ctx = s.context ?? { tokens: null, window: 200_000, percent: null, series: [], compactions: [] }
  const mem = s.memory ?? {}
  return {
    id: s.id,
    short: s.short,
    role: s.role,
    parent: s.parent ?? null,
    children: s.children ?? [],
    agentKind: s.agentKind ?? null,
    agent: 'claude',
    live: !!s.live,
    hosted: !!s.live && s.role === 'parent',
    state: s.state as SessionState,
    abandoned: !!s.abandoned,
    project: s.project ?? null,
    root: s.cwd ?? null,
    cwd: s.cwd ?? null,
    branch: s.branch ?? null,
    title: s.title || s.name || `session ${s.short}`,
    account: s.account ?? 'default',
    model: s.model ?? null,
    effort: s.effort ?? null,
    advisor: s.advisor ?? null,
    permissionMode: s.permissionMode ?? null,
    startedAt: ms(s.startedAt),
    lastAt: ms(s.lastAt),
    recap: words(s.recap),
    lastPrompt: s.lastPrompt ?? null,
    said: words(s.said),
    intent: s.intent ?? null,
    detail: s.detail ?? null,
    needs: s.needs ?? null,
    contract: null,
    issue: null,
    turns: s.turns ?? 0,
    turnMs: s.turnMs ?? 0,
    tokens: {
      main: row(tokens.main),
      sidechain: row(tokens.sidechain),
      byModel: Object.fromEntries(Object.entries(tokens.byModel ?? {}).map(([k, v]) => [k, row(v)])),
      subagents: (tokens.subagents ?? []).map((a: Raw) => ({ id: a.id, description: a.description ?? '', agentType: a.type ?? null, model: a.model ?? null, calls: a.calls ?? 0, tokens: row(a.tokens) })),
      own: row(s.totals?.own),
    },
    totals: { own: row(s.totals?.own), tree: row(s.totals?.tree) },
    cost: s.cost?.usd != null ? { usd: s.cost.usd, apiMs: s.cost.apiMs ?? 0, toolMs: s.cost.toolMs ?? 0, linesAdded: s.cost.linesAdded ?? 0, linesRemoved: s.cost.linesRemoved ?? 0 } : null,
    context: {
      tokens: ctx.tokens ?? null,
      window: ctx.window ?? 200_000,
      percent: ctx.percent ?? null,
      series: (ctx.series ?? []).map(([t, n]: [string, number]) => [at(t), n] as [number, number]),
      compactions: (ctx.compactions ?? []).map((c: Raw) => ({ at: at(c.at), pre: c.pre ?? 0, post: c.post ?? 0, trigger: c.trigger ?? null })),
    },
    activity: (s.activity ?? []).map((a: Raw) => ({ at: at(a.at), tool: a.tool, kind: a.kind, target: a.target ?? '', running: !!a.running, ok: a.ok ?? null, ms: a.ms ?? null })),
    activityTotal: s.activityTotal ?? 0,
    activityCounts: s.activityCounts ?? {},
    timeline: (s.timeline ?? []).map((b: Raw) => ({ t: at(b.t), kinds: b.kinds ?? {} })),
    web: {
      searches: (s.web?.searches ?? []).map((x: Raw) => ({ at: at(x.at), query: x.query ?? '', results: x.results ?? [] })),
      fetches: (s.web?.fetches ?? []).map((x: Raw) => ({ at: at(x.at), url: x.url ?? '', code: x.code ?? null, bytes: x.bytes ?? null, ms: x.ms ?? null, summary: x.summary ?? '' })),
      pages: (s.web?.pages ?? []).map((x: Raw) => ({ at: at(x.at), url: x.url ?? '', title: x.title ?? '' })),
      // A capture names a picture by its file; that path is the shot's id here.
      shots: (s.web?.shots ?? []).map((x: Raw) => ({ id: x.src, at: at(x.at), url: x.url ?? null, title: x.title ?? null, mediaType: String(x.src).endsWith('.svg') ? 'image/svg+xml' : String(x.src).endsWith('.png') ? 'image/png' : 'image/jpeg' })),
      artifacts: (s.web?.artifacts ?? []).map((x: Raw) => ({ at: at(x.at), url: x.url, title: x.title ?? '' })),
    },
    files: {
      edited: (s.files?.edited ?? []).map((f: Raw) => ({ path: f.path, edits: f.edits ?? 0, lastAt: at(f.lastAt) })),
      read: s.files?.read ?? [],
    },
    prs: (s.prs ?? []).map(pr),
    memory: {
      claude: {
        instructions: (mem.instructions ?? []).map((i: Raw) => ({ path: i.path, kind: i.type ?? '', at: at(i.at), bytes: i.bytes ?? 0 })),
        touches: (mem.claude ?? []).map((t: Raw) => ({ at: at(t.at), path: t.path, file: t.file, op: t.op, via: t.via ?? 'tool' })),
        skills: (mem.skills ?? []).map((k: Raw) => ({ at: at(k.at), name: k.name })),
      },
      trail: {
        prompts: mem.prompts ?? 0,
        injected: (mem.injected ?? []).map((r: Raw) => ({ at: at(r.at), slug: r.slug, name: null, score: r.score ?? null, judge: r.judge ?? null })),
        considered: (mem.considered ?? []).map((c: Raw) => ({ at: at(c.at), reason: c.reason ?? '', candidates: (c.candidates ?? []).map((k: Raw) => ({ slug: k.slug, name: null, score: k.score ?? 0, judge: k.judge ?? null })) })),
        read: (mem.read ?? []).map((r: Raw) => ({ at: at(r.at), tool: r.tool ?? '', slug: r.slug ?? null, topic: r.topic ?? null, query: r.query || null, hits: r.hits ?? [], ms: r.ms ?? null })),
        briefings: (mem.briefings ?? []).map((b: Raw) => ({ at: at(b.at), project: b.project ?? '', date: b.date ?? null, path: b.path ?? '', source: b.source ?? null, entries: b.entries ?? null })),
        frictions: (mem.frictions ?? []).map((f: Raw) => ({ at: at(f.at), quote: f.quote ?? '', rule: f.rule ?? '', origin: f.origin ?? null })),
      },
    },
  }
}

function events(sessions: Session[]): WorldEvent[] {
  const out: WorldEvent[] = []
  for (const s of sessions) {
    if (s.role === 'child' && s.startedAt) out.push({ at: s.startedAt, kind: 'dispatched', session: s.id, text: s.title })
    for (const r of s.memory.trail.injected) out.push({ at: r.at, kind: 'rule-injected', session: s.id, text: r.slug })
    for (const r of s.memory.trail.read) if (r.slug) out.push({ at: r.at, kind: 'rule-read', session: s.id, text: r.slug })
    for (const p of s.prs) if (s.lastAt) out.push({ at: s.lastAt, kind: p.state === 'merged' ? 'pr-merged' : 'pr-opened', session: s.id, text: `#${p.number}` })
  }
  return out.sort((a, b) => a.at - b.at).slice(-600)
}

export function fromCapture(c: Raw, source: World['source'] = 'sample'): World {
  const sessions: Session[] = (c.sessions ?? []).map(session)
  const pending: Pending[] = (c.pending ?? []).map((p: Raw) => {
    const kind = p.kind as PendingKind
    const link = p.pr ? pr(p.pr) : null
    const of = sessions.find((s) => s.id === p.session)
    return {
      id: `${p.session}:${kind}`,
      session: p.session,
      kind,
      text: p.text ?? of?.needs ?? of?.detail ?? '',
      detail: link ? `${link.repo}#${link.number}` : null,
      choices: choicesFor(kind, p.options ?? [], link),
      reply: kind !== 'merge',
      suggestedReply: p.suggestedReply ?? null,
      pr: link,
      since: ms(p.at),
    }
  })
  const accounts: Account[] = (c.accounts ?? []).map((a: Raw) => ({
    id: a.id,
    label: a.label,
    kind: a.kind ?? 'claude',
    active: !!a.active,
    plan: a.plan ?? null,
    limits: (a.limits ?? []).map((l: Raw) => ({ kind: l.kind, group: l.group, model: l.model ?? null, percent: l.percent ?? 0, severity: l.severity ?? 'normal', resetsAt: ms(l.resetsAt), active: !!l.active })),
    stale: null,
  }))
  const all = events(sessions)
  return {
    source,
    at: at(c.capturedAt),
    sessions,
    pending,
    accounts,
    projects: (c.projects ?? []).map((p: Raw) => ({ name: p.name, root: sessions.find((s) => s.project === p.name && s.role === 'parent')?.cwd ?? null, sessions: p.sessions ?? [] })),
    vault: {
      rules: c.vault?.rules ?? null,
      prompts: c.vault?.reflex?.prompts ?? 0,
      outcomes: c.vault?.reflex?.outcomes ?? {},
      learned: (c.vault?.learned ?? []).map((l: Raw) => ({ at: at(l.at), slug: l.slug, name: l.name ?? l.slug, projects: l.projects ?? [] })),
      recent: all
        .filter((e) => e.kind === 'rule-injected' || e.kind === 'rule-read')
        .map((e) => ({ at: e.at, kind: e.kind === 'rule-injected' ? ('injected' as const) : ('read' as const), slug: e.text, sessionId: e.session, project: sessions.find((s) => s.id === e.session)?.project ?? null })),
    },
    events: all,
    errors: [],
  }
}

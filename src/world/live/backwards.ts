// A world read backwards: what the core would have answered for it. Building the live world
// from that and holding it against the world it came from is how the builder's rules are
// checked against the prototypes' capture, on the synthetic world in the tests and on a real
// machine by `tools/world/compare.mjs`.

import type { Insights, Trails } from '../../insight/types'
import type { Pr, RepoGroup } from '../../mission/types'
import type { Session, World } from '../types'
import { child, insight, iso, parent, pr } from './fixtures'
import { NO_INPUT, type LiveInput } from './input'

const CI: Record<string, Pr['ci']> = { green: 'pass', red: 'fail', running: 'pending' }

/** The pull request a snapshot would give a child: the open one its world lists, else its last. */
export function prOfSession(s: Pick<Session, 'prs'>): Pr | null {
  const open = s.prs.find((p) => p.state === 'open') ?? s.prs.at(-1) ?? null
  return open ? pr({ number: open.number, url: open.url, state: (open.state ?? 'open').toUpperCase(), ci: CI[open.ci ?? ''] ?? 'none', draft: !!open.draft }) : null
}

/** What reading the world's transcripts, mnemo's logs and the accounts would answer: the
 *  insight of each session (by a child's short id, a parent's id), each trail, the vault's
 *  pulse, the accounts with their plan's windows. */
export function readingsFromWorld(world: World): Pick<LiveInput, 'insights' | 'trails' | 'vault' | 'accounts'> {
  const insights: Insights = {}
  const trails: Trails = {}
  for (const s of world.sessions) {
    const item = world.pending.find((p) => p.session === s.id) ?? null
    const asked = item?.kind === 'question' ? { id: 'toolu_asked', at: item.since ?? 0, question: item.text, options: item.choices.map((c) => ({ label: c.label, description: c.hint ?? '' })) } : null
    insights[s.role === 'child' ? s.short : s.id] = insight({
      title: s.title,
      model: s.model,
      effort: s.effort,
      permissionMode: s.permissionMode,
      branch: s.branch,
      startedAt: s.startedAt,
      lastAt: s.lastAt,
      recap: s.recap,
      lastPrompt: s.lastPrompt,
      said: s.said,
      pendingAsk: asked,
      turns: s.turns,
      turnMs: s.turnMs,
      tokens: s.tokens,
      cost: s.cost,
      context: s.context,
      activity: s.activity,
      activityTotal: s.activityTotal,
      activityCounts: s.activityCounts,
      timeline: s.timeline,
      web: s.web,
      files: s.files,
      prs: s.prs.map((p) => ({ number: p.number, url: p.url, repo: p.repo })),
      memory: s.memory.claude,
    })
    trails[s.id] = s.memory.trail
  }
  return {
    insights,
    trails,
    vault: world.vault,
    accounts: {
      state: {
        active: world.accounts.find((a) => a.active)?.id ?? 'default',
        accounts: world.accounts.map((a) => ({ id: a.id, label: a.label, configDir: `/Users/you/.claude-${a.id}`, isDefault: a.id === 'default', kind: a.kind === 'grok' ? 'grok' : 'claude', email: null, problem: null, unshared: [] })),
      },
      usage: Object.fromEntries(
        world.accounts.map((a) => [a.id, { usage: { plan: a.plan, limits: a.limits.map((l) => ({ ...l, resetsAt: l.resetsAt === null ? null : iso(l.resetsAt) })), fetchedAt: world.at, stale: a.stale }, error: null }]),
      ),
      error: null,
    },
  }
}

/** The snapshot rows a world's sessions would have been read from, by the world's own words
 *  for each (a `working` parent was `busy`, a `stalled` child's job never said it finished). */
function rowsFromWorld(world: World): RepoGroup[] {
  const groups = new Map<string, RepoGroup>()
  const group = (s: Session) => {
    const name = s.project ?? '(none)'
    let g = groups.get(name)
    if (!g) groups.set(name, (g = { root: `/Users/you/code/${name}`, name, parents: [], missions: [], children: [] }))
    return g
  }
  for (const s of world.sessions) {
    const item = world.pending.find((p) => p.session === s.id) ?? null
    if (s.role === 'parent') {
      // A parent with no process is not in a snapshot: its children name it, and that is all.
      if (!s.live) continue
      group(s).parents.push(
        parent({
          session_id: s.id,
          name: s.title,
          status: s.state === 'working' ? 'busy' : s.state === 'need' ? 'waiting' : 'idle',
          cwd: s.cwd ?? '',
          waiting_for: s.state === 'need' ? (item?.kind === 'question' ? 'input needed' : 'permission prompt') : null,
          account: s.account,
        }),
      )
      continue
    }
    group(s).children.push(
      child({
        id: s.short,
        session_id: s.id,
        name: null,
        state: s.live ? 'working' : s.state === 'stalled' ? 'failed' : 'done',
        tempo: s.state === 'need' ? 'blocked' : s.live ? 'active' : 'idle',
        needs: s.needs,
        // What `claude agents` says of a child parked on a permission prompt.
        waiting_for: item?.kind === 'permission' ? 'permission prompt' : null,
        detail: s.detail ?? '',
        cwd: s.cwd ?? '',
        live: s.live,
        updated_at: s.lastAt ? iso(s.lastAt) : null,
        intent: s.intent,
        branch: s.branch,
        parent_session: s.parent,
        model: s.model,
        effort: s.effort,
        pr: prOfSession(s),
        account: s.account,
      }),
    )
  }
  return [...groups.values()]
}

export function inputFromWorld(world: World): LiveInput {
  return { ...NO_INPUT, snapshot: { repos: rowsFromWorld(world), errors: [] }, ...readingsFromWorld(world), now: world.at }
}

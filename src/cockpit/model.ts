import type { Edge, Node } from '@xyflow/react'
import { layoutDagre, type CardData } from '../graph'
import { childWord, delta, missionSummary, type ChildSession, type Mission, type Pr, type RepoGroup } from '../mission/types'
import { fmtTokens } from '../mission/tokens'
import { linkIssues, type Issue } from '../github/types'

/** A button on a map card. */
export type MapAction =
  | { kind: 'contract'; mission: Mission }
  | { kind: 'open'; child: ChildSession }
  | { kind: 'reply'; child: ChildSession }
  | { kind: 'attach'; child: ChildSession }
  | { kind: 'pr'; pr: Pr }
  | { kind: 'job'; pr: Pr }
  | { kind: 'merge'; pr: Pr }
  | { kind: 'land'; mission: Mission }
  | { kind: 'issue'; issue: Issue }

export type MapCard = CardData & { actions: MapAction[]; word?: ReturnType<typeof childWord> }
/** `width`/`height`: the box the laid-out cards span, at 100%. */
export type MissionMap = { nodes: Node<MapCard>[]; edges: Edge[]; width: number; height: number }

type Tone = NonNullable<CardData['tone']>

const CHILD_TONE: Record<ReturnType<typeof childWord>, Tone> = { active: 'accent', BLOCKED: 'bad', stalled: 'warn', done: 'ok', stopped: 'muted' }
const CI_TONE: Record<Pr['ci'], Tone> = { pass: 'ok', fail: 'bad', pending: 'warn', none: 'muted' }
export const CI_MARK: Record<Pr['ci'], string> = { pass: '✓', fail: '✗', pending: '…', none: '–' }

/** Card box the layout reserves; cockpit.css sizes `.mm-card` to match. */
export const CARD_W = 200
export const CARD_H = 78

export const mapId = {
  mission: (m: Mission) => `mission:${m.contract_path}`,
  piece: (m: Mission, name: string) => `piece:${m.contract_path}#${name}`,
  pr: (r: RepoGroup, pr: Pr) => `pr:${r.root}#${pr.number}`,
  land: (m: Mission) => `land:${m.contract_path}`,
  issue: (r: RepoGroup, n: number) => `issue:${r.root}#${n}`,
}

/** One mission as a left-to-right DAG of action cards: contract → piece (with its child) →
 *  PR (with its CI) → land. Issues that name a piece, or whose branch or closing PR is one of
 *  the mission's, sit left of the pieces they feed. Positioned with `layoutDagre`. */
export function buildMissionMap(repo: RepoGroup, m: Mission, looked: Record<string, number>, issues: Issue[] = []): MissionMap {
  const nodes: Node<MapCard>[] = []
  const edges: Edge[] = []
  const add = (id: string, data: MapCard) => void (nodes.some((n) => n.id === id) || nodes.push({ id, type: 'action', position: { x: 0, y: 0 }, data }))
  const link = (source: string, target: string, animated = false) => {
    const id = `${source}->${target}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, ...(animated ? { animated } : {}) })
  }

  const sum = missionSummary(m)
  const head = mapId.mission(m)
  add(head, { label: `mission ${m.feature}`, sub: `${sum.withPr}/${sum.total} PR · CI ${CI_MARK[sum.ci]}`, tone: m.landable ? 'ok' : sum.ci === 'fail' ? 'bad' : 'muted', actions: [{ kind: 'contract', mission: m }] })

  const land = mapId.land(m)
  const prIds: string[] = []
  for (const p of m.pieces) {
    const id = mapId.piece(m, p.name)
    const c = p.child
    if (c) {
      const word = childWord(c)
      const d = delta(c, looked)
      const actions: MapAction[] = word === 'BLOCKED' ? [{ kind: 'reply', child: c }, { kind: 'attach', child: c }] : c.live ? [{ kind: 'attach', child: c }, { kind: 'open', child: c }] : [{ kind: 'open', child: c }]
      add(id, {
        label: p.name,
        sub: word === 'BLOCKED' ? (c.needs ?? 'blocked') : c.detail || word,
        badge: [word === 'BLOCKED' ? 'BLOCKED' : '', d > 0 ? `+${d}` : '', c.tokens > 0 ? fmtTokens(c.tokens) : ''].filter(Boolean).join(' · ') || undefined,
        tone: CHILD_TONE[word],
        word,
        actions,
      })
      link(head, id, word === 'active')
    } else {
      add(id, { label: p.name, sub: p.pr ? 'no child' : 'no child, no PR', tone: 'muted', actions: [] })
      link(head, id)
    }
    if (!p.pr) continue
    const pr = p.pr
    const prId = mapId.pr(repo, pr)
    // Only an open PR's CI is news; a merged or closed one keeps its last rollup as history.
    const open = pr.state === 'OPEN'
    const ready = open && pr.ci === 'pass' && !m.landable
    add(prId, {
      label: `PR #${pr.number}`,
      sub: `${pr.state.toLowerCase()}${open && pr.draft ? ' draft' : ''} · CI ${CI_MARK[pr.ci]}${pr.ci === 'none' ? '' : ` ${pr.ci}`}`,
      tone: open ? CI_TONE[pr.ci] : pr.state === 'MERGED' ? 'ok' : 'muted',
      actions: [{ kind: 'pr', pr }, ...(open && pr.ci === 'fail' ? [{ kind: 'job', pr } as const] : ready ? [{ kind: 'merge', pr } as const] : [])],
    })
    link(id, prId)
    prIds.push(prId)
  }

  add(land, { label: 'land', sub: m.landable ? 'ready: every PR green' : `not yet · ${sum.withPr}/${sum.total} PR`, tone: m.landable ? 'ok' : 'muted', actions: m.landable ? [{ kind: 'land', mission: m }] : [] })
  if (prIds.length) for (const id of prIds) link(id, land)
  else link(head, land)

  const links = linkIssues({ ...repo, missions: [m], children: [] }, issues)
  for (const i of issues) {
    const l = links.get(i.number)
    if (!l?.pieces.length && !l?.prs.length) continue
    const id = mapId.issue(repo, i.number)
    add(id, { label: `#${i.number} ${i.title}`, sub: i.labels.join(', ') || 'issue', tone: 'accent', actions: [{ kind: 'issue', issue: i }] })
    for (const { piece } of l.pieces) link(id, mapId.piece(m, piece.name))
    for (const pr of l.prs) if (!l.pieces.some((x) => x.piece.pr?.number === pr.number)) link(id, mapId.pr(repo, pr))
  }

  const laid = layoutDagre(nodes, edges, { width: CARD_W, height: CARD_H, gap: 24 })
  const span = (at: (n: Node) => number, size: number) => (laid.length ? Math.max(...laid.map(at)) - Math.min(...laid.map(at)) + size : 0)
  return { nodes: laid, edges, width: span((n) => n.position.x, CARD_W), height: span((n) => n.position.y, CARD_H) }
}

import type { Edge, Node } from '@xyflow/react'
import type { CardData } from '../graph'
import { childWord, delta, missionSummary, type ChildSession, type Mission, type ParentSession, type Pr, type RepoGroup, type Snapshot } from '../mission/types'
import { fmtTokens, parentTokens } from '../mission/tokens'
import { issueOfBranch, linkIssues, linkWord, shownIssues, type Issue } from '../github/types'

/** What a click on a node acts on. Repo and parent nodes have none. */
export type Target =
  | { kind: 'child'; child: ChildSession }
  | { kind: 'pr'; pr: Pr }
  | { kind: 'mission'; mission: Mission }
  | { kind: 'issue'; issue: Issue; root: string }

/** Open issues per repo root and the label filter per root (settings `issueLabels`). */
export type IssueInput = { issues: Record<string, Issue[]>; labels: Record<string, string[]> }

export type CockpitGraph = { nodes: Node[]; edges: Edge[]; targets: Record<string, Target> }

type Tone = NonNullable<CardData['tone']>

const CHILD_TONE: Record<ReturnType<typeof childWord>, Tone> = { active: 'accent', BLOCKED: 'bad', stalled: 'warn', done: 'ok', stopped: 'muted' }
const CI_TONE: Record<Pr['ci'], Tone> = { pass: 'ok', fail: 'bad', pending: 'warn', none: 'muted' }
const CI_MARK: Record<Pr['ci'], string> = { pass: '✓', fail: '✗', pending: '…', none: '–' }

export const nodeId = {
  repo: (r: RepoGroup) => `repo:${r.root}`,
  parent: (p: ParentSession) => `parent:${p.session_id}`,
  group: (m: Mission) => `group:${m.contract_path}`,
  mission: (m: Mission) => `mission:${m.contract_path}`,
  piece: (m: Mission, name: string) => `piece:${m.contract_path}#${name}`,
  child: (c: ChildSession) => `child:${c.id}`,
  pr: (r: RepoGroup, pr: Pr) => `pr:${r.root}#${pr.number}`,
  ci: (r: RepoGroup, pr: Pr) => `ci:${r.root}#${pr.number}`,
  issue: (r: RepoGroup, n: number) => `issue:${r.root}#${n}`,
}

const origin = { x: 0, y: 0 }

/** The cockpit canvas as a DAG: repo → parent → children, a mission's pieces inside a group
 *  headed by the mission node, child → PR → CI. Children hang off the parent that dispatched
 *  them when the snapshot says so, else off the repo. Issues (`github`) are roots: every one
 *  with a child or PR, linked to it, plus the most recent that pass the label filter. A child
 *  on an issue's branch hangs off the issue instead of the repo. Positions are left to the layout. */
export function buildGraph(snap: Snapshot, looked: Record<string, number>, focusedRoot?: string, github?: IssueInput): CockpitGraph {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const targets: Record<string, Target> = {}
  const seen = new Set<string>()

  const add = (id: string, data: CardData, parentId?: string): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    nodes.push({ id, type: 'card', position: origin, data, ...(parentId ? { parentId } : {}) })
    return true
  }
  const link = (source: string, target: string, animated = false) => {
    const id = `${source}->${target}`
    if (!edges.some((e) => e.id === id)) edges.push({ id, source, target, ...(animated ? { animated } : {}) })
  }

  for (const r of snap.repos) {
    const repoId = nodeId.repo(r)
    const live = r.children.filter((c) => c.live).length + r.missions.flatMap((m) => m.pieces).filter((p) => p.child?.live).length
    add(repoId, {
      label: r.name,
      sub: `${live} live · ${r.parents.length} parent${r.parents.length === 1 ? '' : 's'}`,
      tone: r.root === focusedRoot ? 'accent' : 'muted',
    })

    const parentIds = new Map<string, string>()
    for (const p of r.parents) {
      const id = nodeId.parent(p)
      const t = parentTokens(p)
      parentIds.set(p.session_id, id)
      add(id, {
        label: p.name ?? 'parent',
        sub: [p.status, p.session_id.slice(0, 8), t.children ? `children ${fmtTokens(t.children)}` : ''].filter(Boolean).join(' · '),
        badge: t.tokens ? fmtTokens(t.tokens) : undefined,
        tone: p.status === 'busy' ? 'accent' : p.status === 'waiting' ? 'warn' : 'muted',
      })
      link(repoId, id)
    }
    const upstream = (c: ChildSession | null | undefined) => (c?.parent_session && parentIds.get(c.parent_session)) || undefined

    const addChild = (c: ChildSession, label: string | undefined, groupId?: string): string => {
      const id = nodeId.child(c)
      const word = childWord(c)
      const d = delta(c, looked)
      if (add(id, {
        label: label ?? c.name ?? c.intent ?? c.id,
        sub: word === 'BLOCKED' ? (c.needs ?? 'blocked') : c.detail || c.branch || word,
        badge: [d > 0 ? `+${d}` : '', c.tokens > 0 ? fmtTokens(c.tokens) : ''].filter(Boolean).join(' · ') || undefined,
        tone: CHILD_TONE[word],
        pulse: word === 'BLOCKED',
      }, groupId)) targets[id] = { kind: 'child', child: c }
      return id
    }

    const addPr = (from: string, pr: Pr, groupId?: string) => {
      const id = nodeId.pr(r, pr)
      if (add(id, { label: `PR #${pr.number}`, sub: [pr.state.toLowerCase(), pr.head].filter(Boolean).join(' · '), tone: CI_TONE[pr.ci] }, groupId)) targets[id] = { kind: 'pr', pr }
      link(from, id)
      if (pr.ci === 'none') return
      const ci = nodeId.ci(r, pr)
      if (add(ci, { label: 'CI', sub: pr.ci, tone: CI_TONE[pr.ci], badge: CI_MARK[pr.ci] }, groupId)) targets[ci] = { kind: 'pr', pr }
      link(id, ci)
    }

    for (const m of r.missions) {
      const groupId = nodeId.group(m)
      const headId = nodeId.mission(m)
      const sum = missionSummary(m)
      // Pushed before its members: React Flow wants a group ahead of its children.
      nodes.push({ id: groupId, type: 'group', position: origin, data: {}, selectable: false, className: 'ck-group' })
      add(headId, {
        label: `mission ${m.feature}`,
        sub: `${sum.withPr}/${sum.total} PR · CI ${CI_MARK[sum.ci]} · land: ${m.landable ? 'ready' : 'not yet'}`,
        tone: m.landable ? 'ok' : sum.ci === 'fail' ? 'bad' : 'muted',
      }, groupId)
      targets[headId] = { kind: 'mission', mission: m }
      const dispatcher = m.pieces.map((p) => upstream(p.child)).find(Boolean)
      link(dispatcher ?? repoId, headId)

      for (const p of m.pieces) {
        let tail = headId
        if (p.child) {
          tail = addChild(p.child, p.name, groupId)
          link(headId, tail, childWord(p.child) === 'active')
        } else if (!p.pr) {
          const id = nodeId.piece(m, p.name)
          add(id, { label: p.name, sub: 'no child, no PR', tone: 'muted' }, groupId)
          link(headId, id)
        }
        if (p.pr) addPr(tail, p.pr, groupId)
      }
    }

    const issues = github?.issues[r.root] ?? []
    const links = linkIssues(r, issues)
    const shown = shownIssues(issues, links, github?.labels[r.root] ?? [])
    const issueIds = new Set(shown.map((i) => i.number))
    for (const i of shown) {
      const id = nodeId.issue(r, i.number)
      add(id, {
        label: `#${i.number} ${i.title}`,
        sub: [i.labels.join(', '), i.assignees.map((a) => `@${a}`).join(' '), i.milestone ?? ''].filter(Boolean).join(' · ') || 'open issue',
        badge: linkWord(links.get(i.number)) ?? undefined,
        tone: links.has(i.number) ? 'accent' : 'muted',
      })
      targets[id] = { kind: 'issue', issue: i, root: r.root }
    }
    // Edges from issues go in after every node exists, so a target is linked only when drawn.
    const fromIssues: [string, string, boolean][] = []

    for (const c of r.children) {
      const id = addChild(c, undefined)
      const n = issueOfBranch(c.branch)
      const issue = n !== null && issueIds.has(n) ? nodeId.issue(r, n) : undefined
      link(upstream(c) ?? issue ?? repoId, id, childWord(c) === 'active')
      if (issue && upstream(c)) fromIssues.push([issue, id, childWord(c) === 'active'])
    }

    for (const i of shown) {
      const l = links.get(i.number)
      if (!l) continue
      const from = nodeId.issue(r, i.number)
      for (const { mission, piece } of l.pieces) {
        const to = piece.child ? nodeId.child(piece.child) : piece.pr ? nodeId.pr(r, piece.pr) : nodeId.piece(mission, piece.name)
        fromIssues.push([from, to, !!piece.child && childWord(piece.child) === 'active'])
      }
      for (const pr of l.prs) {
        const withChild = l.pieces.some((p) => p.piece.pr?.number === pr.number && p.piece.child)
        if (!withChild) fromIssues.push([from, nodeId.pr(r, pr), false])
      }
    }
    for (const [from, to, animated] of fromIssues) if (seen.has(to)) link(from, to, animated)
  }
  return { nodes, edges, targets }
}

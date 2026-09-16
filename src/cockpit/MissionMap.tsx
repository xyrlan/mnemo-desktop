import { createContext, useContext, useMemo, useState } from 'react'
import { Background, Handle, Position, ReactFlow, type NodeProps, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../graph/graph.css'
import { useMission } from '../mission/app-store'
import { useGithub } from '../github/app-store'
import { attachChild, openContract, openMissionPane, openPr, ReplyBox } from '../mission/rows'
import { openIssue } from '../github/actions'
import { allChildren, type Mission, type RepoGroup } from '../mission/types'
import { buildMissionMap, type MapAction, type MapCard } from './model'
import { landMission, mergePr, openJob, useArm } from './actions'
import Avatar from '../avatar/Avatar'

const WORD: Record<MapAction['kind'], string> = { contract: 'contract', open: 'open', reply: 'reply', attach: 'attach', pr: 'PR', job: 'abrir job', merge: 'merge', land: 'land', issue: 'GitHub' }
const CONFIRM: Partial<Record<MapAction['kind'], string>> = { merge: 'confirm merge?', land: 'confirm land?' }

const actionKey = (a: MapAction) =>
  a.kind === 'pr' || a.kind === 'job' || a.kind === 'merge' ? `${a.kind}:${a.pr.number}` : a.kind === 'contract' || a.kind === 'land' ? `${a.kind}:${a.mission.contract_path}` : a.kind === 'issue' ? `issue:${a.issue.number}` : `${a.kind}:${a.child.id}`

/** Runs a card button; the map provides it so cards stay plain node components. */
const Run = createContext<{ run: (a: MapAction) => void; armed: string | null }>({ run: () => {}, armed: null })

function ActionCard({ data }: NodeProps<Node<MapCard, 'action'>>) {
  const { run, armed } = useContext(Run)
  const tone = data.tone ?? 'muted'
  return (
    <div className={`gr-card mm-card gr-${tone}${data.pulse ? ' gr-pulse' : ''}`}>
      <Handle type="target" position={Position.Left} className="gr-handle" />
      <div className="gr-label" title={data.label}>
        <span className="mm-label">{data.label}</span>
        {data.badge && <span className="gr-badge">{data.badge}</span>}
      </div>
      {data.word && (
        <span className="mm-avatar">
          <Avatar state={data.word} size={30} />
        </span>
      )}
      {data.sub && (
        <div className="gr-sub" title={data.sub}>
          {data.sub}
        </div>
      )}
      {data.actions.length > 0 && (
        <div className="mm-actions nodrag nopan">
          {data.actions.map((a) => {
            const key = actionKey(a)
            return (
              <button
                key={key}
                className={`mm-act mm-act-${a.kind}${armed === key ? ' mm-armed' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  run(a)
                }}
              >
                {armed === key ? CONFIRM[a.kind] : WORD[a.kind]}
              </button>
            )
          })}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="gr-handle" />
    </div>
  )
}

const nodeTypes = { action: ActionCard }

/** Viewport offset of the cards inside the canvas, on every side. */
const PAD = 16

/** One mission as React Flow at 100%: no fit-to-view shrink. The map asks for the width its
 *  layout spans (`--mm-w`); the cockpit gives it that much where the pane allows, and the rest
 *  pans. The reply box of the child whose `reply` was pressed opens under the canvas. */
export default function MissionMap({ repo, mission, onClose }: { repo: RepoGroup; mission: Mission; onClose: () => void }) {
  const looked = useMission((s) => s.looked)
  const issues = useGithub((s) => s.issues[repo.root]?.list)
  const map = useMemo(() => buildMissionMap(repo, mission, looked, issues), [repo, mission, looked, issues])
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const replying = useMission((s) => (replyTo ? allChildren(s.snapshot).find((c) => c.id === replyTo) : undefined))
  const { armed, fire } = useArm()

  const run = (a: MapAction) => {
    if (CONFIRM[a.kind] && !fire(actionKey(a))) return
    switch (a.kind) {
      case 'contract':
        return openContract(a.mission)
      case 'open':
        return openMissionPane(a.child)
      case 'reply':
        return setReplyTo(a.child.id)
      case 'attach':
        return attachChild(a.child.id)
      case 'pr':
        return openPr(a.pr)
      case 'job':
        return openJob(a.pr)
      case 'merge':
        return mergePr(repo.root, a.pr)
      case 'land':
        return landMission(repo.root, a.mission)
      case 'issue':
        return openIssue(a.issue)
    }
  }

  return (
    <div className="mm" style={{ '--mm-w': `${map.width + 2 * PAD}px` } as React.CSSProperties}>
      <div className="mm-head">
        <span className="ck-title">mission {mission.feature}</span>
        <span className="ck-quiet">{repo.name}</span>
        <span className="ck-spacer" />
        <button className="ck-close" onClick={onClose} title="Close the map (Esc)">
          ×
        </button>
      </div>
      <div className="mm-canvas">
        <Run.Provider value={{ run, armed }}>
          <div className="gr-canvas">
            <ReactFlow
              key={mission.contract_path}
              nodes={map.nodes}
              edges={map.edges}
              nodeTypes={nodeTypes}
              defaultViewport={{ x: PAD, y: PAD, zoom: 1 }}
              minZoom={0.5}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnScroll
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} color="var(--border)" />
            </ReactFlow>
          </div>
        </Run.Provider>
      </div>
      {replying && (
        <div className="mm-reply">
          <div className="mm-reply-head">
            <span>reply to {mission.pieces.find((p) => p.child?.id === replying.id)?.name ?? replying.id}</span>
            <button className="ck-close" onClick={() => setReplyTo(null)} title="Close">
              ×
            </button>
          </div>
          <ReplyBox c={replying} rows={3} />
        </div>
      )}
    </div>
  )
}

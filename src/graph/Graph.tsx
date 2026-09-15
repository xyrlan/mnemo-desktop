import { useMemo } from 'react'
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './graph.css'

/** What a `card` node shows. `tone` colours the border, `pulse` animates it (BLOCKED). */
export type CardData = {
  label: string
  sub?: string
  badge?: string
  tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'accent'
  pulse?: boolean
  [key: string]: unknown
}
export type CardNode = Node<CardData, 'card'>

function Card({ data, selected }: NodeProps<CardNode>) {
  const tone = data.tone ?? 'muted'
  return (
    <div className={`gr-card gr-${tone}${data.pulse ? ' gr-pulse' : ''}${selected ? ' gr-selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="gr-handle" />
      <div className="gr-label">
        {data.label}
        {data.badge && <span className="gr-badge">{data.badge}</span>}
      </div>
      {data.sub && <div className="gr-sub">{data.sub}</div>}
      <Handle type="source" position={Position.Right} className="gr-handle" />
    </div>
  )
}

const nodeTypes = { card: Card }

export type GraphProps = {
  nodes: Node[]
  edges: Edge[]
  onNodeClick?: (id: string) => void
  onNodeDoubleClick?: (id: string) => void
  /** Re-fit the viewport when this changes (e.g. the set of node ids). */
  fitKey?: string
}

/** Themed React Flow canvas with the `card` node type. Layout is the caller's job
 *  (see `layoutDagre`); this only renders and reports clicks. */
export default function Graph({ nodes, edges, onNodeClick, onNodeDoubleClick, fitKey }: GraphProps) {
  const key = useMemo(() => fitKey ?? nodes.map((n) => n.id).join(','), [fitKey, nodes])
  return (
    <div className="gr-canvas">
      <ReactFlow
        key={key}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => onNodeClick?.(n.id)}
        onNodeDoubleClick={(_, n) => onNodeDoubleClick?.(n.id)}
      >
        <Background gap={24} size={1} color="var(--border)" />
      </ReactFlow>
    </div>
  )
}

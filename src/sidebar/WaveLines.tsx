import React from 'react'
import { cn } from '@/ui/cn'
import { AgentStateDot } from './agent-glyphs'
import { openWave, type DispatchRoutes, type WaveLine } from './dispatch'
import { waveSummary } from './model'
import { missionStore } from './upstream'

const stopBubble = (e: React.SyntheticEvent) => e.stopPropagation()

function WaveRow({ line, parent, routes }: { line: WaveLine; parent: string; routes: DispatchRoutes }) {
  const { state, text } = waveSummary(line)
  const open = () => openWave(routes, missionStore.getState().snapshot, line.feature, parent)
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={false}
      className={cn(
        'min-w-0 overflow-hidden cursor-pointer rounded-sm px-1 text-[11px] leading-none',
        'text-muted-foreground worktree-agent-row-hover',
        'flex h-6 items-center gap-1',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring',
      )}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        e.stopPropagation()
        open()
      }}
      data-wave-line={line.feature}
      aria-label={`Wave ${line.feature}: ${text}. Open in Dispatch`}
    >
      <AgentStateDot state={state} tooltipSide="right" />
      <span className="min-w-0 flex-1 truncate" title={`${line.feature} · ${text}`}>
        <span className="text-muted-foreground/90">{line.feature}</span>
        <span className={state === 'permission' ? 'text-foreground/80' : 'text-muted-foreground/65'}> · {text}</span>
      </span>
    </div>
  )
}

/** The waves a workspace dispatched, one line each under its card. A click opens its Dispatch tab
 *  on that wave; the card's own click (show the workspace) does not fire with it. */
export function WaveLines({ parent, routes, className }: { parent: string; routes: DispatchRoutes; className?: string }): React.JSX.Element | null {
  const lines = routes.useWaveLines(parent)
  if (lines.length === 0) return null
  return (
    <div
      className={cn('flex flex-col gap-0.5', className)}
      onClick={stopBubble}
      onDoubleClick={stopBubble}
      onMouseDown={stopBubble}
      onPointerDown={stopBubble}
      role="group"
      aria-label="Waves"
      data-wave-lines=""
    >
      {lines.map((l) => (
        <WaveRow key={l.feature} line={l} parent={parent} routes={routes} />
      ))}
    </div>
  )
}

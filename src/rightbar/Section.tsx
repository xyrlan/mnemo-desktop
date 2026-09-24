// adapted from stablyai/orca components/right-sidebar/local-port-section.tsx
import type React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/ui/cn'

/** A sticky, collapsible group of the panel with its count. With no rows it shows `emptyText`,
 *  or nothing when there is none to say. */
export function Section({
  id,
  title,
  count,
  emptyText,
  counted = true,
  collapsed,
  onToggle,
  children,
}: {
  id: string
  title: string
  count: number
  emptyText?: string
  /** Show the count beside the title; off for a section that holds one thing. */
  counted?: boolean
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element | null {
  if (count === 0 && !emptyText) return null
  return (
    <div className="px-3 pt-2" data-section={id}>
      <button
        type="button"
        className="sticky top-0 z-10 mb-1 flex w-full items-center gap-1 border-b border-border/40 bg-sidebar py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`memory-section-${id}`}
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', !collapsed && 'rotate-90')} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        {counted && count > 0 && <span className="ml-1 text-[10px] text-muted-foreground/60">{count}</span>}
      </button>
      {!collapsed && (
        <div id={`memory-section-${id}`}>
          {count > 0 ? children : emptyText && <div className="py-1 text-xs text-muted-foreground">{emptyText}</div>}
        </div>
      )}
    </div>
  )
}

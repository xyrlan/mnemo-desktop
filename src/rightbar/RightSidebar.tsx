// adapted from stablyai/orca components/right-sidebar/index.tsx, right-sidebar-top-activity-bar.tsx and activity-bar-buttons.tsx
import React, { useCallback, useEffect, useState } from 'react'
import { PanelRight } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { useShell } from '../shell/store'
import { RIGHT_SIDEBAR_MIN_WIDTH, clampRightSidebarPanelWidth } from './width'

/** One tab of the activity bar and the panel it shows. */
export type ActivityItem = {
  id: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  shortcut?: string
  panel: React.ComponentType
}

const itemLabel = (item: ActivityItem) => (item.shortcut ? `${item.title} (${item.shortcut})` : item.title)

function ActivityBarButton({ item, active, onClick }: { item: ActivityItem; active: boolean; onClick: () => void }): React.JSX.Element {
  const Icon = item.icon
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex h-[36px] w-9 shrink-0 items-center justify-center transition-colors',
            active ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground',
          )}
          onClick={onClick}
          role="tab"
          aria-label={itemLabel(item)}
          aria-selected={active}
        >
          <Icon size={16} />
          {active && <div className="absolute right-[25%] bottom-0 left-[25%] h-[2px] rounded-t bg-foreground" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {itemLabel(item)}
      </TooltipContent>
    </Tooltip>
  )
}

function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth)
  useEffect(() => {
    const on = () => setW(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return w
}

/** Drag the left edge: the sidebar grows as the pointer moves left, within Orca's clamps. */
function useResize(width: number, setWidth: (px: number) => void) {
  return useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      const startX = e.clientX
      const body = document.body.style
      const was = { cursor: body.cursor, userSelect: body.userSelect }
      body.cursor = 'col-resize'
      body.userSelect = 'none'
      const move = (m: MouseEvent) => setWidth(clampRightSidebarPanelWidth(width - (m.clientX - startX), window.innerWidth, 0))
      const up = () => {
        body.cursor = was.cursor
        body.userSelect = was.userSelect
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [width, setWidth],
  )
}

/** Orca's right sidebar: a 36px activity bar with the close button, the active tab's panel, and
 *  a resize strip on the left edge. Draws nothing while the shell has it closed. */
export function RightSidebar({ items }: { items: ActivityItem[] }): React.JSX.Element | null {
  const open = useShell((s) => s.rightOpen)
  const width = useShell((s) => s.rightWidth)
  const setWidth = useShell((s) => s.setRightWidth)
  const toggle = useShell((s) => s.toggleRight)
  const windowWidth = useWindowWidth()
  const [tab, setTab] = useState(items[0]?.id)
  const rendered = clampRightSidebarPanelWidth(width, windowWidth, 0)
  const onResizeStart = useResize(rendered, setWidth)

  if (!open) return null
  const active = items.find((i) => i.id === tab) ?? items[0]
  const Panel = active?.panel

  return (
    <TooltipProvider delayDuration={400}>
      <div className="relative flex h-full shrink-0 flex-row overflow-visible" style={{ width: rendered, minWidth: RIGHT_SIDEBAR_MIN_WIDTH }} data-right-sidebar data-ui>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div className="flex h-[36px] min-h-[36px] items-center overflow-hidden border-b border-border" data-tauri-drag-region>
            <div className="flex min-w-0 flex-1 items-center overflow-hidden pl-2" data-tauri-drag-region role="tablist" aria-label="Right sidebar">
              {items.map((item) => (
                <ActivityBarButton key={item.id} item={item} active={item.id === active?.id} onClick={() => setTab(item.id)} />
              ))}
            </div>
            <div className="flex shrink-0 items-center pr-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" className="mr-1 size-7 text-muted-foreground hover:text-foreground" onClick={toggle} aria-label="Toggle right sidebar">
                    <PanelRight size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  Toggle right sidebar (⌘L)
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{Panel && <Panel />}</div>
          <div
            className="absolute top-0 left-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-ring/20 active:bg-ring/30"
            onMouseDown={onResizeStart}
            aria-hidden
            data-resize-handle
          />
        </div>
      </div>
    </TooltipProvider>
  )
}

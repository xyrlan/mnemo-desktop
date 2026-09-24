// adapted from stablyai/orca components/sidebar/index.tsx [34-41, 152-246] (MIT, 122b8c25)
import React from 'react'
import { TooltipProvider } from '@/ui'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNav } from './SidebarNav'
import { useShell } from './upstream'
import { WorktreeList } from './WorktreeList'
import './sidebar.css'

/** The left sidebar's content: nav, the projects header, and every repo's worktree cards. The
 *  shell owns its frame — width, resize seam and collapse — and draws it into the `left-sidebar`
 *  slot; while collapsed there is nothing to draw. */
export default function LeftSidebar(): React.JSX.Element | null {
  const open = useShell((s) => s.leftOpen)
  if (!open) return null
  return (
    <TooltipProvider delayDuration={400}>
      <div
        data-left-sidebar=""
        className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-worktree-sidebar font-sans text-foreground scrollbar-sleek-parent"
      >
        <SidebarNav />
        <SidebarHeader />
        <WorktreeList />
      </div>
    </TooltipProvider>
  )
}

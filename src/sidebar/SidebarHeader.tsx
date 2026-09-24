// adapted from stablyai/orca components/sidebar/SidebarHeader.tsx [48-94, 124-134] and
// components/sidebar/sidebar-header-actions.tsx (MIT, 122b8c25)
import React, { useState } from 'react'
import { FolderPlus, Loader2, Plus, X } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@/ui'
import { addProject } from './actions'
import { run } from './upstream'

function HeaderAction({ label, shortcut, children, ...props }: React.ComponentProps<typeof Button> & { label: string; shortcut?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" type="button" className="text-muted-foreground" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
        {shortcut ? <span className="ml-1.5 text-background/60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  )
}

/** "Projects", with Add project (Home's folder picker) and New workspace (`workspace.new`). A
 *  folder that could not be added says why under the row, until dismissed. */
export const SidebarHeader = React.memo(function SidebarHeader() {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async () => {
    setAdding(true)
    setError(null)
    try {
      setError(await addProject())
    } catch (e) {
      setError(String(e))
    } finally {
      setAdding(false)
    }
  }
  return (
    <>
      <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate select-none pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80" data-sidebar-section-title="projects">
            Projects
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1" data-sidebar-header-actions="">
          <HeaderAction label="Add project" onClick={() => void add()} disabled={adding}>
            {adding ? <Loader2 className="size-3.5 animate-spin" /> : <FolderPlus className="size-3.5" strokeWidth={2.25} />}
          </HeaderAction>
          <HeaderAction label="New workspace" shortcut="⌘N" onClick={() => run('workspace.new')}>
            <Plus className="size-3.5" strokeWidth={2.25} />
          </HeaderAction>
        </div>
      </div>
      {error && (
        <div role="alert" className="mx-2 mb-1 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] leading-snug text-destructive">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0 rounded-sm opacity-70 hover:opacity-100" onClick={() => setError(null)}>
            <X className="size-3" />
          </button>
        </div>
      )}
    </>
  )
})

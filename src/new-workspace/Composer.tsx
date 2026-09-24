// adapted from stablyai/orca src/renderer/src/components/NewWorkspaceComposerModal.tsx, NewWorkspaceComposerCard.tsx and new-workspace/NewWorkspaceComposer{Project,Name,Agent,Footer}Section.tsx (MIT, 122b8c25)
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, CircleDot, CornerDownLeft, FolderPlus, GitBranch, LoaderCircle, Send, TerminalSquare } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, SwitchIndicator, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import ProjectCombobox from './ProjectCombobox'
import { claudeCommand, defaultName, nameForIssue, treePath, workspaceName, type CreateInput } from './create'
import type { ProjectOption } from './match'
import { closeNewWorkspace, useComposer, type ComposerRequest } from './open'

export type ComposerProps = {
  projects: readonly ProjectOption[]
  /** The project preselected when the request names none: the one on screen, say. */
  defaultProject: string | null
  skipPermissions: boolean
  onSkipPermissionsChange(v: boolean): void
  /** The saved setup command of a repo, '' for none. */
  setupFor(root: string): string
  /** Makes the workspace; rejects with what to tell the user. */
  onCreate(input: CreateInput): Promise<unknown>
  /** `mnemo dispatch` for the issue, headless. */
  onDispatch(root: string, issue: number): void
  /** Registers a folder as a project; resolves to its root, or null when cancelled. */
  onAddProject?(): Promise<string | null>
  /** ⌘ on a Mac, Ctrl elsewhere. */
  modLabel?: string
}

const LABEL = 'text-xs font-medium text-muted-foreground'
const FIELD =
  'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30'

/** The new-workspace composer (Mod+N): project, name and base; Create makes the worktree,
 *  switches to it and starts `claude` there; opened from an issue it also offers Dispatch. */
export default function Composer(props: ComposerProps): React.JSX.Element | null {
  const request = useComposer((s) => s.request)
  const seq = useComposer((s) => s.seq)
  if (!request) return null
  // Keyed by `seq`: a second open starts the form over.
  return <ComposerDialog key={seq} request={request} {...props} />
}

function ComposerDialog({
  request,
  projects,
  defaultProject,
  skipPermissions,
  onSkipPermissionsChange,
  setupFor,
  onCreate,
  onDispatch,
  onAddProject,
  modLabel = '⌘',
}: ComposerProps & { request: ComposerRequest }): React.JSX.Element {
  const initialProject = request.repo ?? defaultProject ?? projects[0]?.id ?? null
  const [project, setProject] = useState<string | null>(initialProject)
  const [name, setName] = useState(request.issue ? nameForIssue(request.issue) : '')
  const [base, setBase] = useState('')
  const [setup, setSetup] = useState(() => (initialProject ? setupFor(initialProject) : ''))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const projectDescriptionId = useId()

  const selected = projects.find((p) => p.id === project) ?? null
  const fallbackName = defaultName(selected?.taken ?? [])
  const effectiveName = name.trim() ? workspaceName(name) : fallbackName
  const nameInvalid = name.trim() !== '' && effectiveName === ''
  // A project just added, before the fleet lists it: wait for it rather than call it an error.
  const projectPending = project !== null && !selected
  const createDisabled = creating || !selected || nameInvalid

  const pickProject = useCallback(
    (root: string) => {
      setProject(root)
      setSetup(setupFor(root))
      setCreateError(null)
    },
    [setupFor],
  )

  const handleCreate = useCallback(async () => {
    if (createDisabled || !selected) return
    setCreating(true)
    setCreateError(null)
    try {
      await onCreate({ repo: selected.id, name: effectiveName, base, setup, skipPermissions, issue: request.issue })
      closeNewWorkspace()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
      setCreating(false)
    }
  }, [base, createDisabled, effectiveName, onCreate, request.issue, selected, setup, skipPermissions])

  const handleDispatch = useCallback(() => {
    if (!selected || !request.issue) return
    onDispatch(selected.id, request.issue.number)
    closeNewWorkspace()
  }, [onDispatch, request.issue, selected])

  const handleAddProject = useCallback(async () => {
    if (!onAddProject) return
    try {
      const root = await onAddProject()
      if (root) pickProject(root)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
    }
  }, [onAddProject, pickProject])

  // ⌘↵ / Ctrl+↵ creates from anywhere in the dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      void handleCreate()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [handleCreate])

  // A plain Enter in a text field creates too, as the name field does in Orca.
  const createOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void handleCreate()
  }

  const command = claudeCommand(skipPermissions)

  return (
    <TooltipProvider>
    <Dialog open onOpenChange={(open) => !open && closeNewWorkspace()}>
      <DialogContent
        className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Focus the name, not the first tabbable (the project field, whose list would open).
          event.preventDefault()
          nameInputRef.current?.focus({ preventScroll: true })
        }}
      >
        <DialogHeader className="gap-1">
          <DialogTitle className="text-base font-semibold">New workspace</DialogTitle>
          <DialogDescription className="sr-only">Choose the project, workspace name and base before creating the workspace.</DialogDescription>
        </DialogHeader>
        <div data-workspace-composer-root="true" className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 rounded-md px-2 transition">
          <div className="-mx-2 min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-2 pt-3 pb-1 scrollbar-sleek">
            {request.issue ? (
              <div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
                <CircleDot className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="shrink-0 font-medium text-foreground">#{request.issue.number}</span>
                <span className="min-w-0 truncate text-muted-foreground">{request.issue.title}</span>
              </div>
            ) : null}

            {/* Project */}
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className={LABEL}>Project</label>
                {onAddProject ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => void handleAddProject()}
                        className="size-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                        aria-label="Add project"
                      >
                        <FolderPlus className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      Add project
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
              <ProjectCombobox
                options={projects}
                value={project}
                onValueChange={pickProject}
                onValueSelected={() => nameInputRef.current?.focus()}
                onAddProject={onAddProject ? () => void handleAddProject() : undefined}
                triggerClassName="h-9 w-full border-input text-sm focus:border-ring focus:ring-[3px] focus:ring-ring/50"
                describedBy={projectDescriptionId}
              />
              {projectPending ? (
                <p id={projectDescriptionId} className="truncate text-[11px] text-muted-foreground">
                  Reading {project}…
                </p>
              ) : projects.length === 0 ? (
                <p id={projectDescriptionId} className="text-[11px] text-muted-foreground">
                  Add a project before creating a workspace.
                </p>
              ) : null}
            </div>

            {/* Name */}
            <div className="min-w-0 space-y-1">
              <label htmlFor={`${projectDescriptionId}-name`} className={cn(LABEL, 'block min-w-0 truncate')}>
                Name <span className="text-muted-foreground/70">[Optional]</span>
              </label>
              <div className="relative">
                <GitBranch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  id={`${projectDescriptionId}-name`}
                  ref={nameInputRef}
                  value={name}
                  placeholder={fallbackName}
                  onChange={(e) => {
                    setName(e.target.value)
                    setCreateError(null)
                  }}
                  onKeyDown={createOnEnter}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={nameInvalid || undefined}
                  className={cn(FIELD, 'pl-8', nameInvalid && 'border-destructive')}
                />
              </div>
              {nameInvalid ? (
                <p className="text-[11px] text-destructive">Use letters, digits, dots, dashes or underscores.</p>
              ) : selected ? (
                <p className="min-w-0 truncate text-[11px] text-muted-foreground" title={treePath(selected.id, effectiveName)}>
                  Branch <span className="font-mono text-foreground/80">{effectiveName}</span> in {treePath(selected.id, effectiveName)}
                </p>
              ) : null}
            </div>

            {/* Base */}
            <div className="min-w-0 space-y-1">
              <label htmlFor={`${projectDescriptionId}-base`} className={cn(LABEL, 'block')}>
                Start from <span className="text-muted-foreground/70">[Optional]</span>
              </label>
              <input
                id={`${projectDescriptionId}-base`}
                value={base}
                placeholder={selected?.mainBranch ? `${selected.mainBranch} (the main checkout's HEAD)` : "The main checkout's HEAD"}
                onChange={(e) => setBase(e.target.value)}
                onKeyDown={createOnEnter}
                spellCheck={false}
                autoComplete="off"
                className={cn(FIELD, 'font-mono text-xs')}
              />
              <p className="text-[11px] text-muted-foreground">A branch that already exists is checked out as it is.</p>
            </div>

            {/* Agent */}
            <div className="min-w-0 space-y-1">
              <label className={LABEL}>Agent</label>
              <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs dark:bg-input/30">
                <TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="shrink-0">Claude Code</span>
                <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground" data-testid="agent-command">
                  {command}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={skipPermissions}
                onClick={() => onSkipPermissionsChange(!skipPermissions)}
                className="group flex w-fit cursor-pointer items-center gap-2 rounded-md pt-1 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <SwitchIndicator checked={skipPermissions} />
                <span className="text-muted-foreground transition-colors group-hover:text-foreground">Skip permission prompts</span>
              </button>
            </div>

            {/* Advanced: the repo's setup command */}
            <div className="!mb-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdvancedOpen((v) => !v)} aria-expanded={advancedOpen} className="-ml-2 text-xs focus-visible:ring-inset">
                Advanced
                {!advancedOpen && setup.trim() ? <span className="font-normal text-muted-foreground">· setup runs</span> : null}
                <ChevronDown className={cn('size-4 transition-transform', advancedOpen && 'rotate-180')} />
              </Button>
              <div className={cn('grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out', advancedOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')} aria-hidden={!advancedOpen}>
                <div className="min-h-0">
                  <div className="space-y-1 px-px pt-2 pb-1">
                    <label htmlFor={`${projectDescriptionId}-setup`} className={cn(LABEL, 'block')}>
                      Setup command
                    </label>
                    <input
                      id={`${projectDescriptionId}-setup`}
                      value={setup}
                      placeholder="pnpm install"
                      tabIndex={advancedOpen ? 0 : -1}
                      onChange={(e) => setSetup(e.target.value)}
                      onKeyDown={createOnEnter}
                      spellCheck={false}
                      autoComplete="off"
                      className={cn(FIELD, 'font-mono text-xs')}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Runs in each new worktree of {selected?.displayName ?? 'this project'}, after the files <span className="font-mono">.worktreeinclude</span> names are copied. Remembered for the project.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 space-y-2">
            {createError ? (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs break-words text-destructive">
                {createError}
              </div>
            ) : null}
            <div className={cn('flex items-center gap-3', request.issue ? 'justify-between' : 'justify-end')}>
              {request.issue ? (
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={handleDispatch} disabled={!selected || creating} title={`mnemo dispatch ${request.issue.number}: a headless child with mnemo's memory`}>
                  <Send className="size-3.5" />
                  Dispatch
                </Button>
              ) : null}
              <Button onClick={() => void handleCreate()} disabled={createDisabled} size="sm" className="text-xs">
                {creating ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Create
                <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-white/20 px-1.5 py-0.5 text-[10px] leading-none font-medium text-current/80">
                  <span>{modLabel}</span>
                  <CornerDownLeft className="size-3" />
                </span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </TooltipProvider>
  )
}

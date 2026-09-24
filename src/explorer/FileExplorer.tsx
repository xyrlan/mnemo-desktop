// adapted from stablyai/orca components/right-sidebar/FileExplorer.tsx, FileExplorerFilesTreePane.tsx, FileExplorerVirtualRows.tsx and FileExplorerQueryStrip.tsx
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ScrollArea, TooltipProvider } from '@/ui'
import { FileExplorerNameFilter } from './FileExplorerNameFilter'
import { FileExplorerRow } from './FileExplorerRow'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { STATUS_COLORS } from './git'
import { applyNavigation } from './keyboard'
import { isPathIgnored, relativeTo } from './paths'
import { createRowProjection, filteredRows, flattenTree, nameFilterTokens, openFolders, type Visibility } from './rows'
import { DEFAULT_PREFS, gitOf, type ExplorerStore } from './store'
import type { TreeNode } from './types'
import './explorer.css'

/** How often the tree, while drawn, reads the disk and git again: nothing here watches files. */
export const REFRESH_MS = 10_000
export const ROW_HEIGHT = 24

export type FileExplorerProps = {
  store: ExplorerStore
  /** The worktree on screen; null before there is one. */
  root: string | null
  repoName: string
  /** The file the focused editor pane shows: its row is revealed and drawn selected. */
  activeFile: string | null
  /** Changes when something may have written files (an agent finishing a turn): read again. */
  stamp?: string | null
  onOpenFile: (path: string, place: 'auto' | 'split-row') => void
  onOpenInTerminal: (dir: string) => void
  onCopy: (text: string) => void
}

const EMPTY: ReadonlySet<string> = new Set()

function FileExplorerFiles({ store, root, repoName, activeFile, stamp, onOpenFile, onOpenInTerminal, onCopy }: FileExplorerProps & { root: string }): React.JSX.Element {
  const prefs = useStore(store, (s) => s.prefs[root] ?? DEFAULT_PREFS)
  const dirs = useStore(store, (s) => s.dirs)
  const loading = useStore(store, (s) => s.loading)
  const rootError = useStore(store, (s) => s.errors[root] ?? null)
  const git = useStore(store, (s) => gitOf(s, root))
  const fileList = useStore(store, (s) => s.files[root])

  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY)
  const [selected, setSelected] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const hasNameFilter = nameFilterTokens(deferredQuery).length > 0

  useEffect(() => {
    void store.getState().open(root)
  }, [store, root, stamp])

  useEffect(() => {
    const again = () => void store.getState().refresh(root)
    const id = setInterval(again, REFRESH_MS)
    window.addEventListener('focus', again)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', again)
    }
  }, [store, root])

  useEffect(() => {
    if (hasNameFilter) void store.getState().loadFiles(root)
  }, [store, root, hasNameFilter])

  const expanded = useMemo(() => new Set(prefs.expanded), [prefs.expanded])
  const visibility: Visibility = useMemo(
    () => ({ showDotfiles: prefs.showDotfiles, showIgnored: prefs.showIgnored, ignored: git.ignored }),
    [prefs.showDotfiles, prefs.showIgnored, git.ignored],
  )
  const rows = useMemo(
    () => (hasNameFilter ? filteredRows(root, fileList?.paths ?? [], deferredQuery, visibility, collapsed) : flattenTree(root, dirs, expanded, visibility)),
    [hasNameFilter, root, fileList?.paths, deferredQuery, visibility, collapsed, dirs, expanded],
  )
  const projection = useMemo(() => createRowProjection(rows), [rows])
  const rowExpanded = useMemo(() => (hasNameFilter ? openFolders(rows) : expanded), [hasNameFilter, rows, expanded])

  const toggleDir = useCallback(
    (dir: string) => {
      if (!hasNameFilter) return store.getState().toggle(root, dir)
      setCollapsed((c) => {
        const next = new Set(c)
        if (rowExpanded.has(dir)) next.add(dir)
        else next.delete(dir)
        return next
      })
    },
    [hasNameFilter, store, root, rowExpanded],
  )

  // ── rows ────────────────────────────────────────────────────
  const viewport = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const revealIndex = useCallback(
    (index: number, focus: boolean) => {
      virtualizer.scrollToIndex(index, { align: 'auto' })
      if (!focus) return
      // The row may only be drawn after the scroll lands.
      requestAnimationFrame(() => viewport.current?.querySelector<HTMLElement>(`[data-index="${index}"] [data-file-explorer-row]`)?.focus())
    },
    [virtualizer],
  )

  // The focused editor's file: open the folders above it, select it, and scroll to it once drawn.
  const pendingReveal = useRef<string | null>(null)
  useEffect(() => {
    if (!activeFile || relativeTo(root, activeFile) === null) return
    store.getState().reveal(root, activeFile)
    setSelected(activeFile)
    pendingReveal.current = activeFile
  }, [store, root, activeFile])
  useEffect(() => {
    const path = pendingReveal.current
    if (!path || hasNameFilter) return
    const index = projection.getIndexByPath(path)
    if (index === null) return
    pendingReveal.current = null
    revealIndex(index, false)
  }, [projection, hasNameFilter, revealIndex])

  const activate = useCallback(
    (node: TreeNode) => {
      setSelected(node.path)
      if (node.isDirectory) toggleDir(node.path)
      else onOpenFile(node.path, 'auto')
    },
    [toggleDir, onOpenFile],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-ignore-file-explorer-keys]')) return
    const handled = applyNavigation(
      {
        rowProjection: projection,
        selectedPath: selected,
        isExpanded: (p) => rowExpanded.has(p),
        select: setSelected,
        toggleDir,
        reveal: (i) => revealIndex(i, true),
      },
      e,
    )
    if (handled || e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return
    const node = selected ? projection.getRowByPath(selected) : null
    if (!node) return
    e.preventDefault()
    if (node.isDirectory) toggleDir(node.path)
    else onOpenFile(node.path, e.shiftKey ? 'split-row' : 'auto')
  }

  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault()
      clearFilter()
    } else if (e.key === 'ArrowDown' && rows.length > 0) {
      e.preventDefault()
      setSelected(rows[0].path)
      revealIndex(0, true)
    }
  }

  const clearFilter = () => {
    setQuery('')
    setCollapsed(EMPTY)
  }

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      await store.getState().refresh(root)
    } finally {
      setIsRefreshing(false)
    }
  }

  // ── status ──────────────────────────────────────────────────
  const isEmptyState = rows.length === 0
  const isLoading = isEmptyState && (hasNameFilter ? fileList?.paths == null && !fileList?.error : !dirs[root] && !rootError)
  const treeError = hasNameFilter ? (fileList?.error ?? null) : rootError
  const hasError = isEmptyState && !isLoading && !!treeError
  const selectedIndex = selected ? projection.getIndexByPath(selected) : null
  const tabStop = selectedIndex ?? 0

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-orca-explorer-shell onKeyDown={onKeyDown}>
      <FileExplorerToolbar
        repoName={repoName}
        isRefreshing={isRefreshing}
        onRefresh={() => void refresh()}
        canCollapseAll={!hasNameFilter && prefs.expanded.length > 0}
        onCollapseAll={() => store.getState().collapseAll(root)}
        showGitIgnoredFiles={prefs.showIgnored}
        onToggleGitIgnoredFiles={() => store.getState().setShowIgnored(root, !prefs.showIgnored)}
        showDotfiles={prefs.showDotfiles}
        onToggleDotfiles={() => store.getState().setShowDotfiles(root, !prefs.showDotfiles)}
      />
      <div className="border-b border-border px-2 py-1.5">
        <FileExplorerNameFilter
          query={query}
          loading={hasNameFilter && fileList?.paths == null && !fileList?.error}
          onQueryChange={setQuery}
          onClear={clearFilter}
          onKeyDown={onFilterKeyDown}
        />
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportRef={viewport}
        viewportTabIndex={-1}
        viewportClassName="h-full min-h-0 py-2"
      >
        {isEmptyState ? (
          <FileExplorerTreeStatus
            isLoading={isLoading}
            error={hasError ? treeError : null}
            isEmpty={!isLoading && !hasError}
            emptyMessage={hasNameFilter ? 'No files match this filter' : undefined}
          />
        ) : (
          <div className="relative w-full" role="tree" aria-label="Files" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const n = rows[vItem.index]
              if (!n) return null
              const nodeStatus = (n.isDirectory ? git.folders : git.files).get(n.relativePath) ?? null
              const isIgnored = !nodeStatus && isPathIgnored(git.ignored, n.relativePath)
              const isExpanded = rowExpanded.has(n.path)
              return (
                <div key={n.path} data-index={vItem.index} role="none" className="absolute left-0 right-0" style={{ transform: `translateY(${vItem.start}px)` }}>
                  <FileExplorerRow
                    // Roving focus: Tab lands on one row, the arrows move between them.
                    tabIndex={vItem.index === tabStop ? 0 : -1}
                    node={n}
                    isExpanded={isExpanded}
                    isLoading={n.isDirectory && !!loading[n.path]}
                    isSelected={selected === n.path}
                    nodeStatus={nodeStatus}
                    statusColor={nodeStatus ? STATUS_COLORS[nodeStatus] : null}
                    isIgnored={isIgnored}
                    canCollapseFolderSubtree={!hasNameFilter}
                    onClick={() => activate(n)}
                    onOpenToSide={() => onOpenFile(n.path, 'split-row')}
                    onCopyPath={(kind) => onCopy(kind === 'absolute' ? n.path : n.relativePath)}
                    onOpenInTerminal={() => onOpenInTerminal(n.path)}
                    onCollapseFolderSubtree={() => store.getState().collapseSubtree(root, n.path)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

/** Orca's Explorer tab: the worktree on screen as a lazily read tree, a name filter, keyboard
 *  navigation, git decorations; a file opens in the editor pane. */
export function FileExplorer(props: FileExplorerProps): React.JSX.Element {
  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full min-h-0 flex-col" data-file-explorer data-ui>
        {props.root ? (
          // Keyed: another worktree starts with its own filter and selection.
          <FileExplorerFiles key={props.root} {...props} root={props.root} />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">Select a workspace to browse files</div>
        )}
      </div>
    </TooltipProvider>
  )
}

// adapted from stablyai/orca components/right-sidebar/file-explorer-keyboard-navigation.ts
import type { RowProjection } from './rows'

export type NavigationKey = 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageUp' | 'PageDown'

export type ResolvedNavigation =
  | { type: 'move'; targetIndex: number }
  | { type: 'toggle-expand'; currentIndex: number; dirPath: string }
  | { type: 'toggle-collapse'; currentIndex: number; dirPath: string }
  | { type: 'no-op' }
  | { type: 'unhandled' }

/**
 * Resolve a tree-navigation key to a target row index, mirroring the VS Code
 * Explorer tree: arrow keys move within the flat visible order, Left/Right
 * collapse/expand folders or step across parent/child boundaries, and
 * Home/End/PageUp/PageDown jump along the visible list.
 */
export function resolveNavigationTarget(args: {
  key: NavigationKey
  currentIndex: number | null
  rowProjection: RowProjection
  total: number
  isExpanded: (path: string) => boolean
}): ResolvedNavigation {
  const { key, currentIndex, rowProjection, total, isExpanded } = args
  if (total === 0) return { type: 'no-op' }

  if (currentIndex === null) {
    if (key === 'ArrowDown' || key === 'End' || key === 'PageDown') return { type: 'move', targetIndex: 0 }
    if (key === 'ArrowUp' || key === 'Home' || key === 'PageUp') return { type: 'move', targetIndex: total - 1 }
    return { type: 'unhandled' }
  }

  switch (key) {
    case 'ArrowDown':
      return { type: 'move', targetIndex: Math.min(total - 1, currentIndex + 1) }
    case 'ArrowUp':
      return { type: 'move', targetIndex: Math.max(0, currentIndex - 1) }
    case 'Home':
      return { type: 'move', targetIndex: 0 }
    case 'End':
      return { type: 'move', targetIndex: total - 1 }
    case 'PageDown': {
      const pageSize = Math.max(1, Math.floor(total / 10))
      return { type: 'move', targetIndex: Math.min(total - 1, currentIndex + pageSize) }
    }
    case 'PageUp': {
      const pageSize = Math.max(1, Math.floor(total / 10))
      return { type: 'move', targetIndex: Math.max(0, currentIndex - pageSize) }
    }
    case 'ArrowRight': {
      const node = rowProjection.getRowAtIndex(currentIndex)
      if (!node || !node.isDirectory) return { type: 'move', targetIndex: currentIndex }
      if (!isExpanded(node.path)) return { type: 'toggle-expand', currentIndex, dirPath: node.path }
      const firstChild = rowProjection.getFirstChildIndex(currentIndex)
      return { type: 'move', targetIndex: firstChild ?? currentIndex }
    }
    case 'ArrowLeft': {
      const node = rowProjection.getRowAtIndex(currentIndex)
      if (!node) return { type: 'no-op' }
      if (node.isDirectory && isExpanded(node.path)) return { type: 'toggle-collapse', currentIndex, dirPath: node.path }
      const parent = rowProjection.getParentIndex(currentIndex)
      if (parent === null) return { type: 'no-op' }
      return { type: 'move', targetIndex: parent }
    }
  }
}

const NAVIGATION_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

export const isNavigationKey = (key: string): key is NavigationKey => NAVIGATION_KEYS.has(key)

export type NavigationContext = {
  rowProjection: RowProjection
  selectedPath: string | null
  isExpanded: (path: string) => boolean
  select: (path: string) => void
  toggleDir: (dirPath: string) => void
  /** Scroll the row into view and focus it, once it is drawn. */
  reveal: (index: number) => void
}

/**
 * Apply a tree-navigation key to the explorer: resolve the target, then
 * move the selection (or toggle a directory) and bring the new row into
 * view. Returns true if the key was handled.
 */
export function applyNavigation(ctx: NavigationContext, e: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey' | 'preventDefault' | 'stopPropagation'>): boolean {
  if (e.altKey || e.metaKey || e.ctrlKey) return false
  if (!isNavigationKey(e.key)) return false
  const currentIndex = ctx.selectedPath ? ctx.rowProjection.getIndexByPath(ctx.selectedPath) : null
  const resolved = resolveNavigationTarget({
    key: e.key,
    currentIndex,
    rowProjection: ctx.rowProjection,
    total: ctx.rowProjection.getVisibleCount(),
    isExpanded: ctx.isExpanded,
  })
  if (resolved.type === 'unhandled' || resolved.type === 'no-op') return false

  e.preventDefault()
  e.stopPropagation()
  if (resolved.type === 'toggle-expand' || resolved.type === 'toggle-collapse') {
    ctx.toggleDir(resolved.dirPath)
    return true
  }
  const target = ctx.rowProjection.getRowAtIndex(resolved.targetIndex)
  if (!target) return false
  ctx.select(target.path)
  ctx.reveal(resolved.targetIndex)
  return true
}

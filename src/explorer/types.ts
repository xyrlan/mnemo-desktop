// adapted from stablyai/orca components/right-sidebar/file-explorer-types.ts

/** One visible row of the tree. `depth` is 0 for the worktree's own children. */
export type TreeNode = {
  name: string
  /** Absolute. */
  path: string
  /** From the worktree root, `/`-separated. */
  relativePath: string
  isDirectory: boolean
  depth: number
}

/** A directory's listing as `fs_list` gave it: folders first, each group sorted. */
export type DirEntry = { name: string; isDirectory: boolean }

/** What git says of a path, as the row draws it. */
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

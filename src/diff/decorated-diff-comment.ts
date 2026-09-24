// adapted from stablyai/orca src/renderer/src/components/diff-comments/decorated-diff-comment.ts (MIT, 122b8c25)
import type { DiffComment } from './comment'

export type DecoratedDiffComment = DiffComment & {
  canDelete?: boolean
  canEdit?: boolean
}

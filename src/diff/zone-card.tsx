// adapted from stablyai/orca src/renderer/src/components/diff-comments/diff-comment-zone-card.tsx (MIT, 122b8c25)
import type { RefObject } from 'react'
import type { Root } from 'react-dom/client'
import { SendHorizontal } from 'lucide-react'
import { DiffCommentCard } from './DiffCommentCard'
import type { DecoratedDiffComment } from './decorated-diff-comment'

export function getRenderSignature(comment: DecoratedDiffComment): string {
  return JSON.stringify({
    body: comment.body,
    quote: comment.quote ?? null,
    canDelete: comment.canDelete ?? null,
    canEdit: comment.canEdit ?? null
  })
}

// Callbacks arrive as refs so the rendered props keep the decorator's identity semantics.
export type DiffCommentZoneCardContext = {
  resizeZone: (commentId: string) => void
  onDeleteCommentRef: RefObject<(commentId: string) => void>
  onUpdateCommentRef: RefObject<((commentId: string, body: string) => Promise<boolean>) | undefined>
  onSendCommentRef: RefObject<((commentId: string) => void) | undefined>
}

export function renderDiffCommentZoneCard(
  root: Root,
  comment: DecoratedDiffComment,
  { resizeZone, onDeleteCommentRef, onUpdateCommentRef, onSendCommentRef }: DiffCommentZoneCardContext
): void {
  root.render(
    // View zones are separate React roots outside the app root; `data-ui` marks them as Orca UI.
    <div data-ui>
      <DiffCommentCard
        lineNumber={comment.lineNumber}
        startLine={comment.startLine}
        quote={comment.quote?.split('\n')[0]}
        body={comment.body}
        onDelete={
          comment.canDelete === false ? undefined : () => onDeleteCommentRef.current(comment.id)
        }
        onSubmitEdit={
          onUpdateCommentRef.current && comment.canEdit !== false
            ? async (body) => {
                const fn = onUpdateCommentRef.current
                if (!fn) {
                  return false
                }
                return fn(comment.id, body)
              }
            : undefined
        }
        onContentResize={() => resizeZone(comment.id)}
        observeRenderedSize
        headerActions={
          onSendCommentRef.current ? (
            <button
              type="button"
              className="orca-diff-comment-pill-btn orca-diff-comment-edit"
              title="Send this note to the agent"
              aria-label="Send this note to the agent"
              onClick={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                onSendCommentRef.current?.(comment.id)
              }}
            >
              <SendHorizontal className="size-3" />
            </button>
          ) : null
        }
      />
    </div>
  )
}

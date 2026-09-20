import { useEffect, type ReactNode } from 'react'

export type CardDrawerProps = {
  open: boolean
  onClose: () => void
  /** What the drawer is a window onto: `merge · PR #412`, `mnemo-desktop/103`. */
  title: string
  children: ReactNode
  /** Given → a header button that hands the content to a real pane and then closes the drawer.
   *  The pane is the caller's to open (`openView`); the drawer only promises to get out of the
   *  way afterwards. Absent → no button. */
  onPromote?: () => void
}

/** The word on the promote button, exported so a consumer's test can name it. */
export const PROMOTE = 'open in pane'

/** A panel anchored to a card row: it slides in from the right of the board and sits *beside*
 *  the list, never over it. Deliberately not a modal — no backdrop, no focus trap, nothing
 *  portalled to `document.body` (that is `palette-overlay`, which is for prompts that must be
 *  answered before anything else happens). The row you opened it from stays visible, keeps its
 *  focus and stays clickable, and the cockpit store keeps at most one of these open.
 *
 *  Closing is a window shutting, not the work behind it stopping: there is no prop through which
 *  `onClose` could cancel anything, and the drawer calls nothing else on its way out. */
export default function CardDrawer({ open, onClose, title, children, onPromote }: CardDrawerProps) {
  useEffect(() => {
    if (!open) return
    // On the window, because focus is not in here: the list keeps it, and Escape closes from
    // wherever it is pressed. A modifier means some chord (`actionForKey`), never this; an
    // Escape already consumed — the cockpit closing its mission map — is not ours either.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <aside className="ck-drawer" aria-label={title}>
      <div className="ck-drawer-head">
        <span className="ck-drawer-title" title={title}>
          {title}
        </span>
        <span className="ck-spacer" />
        {onPromote && (
          <button
            className="ck-act ck-promote"
            onClick={() => {
              onPromote()
              onClose()
            }}
          >
            {PROMOTE}
          </button>
        )}
        <button className="ck-close" aria-label="close drawer" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ck-drawer-body">{children}</div>
    </aside>
  )
}

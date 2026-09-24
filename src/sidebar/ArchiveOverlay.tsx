import React from 'react'
import { CleanupDialog } from './CleanupDialog'
import { RemoveDialog } from './RemoveDialog'

/** The sidebar's dialogs, drawn in the shell's overlay so they open while the sidebar is closed
 *  too: the cleanup view and a card's "Remove workspace?". */
export default function ArchiveOverlay(): React.JSX.Element {
  return (
    <>
      <CleanupDialog />
      <RemoveDialog />
    </>
  )
}

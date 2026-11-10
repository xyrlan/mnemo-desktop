import { useEffect, useState } from 'react'
import { showFront } from '../../frame/flag'
import { registerWindow } from '../ui/windows'

const toNext = () => showFront(true)

/** SYSTEMS › New interface: the way back from the ship to the new front
 *  (docs/superpowers/specs/2026-11-10-recreation-swap.md). The SYSTEMS menu lists the windows of
 *  its group and opens the one chosen, so the item is a window: opened, it keeps the choice and
 *  loads the app again, and says why if the choice could not be kept. The terminals are the
 *  core's and stay as they are. */
export function NewInterface({ show = toNext }: { show?: () => string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => setFailed(show()), [show])
  return (
    <p data-nx-next="" role={failed ? 'alert' : 'status'} className="nx-muted">
      {failed ?? 'Opening the new interface…'}
    </p>
  )
}

/** After every other window of the group: it leaves the ship. */
export const NEXT_WINDOW = { id: 'next', title: 'New interface', group: 'systems' as const, order: 90, width: 420 }

registerWindow({ ...NEXT_WINDOW, render: () => <NewInterface /> })

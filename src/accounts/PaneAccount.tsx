import { UserRound } from 'lucide-react'
import { usePaneAccount } from './store'

/** In a pane's bar: the account the pane runs on, when there is more than one and it is not the
 *  active one. Panes opened from now on run on the active account; this one does not, until the
 *  Claude session in it follows the switch (`follow.ts`), which happens once it is idle. */
export function PaneAccount({ id }: { id: number }) {
  const label = usePaneAccount(id)
  if (!label) return null
  return (
    <span
      className="inline-flex max-w-32 shrink-0 items-center gap-1 rounded-sm border border-status-warning-border bg-status-warning-background px-1 text-[10px] leading-4 text-status-warning"
      title={`Runs on the Claude account ${label}, not the active one. A Claude session here moves to the active one once it is idle.`}
      data-pane-account=""
    >
      <UserRound className="size-2.5 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  )
}

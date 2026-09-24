import { Component, type ErrorInfo, type ReactNode } from 'react'
import { cn } from '@/ui/cn'
import { useSlot, type ShellSlot } from './slots'

type BoundaryProps = { label: string; floating: boolean; children: ReactNode }

/** One slot component that threw: a line saying so, in place of it, with a retry. Not
 *  `panes/ErrorBoundary`, whose message fills its positioned ancestor — for the overlay slot
 *  that is the whole window, and one broken drawer would hide every working screen. */
class SlotBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] crashed`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        role="alert"
        title={error.message}
        className={cn(
          'flex min-w-0 items-center gap-2 px-3 py-1 text-xs text-destructive',
          this.props.floating && 'fixed bottom-8 left-3 z-toast rounded-md border border-border bg-popover shadow-floating',
        )}
      >
        <span className="truncate">{this.props.label} crashed</span>
        <button type="button" className="shrink-0 rounded px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => this.setState({ error: null })}>
          retry
        </button>
      </div>
    )
  }
}

/** Draws what is mounted in `slot`, each in its own boundary. */
export function SlotOutlet({ slot }: { slot: ShellSlot }) {
  const entries = useSlot(slot)
  return (
    <>
      {entries.map(({ key, component: C }) => (
        <SlotBoundary key={key} label={`${slot} · ${C.displayName || C.name || 'component'}`} floating={slot === 'overlay'}>
          <C />
        </SlotBoundary>
      ))}
    </>
  )
}

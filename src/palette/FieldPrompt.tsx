import type { KeyboardEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { cn } from '@/ui/cn'

type Props = {
  /** Names the field for a screen reader. */
  label: string
  value: string
  placeholder?: string
  /** The line under the field: what Enter does, or why it failed. */
  hint: ReactNode
  error?: boolean
  /** An icon before the field. */
  icon?: ReactNode
  onChange(value: string): void
  /** Enter and Escape are the caller's: it knows what they mean. */
  onKeyDown(e: KeyboardEvent<HTMLInputElement>): void
  /** A press outside the surface. */
  onDismiss(): void
}

/** A one-field overlay where the command palette sits: a scrim a press on dismisses, and the
 *  palette's surface holding the field and a line under it. `data-palette`, as the palette:
 *  dictation types into the pane behind, not into this field (src/voice/route.ts). */
export function FieldPrompt({ label, value, placeholder, hint, error = false, icon, onChange, onKeyDown, onDismiss }: Props) {
  return (
    <div data-palette className="fixed inset-0 z-modal bg-black/55 backdrop-blur-[2px] animate-in fade-in-0" onMouseDown={onDismiss}>
      <div
        role="dialog"
        aria-label={label}
        className="fixed top-[20%] left-1/2 w-[660px] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-lg border border-black/14 bg-background/96 text-foreground shadow-[0_20px_60px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl animate-in fade-in-0 zoom-in-95 dark:border-white/14 dark:bg-[rgba(23,23,23,0.96)] dark:shadow-[0_24px_72px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground">
          {icon}
          <input
            autoFocus
            aria-label={label}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-12 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className={cn('field-prompt-hint px-3.5 py-2 text-xs break-words whitespace-pre-wrap', error ? 'text-destructive' : 'text-muted-foreground')}>{hint}</div>
      </div>
    </div>
  )
}

/** Mounts `render(close)` in a root of its own on <body>, until `close` is called. For a prompt a
 *  piece opens from an action, with no place of its own in the app's tree. */
export function mountPrompt(render: (close: () => void) => ReactNode): void {
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  const close = () => {
    root.unmount()
    host.remove()
  }
  root.render(render(close))
}

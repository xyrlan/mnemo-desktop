// The vault's small shared parts in Orca's list grammar, adapted from stablyai/orca
// components/right-sidebar/checks-panel/checks-list.tsx and components/pull-request-page/checks/row.tsx
// (MIT, 122b8c25): hairline rows that tint on hover, 10px uppercase headers, ghost icon buttons,
// colour only for state. The class names that are not Tailwind (`vt-*`, `vr-*`, `ib-*`) carry no
// style: they name the parts for the tests and for the reader.
import type { KeyboardEvent, ReactNode } from 'react'
import { Check, RotateCw, Search, X } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import type { Tone } from './rules'

/** A tone's dot: verified green, elsewhere/CI the accent, unrated amber, demoted red. */
export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-status-success',
  accent: 'bg-brand',
  warn: 'bg-status-warning',
  bad: 'bg-destructive',
  muted: 'bg-muted-foreground/60',
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <i aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', TONE_DOT[tone], className)} />
}

/** The table header cell: Orca's section-label type. */
export const TH = 'sticky top-0 z-[1] h-7 bg-background px-2 text-left align-middle text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]'
/** A table row: a hairline under it, tinted on hover, the accent's bar and a fill when selected. */
export const TR = 'border-b border-border/60 transition-colors hover:bg-accent/40'
export const TR_SELECTED = 'bg-accent/60 shadow-[inset_2px_0_0_var(--brand)] hover:bg-accent/60'
/** Hover-revealed row actions, kept visible while the row is selected or focused. */
export const ROW_ACTIONS = 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'
/** Where a row's actions float: over the end of its last cell, as a small toolbar of their own,
 *  so the table spends no column on them. */
export const ROW_TOOLBAR = 'absolute top-1 right-1 inline-flex items-center gap-0.5 rounded-md border border-border bg-popover p-px shadow-xs'
/** A quiet line of text: empty states, "reading…". */
export const EMPTY = 'px-2 py-3 text-[12px] text-muted-foreground'
/** A native form control in the new look: the scope `<select>`, the text inputs' size. */
export const SELECT =
  'h-7 max-w-[220px] cursor-pointer rounded-md border border-input bg-transparent px-2 text-[12px] text-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

/** The ghost refresh button every read has: spins while `busy`. */
export function Refresh({ title, busy, onClick, className }: { title: string; busy: boolean; onClick(): void; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={cn('text-muted-foreground hover:text-foreground', className)}
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
    >
      <RotateCw className={cn(busy && 'animate-spin')} />
    </Button>
  )
}

/** The × that puts something away. */
export function Dismiss({ title = 'Dismiss', label = title, onClick, className }: { title?: string; label?: string; onClick(): void; className?: string }) {
  return (
    <Button type="button" variant="ghost" size="icon-xs" className={cn('shrink-0 text-muted-foreground hover:text-foreground', className)} title={title} aria-label={label} onClick={onClick}>
      <X />
    </Button>
  )
}

/** A checkbox with its label, in the brand colour when on. */
export function Toggle({ className, title, checked, onChange, children }: { className: string; title: string; checked: boolean; onChange(on: boolean): void; children: ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-1.5 text-[12px] whitespace-nowrap text-muted-foreground select-none hover:text-foreground', className)} title={title}>
      <span className="relative inline-flex size-3.5 shrink-0">
        <input
          type="checkbox"
          className="peer size-3.5 cursor-pointer appearance-none rounded-[4px] border border-muted-foreground/50 bg-transparent transition-colors outline-none checked:border-brand checked:bg-brand focus-visible:ring-[3px] focus-visible:ring-ring/50"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <Check aria-hidden strokeWidth={3} className="pointer-events-none absolute inset-0 m-auto size-2.5 text-brand-foreground opacity-0 peer-checked:opacity-100" />
      </span>
      {children}
    </label>
  )
}

/** A reading in flight: a pulsing dot before the words. */
export function Loading({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('vt-empty vt-loading flex items-center gap-2', EMPTY, className)} role="status">
      <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none" />
      {children}
    </div>
  )
}

/** A text field with the search icon in it; the input is the wrapper's only one, for the tests. */
export function SearchInput({ className, value, placeholder, onChange, onKeyDown }: { className?: string; value: string; placeholder: string; onChange(value: string): void; onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void }) {
  return (
    <div className={cn('relative', className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="h-7 w-full min-w-0 rounded-md border border-input bg-transparent pr-2 pl-7 text-[12px] text-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

/** A row's action as Orca's hover rows have them: an icon, its word for screen readers and the
 *  tests. A destructive one, once armed, says its question out loud in red. */
export function RowAction({
  icon,
  label,
  title,
  armed,
  destructive,
  disabled,
  onClick,
}: {
  icon: ReactNode
  /** The action's word, or its question while armed. */
  label: string
  title?: string
  armed?: boolean
  destructive?: boolean
  disabled?: boolean
  onClick(): void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={armed ? 'xs' : 'icon-xs'}
      className={cn(
        armed ? 'vt-armed h-5 px-1.5 text-[11px] font-normal' : 'size-5',
        destructive && 'vt-destructive',
        armed ? 'bg-destructive/15 text-destructive hover:bg-destructive/20 hover:text-destructive' : destructive ? 'text-muted-foreground hover:text-destructive' : 'text-muted-foreground hover:text-foreground',
      )}
      title={title ?? label}
      aria-label={armed ? undefined : label}
      disabled={disabled}
      onClick={onClick}
    >
      {armed ? label : (
        <>
          {icon}
          <span className="sr-only">{label}</span>
        </>
      )}
    </Button>
  )
}

// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatAutocompleteMenus.tsx
import { useEffect, useRef, type ReactNode } from 'react'
import { FileText, Loader2, Package } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { SlashCommand } from './catalog'

export type MenuItem = { kind: 'command'; command: SlashCommand } | { kind: 'file'; path: string }

export type MenuState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: MenuItem[] }

const SOURCE: Record<SlashCommand['source'], string> = { 'built-in': 'Built-in', project: 'Project', personal: 'Personal' }

export const optionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`

/** The `/` or `@` menu, above the composer's box. Rows are chosen on pointer-down, before the
 *  textarea loses focus: it owns the draft and the caret. */
export function ComposerMenu({
  kind,
  state,
  activeIndex,
  listboxId,
  onChoose,
}: {
  kind: 'slash' | 'file'
  state: MenuState
  activeIndex: number
  listboxId: string
  onChoose(item: MenuItem): void
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, state])

  const label = kind === 'slash' ? 'Commands and skills' : 'Files'
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={label}
      className="scrollbar-sleek absolute bottom-full left-0 right-0 z-20 mb-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
    >
      {state.status === 'loading' ? (
        <MenuStatus>
          <Loader2 className="size-3.5 animate-spin" />
          {kind === 'slash' ? 'Loading commands…' : 'Reading the worktree’s files…'}
        </MenuStatus>
      ) : state.status === 'error' ? (
        <MenuStatus>{state.message}</MenuStatus>
      ) : state.items.length === 0 ? (
        <MenuStatus>{kind === 'slash' ? 'No matching commands' : 'No matching files'}</MenuStatus>
      ) : (
        state.items.map((item, i) => (
          <MenuRow key={item.kind === 'file' ? item.path : item.command.name} item={item} id={optionId(listboxId, i)} selected={i === activeIndex} rowRef={i === activeIndex ? activeRef : null} onChoose={onChoose} />
        ))
      )}
    </div>
  )
}

function MenuStatus({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">{children}</div>
}

function MenuRow({
  item,
  id,
  selected,
  rowRef,
  onChoose,
}: {
  item: MenuItem
  id: string
  selected: boolean
  rowRef: React.MutableRefObject<HTMLButtonElement | null> | null
  onChoose(item: MenuItem): void
}) {
  return (
    <button
      id={id}
      ref={rowRef}
      role="option"
      aria-selected={selected}
      type="button"
      tabIndex={-1}
      onPointerDown={(e) => {
        e.preventDefault()
        onChoose(item)
      }}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'flex w-full cursor-default items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground',
        selected && 'border-border bg-accent text-accent-foreground',
      )}
    >
      {item.kind === 'file' ? <FileRow path={item.path} /> : <CommandRow command={item.command} />}
    </button>
  )
}

function CommandRow({ command }: { command: SlashCommand }) {
  return (
    <>
      {command.kind === 'skill' ? <Package className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate font-mono font-medium">/{command.name}</span>
          {command.argumentHint ? <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{command.argumentHint}</span> : null}
        </span>
        {command.description ? <span className="block truncate text-xs text-muted-foreground">{command.description}</span> : null}
      </span>
      <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">{SOURCE[command.source]}</span>
    </>
  )
}

function FileRow({ path }: { path: string }) {
  const cut = path.lastIndexOf('/')
  const name = path.slice(cut + 1)
  const dir = cut > 0 ? path.slice(0, cut) : ''
  return (
    <>
      <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 truncate font-medium">{name}</span>
        {dir ? <span className="min-w-0 truncate text-xs text-muted-foreground" style={{ direction: 'rtl', textAlign: 'left' }}>{`‎${dir}`}</span> : null}
      </span>
    </>
  )
}

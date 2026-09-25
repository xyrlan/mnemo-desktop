// adapted from stablyai/orca src/renderer/src/components/native-chat/NativeChatComposer.tsx,
// NativeChatComposerField.tsx, NativeChatComposerActions.tsx and use-native-chat-composer-keydown.ts
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, TriangleAlert } from 'lucide-react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { catalog, filterCommands, filterFiles, type SlashCommand } from './catalog'
import { complete, EMPTY_HISTORY, pushHistory, recallNext, recallPrevious, triggerAt, type History, type Trigger } from './draft'
import { ComposerMenu, optionId, type MenuItem, type MenuState } from './Menus'

export type ChatComposerProps = {
  /** Delivers the prompt. The draft empties the moment it is sent; a rejection is shown and the
   *  text comes back, to send again. */
  onSend(text: string): Promise<void>
  /** Runs a command in Claude Code's shell mode. Given, a `!` typed first puts the composer in
   *  that mode, as it does Claude Code's own input; not given (a child answering through its
   *  mission has no shell), a `!` is only a character. */
  onBash?(command: string): Promise<void>
  /** The worktree the session runs in: where `@` looks for files and `/` for its commands and
   *  skills. Null: no files to offer. */
  cwd: string | null
  placeholder?: string
  disabled?: boolean
}

/** The textarea grows with the draft up to this many lines, then scrolls. */
const MAX_LINES = 8

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Read<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T }

/** A catalog of `base` (the worktree), read each time a menu opens on a new token (`open`): the
 *  cache decides whether that reaches the disk. What was read stays shown while it is read again. */
function useCatalog<T>(base: string | null, open: string | null, load: (base: string) => Promise<T>): Read<T> {
  const [got, setGot] = useState<{ base: string; read: Read<T> } | null>(null)
  useEffect(() => {
    if (open === null || base === null) return
    let live = true
    load(base).then(
      (value) => live && setGot({ base, read: { status: 'ready', value } }),
      (e) => live && setGot((g) => (g?.base === base && g.read.status === 'ready' ? g : { base, read: { status: 'error', message: message(e) } })),
    )
    return () => {
      live = false
    }
    // `load` reads through the module's cache; only what is asked for re-runs it.
  }, [open, base])
  return base !== null && got?.base === base ? got.read : { status: 'loading' }
}

/** Claude Code's own colour for its shell mode (`bashBorder`). */
const SHELL = 'rgb(253,93,177)'

/** The chat's prompt box: multi-line, Enter (or ⌘↵) sends, ⇧↵ breaks the line, ↑ recalls what
 *  was sent; `/` opens Claude Code's commands and the worktree's skills, `@` its files, and a `!`
 *  typed first its shell mode. */
export function ChatComposer({ onSend, onBash, cwd, placeholder = 'Message Claude…', disabled = false }: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const listboxId = useId()
  const [draft, setDraft] = useState('')
  const [caret, setCaret] = useState(0)
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** In shell mode the draft is the command, without its `!`. */
  const [bashMode, setBashMode] = useState(false)
  const shell = bashMode && !!onBash
  const alive = useRef(true)
  useEffect(() => {
    // Set again on every mount: StrictMode unmounts and remounts it once in dev.
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // What is on screen now, for a send that fails after the draft moved on.
  const now = useRef({ draft, shell })
  now.current = { draft, shell }

  const found = useMemo(() => (shell ? null : triggerAt(draft, caret)), [shell, draft, caret])
  const trigger: Trigger | null = found && found.key !== dismissed ? found : null
  // Esc shuts a menu for its token only: once the caret leaves it, or it is deleted, the next
  // `/` or `@` opens one again.
  useEffect(() => {
    if (dismissed !== null && found?.key !== dismissed) setDismissed(null)
  }, [found, dismissed])

  const commands = useCatalog<SlashCommand[]>(cwd ?? '', trigger?.kind === 'slash' ? trigger.key : null, (base) => catalog.commands(base || null))
  const files = useCatalog<string[]>(cwd, trigger?.kind === 'file' ? trigger.key : null, (base) => catalog.files(base))

  const menu: MenuState | null = useMemo(() => {
    if (!trigger) return null
    if (trigger.kind === 'file' && !cwd) return { status: 'error', message: 'No worktree to look for files in' }
    const loaded = trigger.kind === 'slash' ? commands : files
    if (loaded.status === 'loading') return { status: 'loading' }
    if (loaded.status === 'error') return { status: 'error', message: `Could not read ${trigger.kind === 'slash' ? 'the commands' : 'the files'}: ${loaded.message}` }
    const items: MenuItem[] =
      trigger.kind === 'slash'
        ? filterCommands(loaded.value as SlashCommand[], trigger.query).map((command) => ({ kind: 'command', command }))
        : filterFiles(loaded.value as string[], trigger.query).map((path) => ({ kind: 'file', path }))
    return { status: 'ready', items }
  }, [trigger, cwd, commands, files])
  const items = menu?.status === 'ready' ? menu.items : []
  const activeIndex = items.length ? Math.min(active, items.length - 1) : 0

  // Grow with the draft, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + 8)}px`
  }, [draft])

  // Where the caret goes once a draft set from here (a completion, a recalled prompt) is on screen.
  // Keyed on the request, not the draft: a draft set to what it already was (the `!` that
  // opens shell mode on an empty box) must not leave the caret move pending for the next key.
  const [caretTo, setCaretTo] = useState<{ at: number } | null>(null)
  useLayoutEffect(() => {
    if (caretTo) textareaRef.current?.setSelectionRange(caretTo.at, caretTo.at)
  }, [caretTo])

  const place = useCallback((next: string, at: number) => {
    setCaretTo({ at })
    setDraft(next)
    setCaret(at)
    setActive(0)
  }, [])

  /** A history entry (a shell command kept with its `!`) as the draft and the mode it was in. */
  const recall = useCallback(
    (entry: string) => {
      const bang = !!onBash && entry.startsWith('!')
      setBashMode(bang)
      const text = bang ? entry.slice(1) : entry
      place(text, text.length)
    },
    [onBash, place],
  )

  const send = useCallback(
    (text: string) => {
      if (disabled || !text.trim()) return
      const asShell = shell
      // Gone from the box the moment it is sent: the stream shows it, and the next one can be
      // typed while this one is delivered.
      setHistory((h) => pushHistory(h, asShell ? `!${text}` : text))
      place('', 0)
      setBashMode(false)
      setDismissed(null)
      setError(null)
      ;(asShell && onBash ? onBash(text) : onSend(text)).catch((e: unknown) => {
        if (!alive.current) return
        setError(message(e))
        // Back to send again, unless something new is being written: then ↑ has it.
        if (now.current.draft === '') {
          setBashMode(asShell)
          place(text, text.length)
        }
      })
    },
    [disabled, shell, onBash, onSend, place],
  )

  const choose = useCallback(
    (item: MenuItem, how: 'complete' | 'run' = 'complete') => {
      if (!trigger) return
      if (item.kind === 'command' && how === 'run') {
        // A command that takes nothing runs as it is, the way Claude Code's own menu runs it.
        send(`/${item.command.name}`)
        return
      }
      const text = item.kind === 'command' ? `/${item.command.name}` : `@${item.path}`
      const next = complete(draft, trigger, caret, text)
      place(next.draft, next.caret)
      textareaRef.current?.focus()
    },
    [trigger, draft, caret, place, send],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME's Enter confirms what it composed; it neither picks a row nor sends.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // ⌘↵ sends whatever the menu shows.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send(draft)
      return
    }
    if (trigger && menu) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(trigger.key)
        return
      }
      if (items.length > 0) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const step = e.key === 'ArrowDown' ? 1 : -1
          setActive((activeIndex + step + items.length) % items.length)
          return
        }
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
          e.preventDefault()
          const item = items[activeIndex]
          // Enter runs a command that takes no argument and is all the draft holds; Tab, or a
          // command waiting for its argument, only completes it.
          const whole = draft.trim() === draft.slice(0, caret).trim()
          const run = e.key === 'Enter' && item.kind === 'command' && !item.command.argumentHint && whole
          choose(item, run ? 'run' : 'complete')
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      send(draft)
      return
    }
    const el = e.currentTarget
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    // Out of shell mode as Claude Code leaves it: Backspace (or Esc) on an empty line.
    if (shell && draft === '' && (e.key === 'Backspace' || e.key === 'Escape')) {
      e.preventDefault()
      setBashMode(false)
      return
    }
    if (e.key === 'ArrowUp' && (draft === '' || (history.index !== null && atStart))) {
      const r = recallPrevious(history)
      if (r) {
        e.preventDefault()
        setHistory(r.history)
        recall(r.draft)
      }
      return
    }
    if (e.key === 'ArrowDown' && history.index !== null) {
      const r = recallNext(history)
      if (r) {
        e.preventDefault()
        setHistory(r.history)
        recall(r.draft)
      }
    }
  }

  const sendDisabled = disabled || !draft.trim()
  return (
    <div data-ui data-chat-composer className="shrink-0 bg-background">
      <div className="px-3 pt-2 pb-3">
        <div className="relative mx-auto w-full max-w-4xl">
          {trigger && menu ? <ComposerMenu kind={trigger.kind} state={menu} activeIndex={activeIndex} listboxId={listboxId} onChoose={(item) => choose(item)} /> : null}
          {error ? (
            <div role="alert" className="mb-1.5 flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          ) : null}
          <div
            data-shell={shell || undefined}
            style={shell ? { borderColor: SHELL } : undefined}
            className={cn('rounded-lg border border-border p-1.5 shadow-xs', 'bg-muted/50 dark:bg-input/40', disabled && 'opacity-60')}
          >
            <div className="flex items-start">
              {shell && (
                <span className="cv-shell-mark shrink-0 py-1 pl-2 font-mono text-sm leading-5 font-semibold" style={{ color: SHELL }} aria-hidden>
                  !
                </span>
              )}
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                disabled={disabled}
                aria-label={shell ? 'Shell command' : 'Message'}
                aria-autocomplete="list"
                aria-expanded={!!(trigger && menu)}
                aria-controls={trigger && menu ? listboxId : undefined}
                aria-activedescendant={trigger && items.length ? optionId(listboxId, activeIndex) : undefined}
                placeholder={shell ? 'Run a shell command…' : placeholder}
                spellCheck={!shell}
                onChange={(e) => {
                  const value = e.target.value
                  const at = e.target.selectionStart ?? value.length
                  if (onBash && !shell && draft === '' && value.startsWith('!')) {
                    // `!` first, typed or pasted: shell mode, the rest is the command.
                    setBashMode(true)
                    place(value.slice(1), Math.max(0, at - 1))
                    setError(null)
                    return
                  }
                  setDraft(value)
                  setCaret(at)
                  setActive(0)
                  setError(null)
                  if (history.index !== null) setHistory((h) => ({ entries: h.entries, index: null }))
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={onKeyDown}
                className={cn(
                  'block min-h-9 w-full resize-none bg-transparent px-2 py-1 font-sans text-sm leading-5 text-foreground outline-none',
                  'scrollbar-sleek overflow-y-auto placeholder:text-muted-foreground/60 disabled:cursor-not-allowed',
                  shell && 'pl-1.5 font-mono',
                )}
              />
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5 pl-2">
              {shell ? (
                <span className="cv-shell-hint min-w-0 truncate text-[11px] text-muted-foreground/80">
                  <span style={{ color: SHELL }}>shell mode</span> · <kbd className="font-sans">↵</kbd> run · <kbd className="font-sans">⌫</kbd> on an empty line to leave
                </span>
              ) : (
                <span className="min-w-0 truncate text-[11px] text-muted-foreground/80">
                  <kbd className="font-sans">↵</kbd> send · <kbd className="font-sans">⇧↵</kbd> new line · <span className="font-mono">/</span> commands · <span className="font-mono">@</span> files
                  {onBash && (
                    <>
                      {' '}
                      · <span className="font-mono">!</span> shell
                    </>
                  )}
                </span>
              )}
              <Button
                type="button"
                size="icon"
                aria-label={shell ? 'Run' : 'Send'}
                disabled={sendDisabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => send(draft)}
                style={shell ? { backgroundColor: SHELL } : undefined}
                className="size-7 shrink-0 rounded-full"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

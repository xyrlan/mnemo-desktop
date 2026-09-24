// adapted from stablyai/orca src/renderer/src/components/browser-pane/annotate/pending-browser-annotation-card.tsx
// and GrabConfirmationSheet.tsx (MIT, 122b8c25)
import { useState, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'
import { Check, Copy, CornerDownLeft, Crosshair, ImageOff, Loader2, RotateCcw, Send, X } from 'lucide-react'
import { Button, Textarea } from '@/ui'
import { GRAB_BUDGET, elementLabel } from './grab-payload'
import type { AgentTarget } from './grab-agent'
import type { DesignMode } from './design'

export type DesignCardProps = {
  id: number
  design: DesignMode
  /** Where Send goes now, shown before it is pressed. */
  target: AgentTarget
  copy(text: string): Promise<void>
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)

/** The strip between a browser pane's bar and its page while Design Mode is on. It sits in the
 *  layout, never over the page: the page is a native webview that would cover anything drawn
 *  on top of it. Picking says what to do; a pick shows the element, its screenshot and a note
 *  for the agent. */
export function DesignCard({ id, design, target, copy }: DesignCardProps) {
  const d = useStore(design.store, (s) => s.panes[id])
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  if (!d) return null

  if (d.mode === 'sent') {
    return (
      <div data-ui className="design-strip flex h-8 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <Check className="size-3.5 text-emerald-500" />
        <span>Sent to {d.title || 'the agent'}</span>
      </div>
    )
  }

  if (d.mode === 'picking') {
    return (
      <div data-ui className="design-strip flex h-8 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground" role="status">
        <Crosshair className="size-3.5 text-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">Design Mode</span> — hover the page and click an element to send it to the agent
          {d.error && <span className="ml-2 text-destructive">{d.error}</span>}
        </span>
        <Button size="xs" variant="ghost" onClick={() => design.stop(id)} title="Leave Design Mode (Esc in the page)">
          <X />
          Stop
        </Button>
      </div>
    )
  }

  const { payload, shot, sending, error } = d
  const t = payload.target
  const ready = shot.state !== 'taking' && !sending && target.kind !== 'none'
  const send = async () => {
    if (!ready) return
    if (await design.send(id, note)) setNote('')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      design.stop(id)
    } else if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
      e.preventDefault()
      void send()
    }
  }
  const onCopy = async () => {
    const text = design.text(id, note)
    if (!text) return
    await copy(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div data-ui className="design-card flex gap-3 border-b border-border bg-card p-3 text-card-foreground" aria-label="Design Mode pick">
      <div className="flex h-24 w-32 flex-none items-center justify-center overflow-hidden rounded-md border border-border/60 bg-black/5">
        {shot.state === 'ready' ? (
          <img src={`data:image/png;base64,${shot.data}`} alt="Picked element" className="max-h-full max-w-full object-contain" />
        ) : shot.state === 'taking' ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Taking the screenshot" />
        ) : (
          <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] text-muted-foreground" title={shot.error}>
            <ImageOff className="size-4" />
            No screenshot
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-foreground">{elementLabel(payload)}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground" title={t.selector}>
            {t.selector} · {Math.round(t.rectViewport.width)}×{Math.round(t.rectViewport.height)}
          </div>
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onKey}
          placeholder="What should change here?"
          maxLength={GRAB_BUDGET.noteMaxLength}
          className="h-16 min-h-0 resize-none text-sm"
          aria-label="Note for the agent"
          autoFocus
        />
        <div className={`truncate text-xs ${target.kind === 'none' || error ? 'text-destructive' : 'text-muted-foreground'}`} role={error ? 'alert' : undefined}>
          {error ?? (target.kind === 'none' ? `Can't send: ${target.reason}` : `To ${target.title}${target.kind === 'mission' ? ' (mission reply)' : ''}`)}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={() => design.start(id)} title="Drop this pick and choose another element">
            <RotateCcw />
            Pick another
          </Button>
          <Button size="xs" variant="outline" onClick={() => void onCopy()} title="Copy the write-up instead of sending it">
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="xs" disabled={!ready} onClick={() => void send()}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Send
            <span className="ml-0.5 inline-flex items-center gap-0.5 rounded border border-white/20 px-1 text-[10px] leading-4 opacity-80">
              {isMac ? '⌘' : 'Ctrl'}
              <CornerDownLeft className="size-2.5" />
            </span>
          </Button>
        </div>
      </div>
      <Button size="icon-xs" variant="ghost" onClick={() => design.stop(id)} aria-label="Leave Design Mode">
        <X />
      </Button>
    </div>
  )
}

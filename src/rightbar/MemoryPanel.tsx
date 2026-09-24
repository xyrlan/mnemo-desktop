// adapted from stablyai/orca components/right-sidebar/local-workspace-ports-panel.tsx and local-port-row.tsx
import React, { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { BookOpen, Brain, Check, History, Inbox, LoaderCircle, RefreshCw, ShieldX, Sparkles, X, Zap } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import type { MemoryFeed } from '../memory/types'
import { Section } from './Section'
import { ago, type MemoryStore, type MemoryTarget } from './memory'

/** How often the panel reads again while it is on screen: a rule can fire at any moment. */
export const REFRESH_MS = 30_000

type Fired = MemoryFeed['fired'][number]
type InboxItem = MemoryFeed['inbox'][number]

const SOURCE: Record<Fired['source'], { label: string; icon: typeof Zap }> = {
  reflex: { label: 'injected by a hook', icon: Zap },
  mcp: { label: 'read by the agent', icon: BookOpen },
  denial: { label: 'blocked a tool call', icon: ShieldX },
}

type SectionId = 'briefing' | 'fired' | 'learned' | 'inbox'

/** The Memory panel: for the worktree and session in `target`, the last session's briefing, the
 *  rules that fired, what mnemo learned in the project, and its inbox with keep and drop. It
 *  reads again when `target` or `stamp` changes (the live panel passes the focused agent's last
 *  change), every {@link REFRESH_MS}, and on the refresh button. It never opens a pane. */
export function MemoryPanel({ store, target, stamp }: { store: MemoryStore; target: MemoryTarget | null; stamp?: unknown }): React.JSX.Element {
  const { feed, loading, error, deciding, failed } = useStore(store)
  const [collapsed, setCollapsed] = useState<Partial<Record<SectionId, boolean>>>({})
  const [now, setNow] = useState(() => Date.now())

  const cwd = target?.cwd ?? null
  const sessionId = target?.sessionId ?? null
  useEffect(() => {
    void store.getState().show(cwd === null ? null : { cwd, sessionId })
  }, [store, cwd, sessionId])

  const first = React.useRef(true)
  useEffect(() => {
    if (first.current) return void (first.current = false)
    void store.getState().refresh()
  }, [store, stamp])

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now())
      void store.getState().refresh()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [store])
  // The ages count from the read they came with.
  useEffect(() => setNow(Date.now()), [feed])

  const toggle = (id: SectionId) => setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  if (!target) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
        <Brain size={32} className="mb-3 opacity-50" />
        <p className="text-sm">No workspace selected</p>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-full flex-col overflow-y-auto scrollbar-sleek" data-memory-panel data-ui>
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Memory</span>
            {feed && <span className="truncate text-[11px] text-muted-foreground/70">{feed.project}</span>}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void store.getState().refresh()}
                disabled={loading}
                aria-label="Refresh memory"
              >
                <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              Refresh memory
            </TooltipContent>
          </Tooltip>
        </div>

        {error && (
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground" role="status">
            <Brain size={32} className="mb-3 opacity-50" />
            <p className="text-sm">No memory to show here</p>
            <p className="mt-1 text-xs text-muted-foreground/70">{error}</p>
          </div>
        )}

        {!feed && !error && loading && <div className="px-3 py-2 text-xs text-muted-foreground">Reading memory…</div>}

        {feed && (
          <div className="pb-3">
            <Section id="briefing" title="Last session" count={feed.briefing ? 1 : 0} counted={false} emptyText="No briefing yet" collapsed={!!collapsed.briefing} onToggle={() => toggle('briefing')}>
              {feed.briefing && <Briefing briefing={feed.briefing} />}
            </Section>
            <Section
              id="fired"
              title={sessionId ? 'Fired in this session' : 'Fired lately'}
              count={feed.fired.length}
              emptyText={sessionId ? 'No rule has fired in this session' : 'No rule has fired yet'}
              collapsed={!!collapsed.fired}
              onToggle={() => toggle('fired')}
            >
              {feed.fired.map((f) => (
                <FiredRow key={`${f.slug}:${f.source}`} fired={f} now={now} />
              ))}
            </Section>
            <Section id="learned" title="Learned in this project" count={feed.learned.length} emptyText="Nothing learned yet" collapsed={!!collapsed.learned} onToggle={() => toggle('learned')}>
              {feed.learned.map((l) => (
                <Row key={l.slug} icon={Sparkles} title={l.name} detail={l.slug} age={ago(l.at, now)} />
              ))}
            </Section>
            <Section id="inbox" title="Inbox" count={feed.inbox.length} emptyText="Inbox is empty" collapsed={!!collapsed.inbox} onToggle={() => toggle('inbox')}>
              {feed.inbox.map((i) => (
                <InboxRow
                  key={i.key}
                  item={i}
                  deciding={deciding[i.key]}
                  failed={failed[i.key]}
                  onDecide={(how) => void store.getState().decide(i.key, how)}
                />
              ))}
            </Section>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

function Briefing({ briefing }: { briefing: NonNullable<MemoryFeed['briefing']> }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <button
      type="button"
      className="mb-1 w-full rounded-md border border-border/60 px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      data-briefing
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <History size={12} className="shrink-0" />
        {briefing.date && <span>{briefing.date}</span>}
        <span className="truncate font-mono text-muted-foreground/70">{briefing.sessionId.slice(0, 8)}</span>
      </div>
      <p className={cn('mt-1 whitespace-pre-wrap text-xs text-foreground/90', !open && 'line-clamp-4')}>{briefing.tldr || 'No summary in this briefing.'}</p>
    </button>
  )
}

function Row({ icon: Icon, title, detail, age }: { icon: typeof Zap; title: string; detail: string; age: string }): React.JSX.Element {
  return (
    <div className="-mx-1 flex items-center gap-2 rounded px-1 py-1 transition-colors hover:bg-accent/50" data-row>
      <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{title}</div>
        <div className="truncate text-[10px] text-muted-foreground/70">{detail}</div>
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{age}</span>
    </div>
  )
}

function FiredRow({ fired, now }: { fired: Fired; now: number }): React.JSX.Element {
  const s = SOURCE[fired.source] ?? SOURCE.reflex
  return <Row icon={s.icon} title={fired.name} detail={s.label} age={ago(fired.at, now)} />
}

function InboxRow({
  item,
  deciding,
  failed,
  onDecide,
}: {
  item: InboxItem
  deciding?: 'keep' | 'drop'
  failed?: string
  onDecide: (how: 'keep' | 'drop') => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const busy = deciding !== undefined
  return (
    <div className="group -mx-1 flex items-start gap-2 rounded px-1 py-1.5 transition-colors hover:bg-accent/50" data-inbox={item.key}>
      <div className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
        <Inbox size={13} />
      </div>
      <button type="button" className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="truncate text-xs font-medium text-foreground">{item.title}</div>
        <div className="truncate text-[10px] text-muted-foreground/70">{item.type}</div>
        {item.excerpt && <p className={cn('mt-0.5 whitespace-pre-wrap text-[11px] text-muted-foreground', !open && 'line-clamp-2')}>{item.excerpt}</p>}
        {failed && (
          <p className="mt-0.5 text-[11px] text-destructive" role="alert">
            {failed}
          </p>
        )}
      </button>
      <div className={cn('flex items-center gap-0.5 transition-opacity', busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100')}>
        {busy ? (
          <LoaderCircle size={13} className="m-1.5 animate-spin text-muted-foreground" aria-label={deciding === 'keep' ? 'Keeping' : 'Dropping'} />
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground" onClick={() => onDecide('keep')} aria-label={`Keep ${item.title}`}>
                  <Check size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                Keep: promote it to the vault
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive" onClick={() => onDecide('drop')} aria-label={`Drop ${item.title}`}>
                  <X size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                Drop
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  )
}

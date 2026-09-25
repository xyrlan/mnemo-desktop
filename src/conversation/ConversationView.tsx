// the look adapted from stablyai/orca src/renderer/src/components/native-chat/
// NativeChatMessageList.tsx, NativeChatTurnActivityLine.tsx and NativeChatEmptyState.tsx
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { ArrowDown, GitPullRequest, LoaderCircle, MessageSquare, SquareTerminal, TriangleAlert } from 'lucide-react'
import { tauriConversation, type ConversationClient } from './client'
import type { Conversation, ImageRef, SessionStatus, StatusMarker, TranscriptRecord } from './types'
import { deriveConversation } from './parse'
import { clockText, firstIndex, lastPromptAt, pendingCard, SOLO_TOOLS, streamItems, workingSince, type Item, type ToolCard } from './stream'
import { describeCall } from './run'
import { useFollow } from './useFollow'
import { CardsContext, RuleActionsContext, type CardsState, type Veto } from './cards/context'
import { CardView, OutgoingView, Separator } from './cards'
import { ToolRun } from './cards/ToolRun'
import { Lightbox } from './cards/image'
import { ContextRing } from './ContextRing'
import { Foot, type Parked } from './Foot'
import type { ChatAgent } from './agent'
import { showsAsSent, unsettled, type Outgoing } from './outbox'
import { openUrl } from '../github/actions'
import './conversation.css'

export type { ChatAgent } from './agent'

export type ConversationViewProps = {
  /** The session to follow. When it changes (a `/clear` in the pane), what was shown stays above
   *  a `/clear` divider and the new session continues below. `null`: no session yet. */
  sessionId: string | null
  /** Where the session runs; the transcript lives under this cwd's project dir. */
  cwd: string
  /** From `claude agents` / the mission snapshot: drives the working line and the pending card
   *  (a tool call with no result while `waiting` is set). */
  status?: SessionStatus
  /** Thin lines merged into the stream by time (a child's status transitions). */
  markers?: StatusMarker[]
  /** Pinned under the stream, under the foot when there is one. A function is given what the
   *  session is parked on as the transcript says, so it can say what the foot's card cannot
   *  (a child's "don't ask again"), or answer what the foot has no card for. */
  footer?: ReactNode | ((parked: Parked) => ReactNode)
  /** The pending card's button: a pane flips to its terminal face, a child opens `claude attach`. */
  onOpenTerminal?: () => void
  /** How to answer the session from the chat. Given, the foot shows the approval or question
   *  card while the session waits on one, else the composer. */
  agent?: ChatAgent
  client?: ConversationClient
}

/** Virtuoso's index of the first row; lowered as earlier rows are prepended, and far enough from
 *  zero that no transcript reaches it. */
const BASE = 1_000_000
const NO_MARKERS: StatusMarker[] = []

/** Derivations of each records array, so a new line re-derives only its own segment. */
const derived = new WeakMap<TranscriptRecord[], Conversation>()
function derive(records: TranscriptRecord[]): Conversation {
  let c = derived.get(records)
  if (!c) derived.set(records, (c = deriveConversation(records)))
  return c
}

/** What the live turn is doing, in words, when the transcript can say and nothing above the
 *  line already does: thinking, the agent it waits for, a question or plan it is writing. A
 *  call in a run is named by the live run itself. */
export function activityOf(c: Conversation | null): string | null {
  if (!c) return null
  if (c.thinkingAt) return 'Thinking…'
  const last = c.cards.at(-1)
  if (last?.kind === 'agent' && last.report === null) return `Waiting for agent · ${last.description}`
  if (last?.kind === 'tool' && last.outcome === null && SOLO_TOOLS.has(last.name)) return describeCall(last)
  return null
}

/** The live turn's one indicator: a spinner, what it is doing, and how long it has been at it. */
function Working({ since, activity }: { since: number; activity: string | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="cv-working mx-auto flex min-h-6 w-full max-w-4xl items-center gap-1.5 px-4 pt-1 pb-4 text-sm leading-relaxed text-muted-foreground" role="status" aria-live="polite">
      <LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
      <span className="min-w-0 truncate text-foreground/85">{activity ?? 'Working…'}</span>
      <span className="ml-auto shrink-0 tabular-nums">{clockText(now - since)}</span>
    </div>
  )
}

type ListContext = {
  working: { since: number; activity: string | null } | null
  top: { loading: boolean; error: string | null; atTop: boolean; retry: () => void } | null
}

const THIN = 'cv-thin mx-auto flex w-full max-w-4xl justify-center px-4 py-2 text-xs text-muted-foreground'

function ListHeader({ context }: { context?: ListContext }) {
  const top = context?.top
  if (!top) return <div className="h-4" />
  if (top.loading) return <div className={THIN}>Loading earlier…</div>
  if (top.error)
    return (
      <div className={`${THIN} cv-err gap-1 text-destructive`}>
        Could not load earlier lines: {top.error}
        <button type="button" className="cv-link underline-offset-2 hover:underline" onClick={top.retry}>
          Retry
        </button>
      </div>
    )
  return top.atTop ? <div className={THIN}>Start of the session</div> : <div className={THIN}>Scroll up for earlier</div>
}

function ListFooter({ context }: { context?: ListContext }) {
  return context?.working ? <Working since={context.working.since} activity={context.working.activity} /> : <div className="cv-end h-4" />
}

const COMPONENTS = { Header: ListHeader, Footer: ListFooter }

function Row({ item, busy, onEarlier }: { item: Item; busy: boolean; onEarlier: (segment: number) => void }) {
  switch (item.kind) {
    case 'card':
      return <CardView card={item.card} pending={item.pending} k={item.key} />
    case 'run':
      return <ToolRun item={item} busy={busy} />
    case 'clear':
      return <Separator label="/clear" className="cv-clear font-mono" />
    case 'marker':
      return (
        <div className="cv-marker flex items-center gap-1.5 text-xs text-muted-foreground" title={item.carried ? `since ${item.marker.at}` : item.marker.at}>
          <span className="size-1.5 shrink-0 rounded-full bg-state-needs-you" aria-hidden />
          <span className="min-w-0 truncate">{item.marker.label}</span>
          {item.carried && <span className="cv-carried shrink-0 opacity-70">(since earlier)</span>}
        </div>
      )
    case 'earlier':
      return (
        <div className="flex justify-center">
          {item.loading ? (
            <span className="text-xs text-muted-foreground">Loading…</span>
          ) : (
            <button type="button" className="cv-link rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={() => onEarlier(item.segment)}>
              Load earlier messages
            </button>
          )}
        </div>
      )
    case 'note':
      return <div className="cv-note py-4 text-center text-xs text-muted-foreground">{item.text}</div>
    case 'outgoing':
      return <OutgoingView out={item.out} />
  }
}

/** A chat with nothing in it yet, or that could not start: an icon, a title, a line. */
export function EmptyState({ title, subtitle, error, children }: { title: string; subtitle?: ReactNode; error?: boolean; children?: ReactNode }) {
  return (
    <div className="cv-empty flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className={error ? 'flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive' : 'flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground'}>
        {error ? <TriangleAlert className="size-6" aria-hidden /> : <MessageSquare className="size-6" aria-hidden />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {subtitle && <p className="max-w-sm text-xs text-balance text-muted-foreground">{subtitle}</p>}
      {children}
    </div>
  )
}

/** When the working line started, per `workingSince`. What it remembers moves only when
 *  `busy` flips, so a re-render never moves the start. */
function useWorkingSince(busy: boolean, prompt: string | null): number | null {
  const seen = useRef<{ busy: boolean; at: number; idleAt: number | null } | null>(null)
  if (seen.current?.busy !== busy) {
    const at = Date.now()
    // Flipping to busy, it was idle until just now; opening busy, it was never seen idle.
    seen.current = { busy, at, idleAt: busy && seen.current ? at : null }
  }
  return busy ? workingSince(prompt, seen.current.idleAt, seen.current.at) : null
}

const NOTHING_OUT: Outgoing[] = []

/** What the chat sent and the transcript has not recorded yet (`outbox.ts`), and `agent` with its
 *  sends going through it: a message shows the moment it is sent, is marked if it fails, and
 *  gives way to its record once the follow reads that. */
function useOutbox(agent: ChatAgent | undefined, conversations: Conversation[]) {
  const [out, setOut] = useState<Outgoing[]>(NOTHING_OUT)
  const seq = useRef(0)
  const segments = useMemo(() => conversations.map((c) => c.cards), [conversations])
  const shown = useMemo(() => unsettled(out, segments), [out, segments])
  // Forget what settled; a message added since this render is kept.
  useEffect(() => {
    if (shown === out) return
    const keep = new Set(shown.map((o) => o.id))
    const seen = new Set(out.map((o) => o.id))
    setOut((all) => all.filter((o) => keep.has(o.id) || !seen.has(o.id)))
  }, [shown, out])

  const post = useCallback(async (kind: Outgoing['kind'], text: string, deliver: () => Promise<void>) => {
    if (!showsAsSent(kind, text)) return deliver()
    const id = ++seq.current
    const mark = (o: Partial<Outgoing>) => setOut((all) => all.map((x) => (x.id === id ? { ...x, ...o } : x)))
    setOut((all) => [...all.filter((o) => o.state !== 'failed'), { id, kind, text, at: Date.now(), state: 'sending' }])
    try {
      await deliver()
    } catch (e) {
      mark({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
      throw e
    }
    mark({ state: 'sent' })
  }, [])

  const sender = useMemo<ChatAgent | undefined>(() => {
    if (!agent) return undefined
    const bash = agent.bash
    return {
      ...agent,
      send: (text) => post('prompt', text, () => agent.send(text)),
      bash: bash && ((command) => post('bash', command, () => bash(command))),
    }
  }, [agent, post])
  return { shown, sender }
}

/** A Claude Code session's transcript as Orca's native chat: followed live from the last `TAIL`
 *  lines, earlier ones read on scroll-up, in a virtualised list that stays at the bottom while
 *  you are there; the foot answers it when there is an `agent` to answer through. */
export function ConversationView({ sessionId, cwd, status, markers = NO_MARKERS, footer, onOpenTerminal, agent, client = tauriConversation }: ConversationViewProps) {
  const { segments, loadEarlier } = useFollow(client, sessionId, cwd)
  const conversations = useMemo(() => segments.map((s) => derive(s.records)), [segments])
  const { shown, sender } = useOutbox(agent, conversations)
  const stream = useMemo(() => streamItems(segments, conversations, markers, status), [segments, conversations, markers, status])
  const items = useMemo<Item[]>(() => (shown.length ? [...stream, ...shown.map((out): Item => ({ kind: 'outgoing', key: `out:${out.id}`, out }))] : stream), [stream, shown])
  const current = conversations.at(-1) ?? null
  const busy = !!status?.busy
  const since = useWorkingSince(busy, current ? lastPromptAt(current.cards) : null)

  // Keep the rows on screen still when earlier ones are put above them.
  const prev = useRef<{ items: Item[]; first: number } | null>(null)
  const first = prev.current?.items === items ? prev.current.first : firstIndex(prev.current, items, BASE)
  useEffect(() => void (prev.current = { items, first }), [items, first])

  // "Jump to latest": rows arrived at the bottom while you were reading above it.
  const list = useRef<VirtuosoHandle>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [fresh, setFresh] = useState(false)
  const lastKey = items.at(-1)?.key
  const seenLast = useRef(lastKey)
  useEffect(() => {
    if (lastKey !== seenLast.current && !atBottom) setFresh(true)
    seenLast.current = lastKey
  }, [lastKey, atBottom])
  useEffect(() => {
    if (atBottom) setFresh(false)
  }, [atBottom])
  // The list follows new rows at the bottom, not its own viewport shrinking: when the foot grows
  // (a reason under the composer, an approval card), what was at the bottom stays in view.
  const streamRef = useRef<HTMLDivElement>(null)
  const bottom = useRef(atBottom)
  bottom.current = atBottom
  useEffect(() => {
    const el = streamRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (bottom.current) list.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // What you just sent is where you look next, even from up the stream.
  const newest = shown.at(-1)?.id
  useEffect(() => {
    if (newest !== undefined) list.current?.scrollToIndex({ index: 'LAST', align: 'end' })
  }, [newest])

  const rules = useContext(RuleActionsContext)
  const [vetoes, setVetoes] = useState<Record<string, Veto>>({})
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [image, setImage] = useState<ImageRef | null>(null)
  const cards = useMemo<CardsState>(
    () => ({
      rules,
      vetoes,
      veto(slug) {
        setVetoes((v) => ({ ...v, [slug]: { state: 'running' } }))
        rules
          .veto(slug)
          .then((r): Veto => (r.code === 0 ? { state: 'disabled' } : { state: 'failed', message: (r.stderr || r.stdout).trim() || `exit ${r.code}` }))
          .catch((e): Veto => ({ state: 'failed', message: String(e) }))
          .then((res) => setVetoes((v) => ({ ...v, [slug]: res })))
      },
      // A toggle flips the fold from however it opens by default.
      isOpen: (key, dflt = false) => open.has(key) !== dflt,
      toggle: (key) =>
        setOpen((o) => {
          const n = new Set(o)
          if (!n.delete(key)) n.add(key)
          return n
        }),
      openImage: setImage,
      onOpenTerminal,
      foot: !!agent,
      cwd,
    }),
    [rules, vetoes, open, onOpenTerminal, agent, cwd],
  )

  const top = segments[0]
  const retryTop = useCallback(() => top && loadEarlier(top.key), [top, loadEarlier])
  const activity = busy ? activityOf(current) : null
  const context = useMemo<ListContext>(
    () => ({
      working: since === null ? null : { since, activity },
      top: top && top.start !== null ? { loading: top.loadingEarlier, error: top.earlierError, atTop: top.start === 0, retry: retryTop } : null,
    }),
    [since, activity, top, retryTop],
  )
  const closeImage = useCallback(() => setImage(null), [])

  // The call the session is parked on, for the foot's card.
  const parked = useMemo<Parked>(() => {
    if (!current) return null
    const p = pendingCard(current.cards, status?.waiting ?? null)
    const tool = p && current.cards.find((c): c is ToolCard => c.id === p.id && c.kind === 'tool')
    return p && tool ? { tool, kind: p.kind } : null
  }, [current, status?.waiting])

  let body: ReactNode
  if (!segments.length)
    body = sessionId ? (
      <EmptyState title="Loading the conversation…" subtitle="Reading the session's transcript." />
    ) : (
      <EmptyState title="No Claude session yet" subtitle="Its conversation shows here once it starts." />
    )
  else if (segments.length === 1 && top.state === 'loading') body = <EmptyState title="Loading the conversation…" subtitle="Reading the session's transcript." />
  else
    body = (
      <Virtuoso
        ref={list}
        className="cv-list scrollbar-sleek h-full"
        data={items}
        context={context}
        components={COMPONENTS}
        firstItemIndex={first}
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        computeItemKey={(_, it) => it.key}
        itemContent={(_, it) => (
          // Padding, never margin: the list measures each row's box.
          <div className="cv-row mx-auto w-full max-w-4xl px-4 py-2">
            <Row item={it} busy={busy} onEarlier={loadEarlier} />
          </div>
        )}
        followOutput={(bottom) => (bottom ? 'auto' : false)}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={48}
        startReached={() => top && loadEarlier(top.key)}
        increaseViewportBy={{ top: 400, bottom: 400 }}
      />
    )

  const below = typeof footer === 'function' ? footer(parked) : footer
  const usage = current?.usage ?? null
  const terminal = agent && onOpenTerminal
  const head = current && (current.title || current.prs.length > 0 || usage)
  return (
    <CardsContext.Provider value={cards}>
      <div className="conversation relative flex min-h-0 flex-1 flex-col bg-background text-foreground" data-ui data-session={sessionId ?? undefined}>
        {(head || terminal) && (
          <div className="cv-head flex h-8 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3 text-xs text-muted-foreground">
            <span className="cv-title min-w-0 flex-1 truncate text-foreground" title={current?.title ?? undefined}>
              {current?.title}
            </span>
            {current?.prs.map((p) => (
              <button
                key={p.number}
                type="button"
                className="cv-pr flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-accent hover:text-foreground"
                title={p.url}
                onClick={() => openUrl(p.url, `#${p.number}`)}
              >
                <GitPullRequest className="size-3.5" aria-hidden />#{p.number}
              </button>
            ))}
            {usage && <ContextRing usage={usage} />}
            {terminal && (
              <button
                type="button"
                className="cv-to-terminal flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
                title="Back to the terminal (⌘⇧C)"
                aria-label="Back to the terminal"
                onClick={onOpenTerminal}
              >
                <SquareTerminal className="size-4" aria-hidden />
              </button>
            )}
          </div>
        )}
        <div ref={streamRef} className="cv-stream relative min-h-0 flex-1">
          {body}
          {fresh && (
            <button
              type="button"
              className="cv-new absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur hover:bg-accent hover:text-accent-foreground"
              onClick={() => list.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' })}
            >
              <ArrowDown className="size-3.5" aria-hidden />
              Jump to latest
            </button>
          )}
        </div>
        {sender && sessionId && <Foot agent={sender} cwd={cwd || null} status={status} parked={parked} onOpenTerminal={onOpenTerminal} />}
        {below && <div className="cv-footer shrink-0 border-t border-border">{below}</div>}
        {image && <Lightbox img={image} onClose={closeImage} />}
      </div>
    </CardsContext.Provider>
  )
}

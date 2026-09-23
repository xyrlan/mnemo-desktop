import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { tauriConversation, type ConversationClient } from './client'
import type { Conversation, ImageRef, SessionStatus, StatusMarker, TranscriptRecord } from './types'
import { deriveConversation } from './parse'
import { clockText, firstIndex, lastPromptAt, streamItems, workingSince, type Item } from './stream'
import { useFollow } from './useFollow'
import { CardsContext, RuleActionsContext, type CardsState, type Veto } from './cards/context'
import { CardView } from './cards'
import { Lightbox } from './cards/image'
import { openUrl } from '../github/actions'
import './conversation.css'

export type ConversationViewProps = {
  /** The session to follow. When it changes (a `/clear` in the pane), what was shown stays above
   *  a `── /clear ──` divider and the new session continues below. `null`: no session yet. */
  sessionId: string | null
  /** Where the session runs; the transcript lives under this cwd's project dir. */
  cwd: string
  /** From `claude agents` / the mission snapshot: drives the `working… 0:42` row and the pending
   *  card (a tool call with no result while `waiting` is set). */
  status?: SessionStatus
  /** Thin lines merged into the stream by time (a child's status transitions). */
  markers?: StatusMarker[]
  /** Pinned under the stream (a child's Approve / Deny / reply box). */
  footer?: ReactNode
  /** The pending card's button: a pane flips to its terminal face, a child opens `claude attach`. */
  onOpenTerminal?: () => void
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

/** `working… 0:42` while the session generates. */
function Working({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="cv-working" role="status">
      working… {clockText(now - since)}
    </div>
  )
}

type ListContext = { working: number | null; top: { loading: boolean; error: string | null; atTop: boolean; retry: () => void } | null }

function ListHeader({ context }: { context?: ListContext }) {
  const top = context?.top
  if (!top) return null
  if (top.loading) return <div className="cv-thin">loading earlier…</div>
  if (top.error)
    return (
      <div className="cv-thin cv-err">
        could not load earlier lines: {top.error}{' '}
        <button className="cv-link" onClick={top.retry}>
          retry
        </button>
      </div>
    )
  return top.atTop ? <div className="cv-thin">start of the session</div> : <div className="cv-thin">scroll up for earlier</div>
}

function ListFooter({ context }: { context?: ListContext }) {
  return context?.working != null ? <Working since={context.working} /> : <div className="cv-end" />
}

const COMPONENTS = { Header: ListHeader, Footer: ListFooter }

function Row({ item, onEarlier }: { item: Item; onEarlier: (segment: number) => void }) {
  switch (item.kind) {
    case 'card':
      return <CardView card={item.card} pending={item.pending} k={item.key} />
    case 'clear':
      return (
        <div className="cv-clear" role="separator">
          ── /clear ──
        </div>
      )
    case 'marker':
      return <div className="cv-thin cv-marker">{item.marker.label}</div>
    case 'earlier':
      return (
        <div className="cv-thin">
          {item.loading ? (
            'loading earlier…'
          ) : (
            <button className="cv-link" onClick={() => onEarlier(item.segment)}>
              load earlier
            </button>
          )}
        </div>
      )
    case 'note':
      return <div className="cv-note">{item.text}</div>
  }
}

/** When the `working…` row started, per `workingSince`. What it remembers moves only when
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

/** A Claude Code session's transcript as cards: followed live from the last `TAIL` lines, earlier
 *  ones read on scroll-up, in a virtualised list that stays at the bottom while you are there. */
export function ConversationView({ sessionId, cwd, status, markers = NO_MARKERS, footer, onOpenTerminal, client = tauriConversation }: ConversationViewProps) {
  const { segments, loadEarlier } = useFollow(client, sessionId, cwd)
  const conversations = useMemo(() => segments.map((s) => derive(s.records)), [segments])
  const items = useMemo(() => streamItems(segments, conversations, markers, status), [segments, conversations, markers, status])
  const current = conversations.at(-1) ?? null
  const since = useWorkingSince(!!status?.busy, current ? lastPromptAt(current.cards) : null)

  // Keep the rows on screen still when earlier ones are put above them.
  const prev = useRef<{ items: Item[]; first: number } | null>(null)
  const first = prev.current?.items === items ? prev.current.first : firstIndex(prev.current, items, BASE)
  useEffect(() => void (prev.current = { items, first }), [items, first])

  // "↓ new": rows arrived at the bottom while you were reading above it.
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
      isOpen: (key) => open.has(key),
      toggle: (key) =>
        setOpen((o) => {
          const n = new Set(o)
          if (!n.delete(key)) n.add(key)
          return n
        }),
      openImage: setImage,
      onOpenTerminal,
    }),
    [rules, vetoes, open, onOpenTerminal],
  )

  const top = segments[0]
  const retryTop = useCallback(() => top && loadEarlier(top.key), [top, loadEarlier])
  const context = useMemo<ListContext>(
    () => ({
      working: since,
      top: top && top.start !== null ? { loading: top.loadingEarlier, error: top.earlierError, atTop: top.start === 0, retry: retryTop } : null,
    }),
    [since, top, retryTop],
  )
  const closeImage = useCallback(() => setImage(null), [])

  let body: ReactNode
  if (!segments.length) body = <div className="cv-note">{sessionId ? 'loading…' : 'no Claude session yet'}</div>
  else if (segments.length === 1 && top.state === 'loading') body = <div className="cv-note">loading…</div>
  else
    body = (
      <Virtuoso
        ref={list}
        className="cv-list"
        data={items}
        context={context}
        components={COMPONENTS}
        firstItemIndex={first}
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        computeItemKey={(_, it) => it.key}
        itemContent={(_, it) => <Row item={it} onEarlier={loadEarlier} />}
        followOutput={(bottom) => (bottom ? 'auto' : false)}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={48}
        startReached={() => top && loadEarlier(top.key)}
        increaseViewportBy={{ top: 400, bottom: 400 }}
      />
    )

  return (
    <CardsContext.Provider value={cards}>
      <div className="conversation" data-session={sessionId ?? undefined}>
        {current && (current.title || current.prs.length > 0) && (
          <div className="cv-head">
            {current.title && <span className="cv-title">{current.title}</span>}
            {current.prs.map((p) => (
              <button key={p.number} className="cv-chip cv-pr" title={p.url} onClick={() => openUrl(p.url, `#${p.number}`)}>
                #{p.number}
              </button>
            ))}
          </div>
        )}
        <div className="cv-stream">
          {body}
          {fresh && (
            <button className="cv-new" onClick={() => list.current?.scrollToIndex({ index: 'LAST', behavior: 'smooth' })}>
              ↓ new
            </button>
          )}
        </div>
        {footer && <div className="cv-footer">{footer}</div>}
        {image && <Lightbox img={image} onClose={closeImage} />}
      </div>
    </CardsContext.Provider>
  )
}

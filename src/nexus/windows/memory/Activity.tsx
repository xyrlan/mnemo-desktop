import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { getMemoryFeed } from '../../../memory/client'
import type { MemoryFeed } from '../../../memory/types'
import { learnedClient } from '../../../learned/app-store'
import { ago, createMemoryStore, sameTarget, type MemoryStore } from '../../../rightbar/memory'
import { pollWhileShown } from '../../../shell/while-shown'
import { ErrorText, Loading, Quiet } from './kit'

/** How often the feed is read again while it is on screen: a rule can fire at any moment. */
export const REFRESH_MS = 30_000

/** The feed the right sidebar's Memory panel reads, for the repo the window is on. Its own
 *  store: what it read survives the window closing and opening. */
export const memoryFeed: MemoryStore = createMemoryStore({
  feed: getMemoryFeed,
  project: (cwd) => learnedClient.project(cwd),
  step: (step, target, keys) => learnedClient.step(step, target, keys),
})

type Fired = MemoryFeed['fired'][number]

const SOURCE: Record<Fired['source'], string> = {
  reflex: 'injected by a hook',
  mcp: 'read by the agent',
  denial: 'blocked a tool call',
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="nx-mem-section">
      <h3 className="nx-section">
        {title}
        {count !== undefined && <span className="nx-muted"> {count}</span>}
      </h3>
      {children}
    </section>
  )
}

function Line({ title, detail, age }: { title: string; detail: string; age: string }) {
  return (
    <div className="nx-row" data-line="">
      <span className="nx-mem-grow">
        <span className="nx-mem-name">{title}</span>
        <span className="nx-muted nx-mem-sub">{detail}</span>
      </span>
      <span className="nx-muted">{age}</span>
    </div>
  )
}

/** For the repo `cwd` is: the last session's briefing, the rules that fired lately, what mnemo
 *  learned there, and how many pages wait in its inbox. */
export function Activity({ cwd, store = memoryFeed, onRead, onInbox }: { cwd: string | null; store?: MemoryStore; onRead(path: string): void; onInbox(): void }): JSX.Element {
  const { feed, loading, error } = useStore(store)
  const [now, setNow] = useState(() => Date.now())
  const [open, setOpen] = useState(false)

  // A window opened again on the repo it last read reads it again, rather than wait for the poll.
  useEffect(() => {
    const target = cwd === null ? null : { cwd, sessionId: null }
    const s = store.getState()
    void (sameTarget(s.target, target) ? s.refresh() : s.show(target))
  }, [store, cwd])
  useEffect(
    () =>
      pollWhileShown(
        () => {
          setNow(Date.now())
          return store.getState().refresh()
        },
        REFRESH_MS,
        { wait: true },
      ),
    [store],
  )
  // The ages count from the read they came with.
  useEffect(() => setNow(Date.now()), [feed])

  if (cwd === null) return <Quiet>No repo open: memory is read for one repo at a time.</Quiet>
  if (error) return <ErrorText text={`No memory to show here: ${error}`} />
  if (!feed) return loading ? <Loading>reading memory…</Loading> : <Quiet>Nothing read yet.</Quiet>

  const b = feed.briefing
  return (
    <div className="nx-mem-activity">
      <div className="nx-mem-bar">
        <span className="nx-muted nx-mem-grow">mnemo knows this repo as {feed.project}</span>
        <button type="button" className="nx-btn" disabled={loading} title="Read memory again" onClick={() => void store.getState().refresh()}>
          {loading ? '↻…' : '↻'}
        </button>
      </div>
      <Section title="Last session">
        {b ? (
          <div className="nx-row nx-mem-briefing" data-briefing="">
            <span className="nx-mem-grow">
              <span className="nx-muted">
                {b.date} {b.sessionId.slice(0, 8)}
              </span>
              <button type="button" className="nx-mem-tldr" aria-expanded={open} data-open={open || undefined} onClick={() => setOpen(!open)}>
                {b.tldr || 'No summary in this briefing.'}
              </button>
            </span>
            {b.path && (
              <button type="button" className="nx-btn" title="Read the whole briefing" onClick={() => onRead(b.path)}>
                Read
              </button>
            )}
          </div>
        ) : (
          <Quiet>No briefing yet.</Quiet>
        )}
      </Section>
      <Section title="Fired lately" count={feed.fired.length}>
        {feed.fired.length ? feed.fired.map((f) => <Line key={`${f.slug}:${f.source}`} title={f.name} detail={SOURCE[f.source] ?? SOURCE.reflex} age={ago(f.at, now)} />) : <Quiet>No rule has fired yet.</Quiet>}
      </Section>
      <Section title="Learned in this project" count={feed.learned.length}>
        {feed.learned.length ? feed.learned.map((l) => <Line key={l.slug} title={l.name} detail={l.slug} age={ago(l.at, now)} />) : <Quiet>Nothing learned yet.</Quiet>}
      </Section>
      <Section title="Inbox" count={feed.inbox.length}>
        <div className="nx-row">
          <span className="nx-mem-grow">{feed.inbox.length ? `${feed.inbox.length} staged ${feed.inbox.length === 1 ? 'page waits' : 'pages wait'} for a decision.` : 'Inbox is empty.'}</span>
          {feed.inbox.length > 0 && (
            <button type="button" className="nx-btn" onClick={onInbox}>
              Review
            </button>
          )}
        </div>
      </Section>
    </div>
  )
}

// What mnemo did lately in the repo the panel is on: the last session's briefing, the rules it
// gave, what it learned there, what waits in the inbox.

import { useEffect, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { MemoryFeed } from '../../memory/types'
import { ago, sameTarget } from '../../rightbar/memory'
import { pollWhileShown } from '../../shell/while-shown'
import { Btn, Loading, Notice, Quiet, Section } from './kit'
import { memoryFeed, readPage, REFRESH_MS, showTab } from './state'

type Fired = MemoryFeed['fired'][number]

const SOURCE: Record<Fired['source'], string> = {
  reflex: 'given by a hook',
  mcp: 'read by the session',
  denial: 'blocked a tool call',
}

/** How many inbox pages the tab names before it sends to the Inbox. */
const INBOX_SHOWN = 4

function Figure({ value, label, tone }: { value: number; label: string; tone?: 'memory' | 'need' }) {
  return (
    <div className="memory-figure" data-tone={value > 0 ? tone : undefined}>
      <span className="memory-figure-value mn-num">{value}</span>
      <span className="mn-label">{label}</span>
    </div>
  )
}

function Line({ mark, title, detail, age }: { mark: ReactNode; title: string; detail: string; age: string }) {
  return (
    <div className="memory-line" data-line="">
      <span className="memory-line-mark" aria-hidden="true">
        {mark}
      </span>
      <span className="sp-grow">
        <span className="sp-name">{title}</span>
        <span className="sp-dim memory-sub">{detail}</span>
      </span>
      <span className="sp-dim mn-num">{age}</span>
    </div>
  )
}

/** For the repo at `cwd`; null with no repo known. */
export function Activity({ cwd }: { cwd: string | null }) {
  const store = memoryFeed
  const { feed, loading, error } = useStore(store)
  const [now, setNow] = useState(() => Date.now())
  const [open, setOpen] = useState(false)

  // A panel opened again on the repo it last read reads it again, rather than wait for the poll.
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

  if (cwd === null) return <Quiet>No repo known yet: memory is read for one repo at a time. Add one in Projects.</Quiet>
  if (error) return <Notice tone="bad" text={`No memory to show here: ${error}`} />
  if (!feed) return loading ? <Loading>reading memory…</Loading> : <Quiet>Nothing read yet.</Quiet>

  const b = feed.briefing
  return (
    <div className="memory-activity">
      <div className="memory-figures">
        <Figure value={feed.fired.length} label="given lately" tone="memory" />
        <Figure value={feed.learned.length} label="learned here" tone="memory" />
        <Figure value={feed.inbox.length} label="wait in the inbox" tone="need" />
        <span className="sp-end memory-known">
          <span className="sp-dim">
            mnemo knows this repo as <b>{feed.project}</b>
          </span>
          <Btn small disabled={loading} onClick={() => void store.getState().refresh()}>
            {loading ? 'Reading…' : 'Read again'}
          </Btn>
        </span>
      </div>
      <div className="memory-columns">
        <div className="memory-column">
          <Section title="Last session">
            {b ? (
              <div className="memory-briefing" data-briefing="">
                <div className="sp-row">
                  <span className="sp-dim mn-num">
                    {b.date} · {b.sessionId.slice(0, 8)}
                  </span>
                  {b.path && (
                    <Btn small className="sp-end" onClick={() => readPage(b.path)}>
                      Read it whole
                    </Btn>
                  )}
                </div>
                <button type="button" className="memory-tldr" aria-expanded={open} onClick={() => setOpen(!open)}>
                  {b.tldr || 'No summary in this briefing.'}
                </button>
              </div>
            ) : (
              <Quiet>No briefing yet.</Quiet>
            )}
          </Section>
          <Section
            title="Inbox"
            count={feed.inbox.length}
            aside={
              feed.inbox.length > 0 && (
                <Btn small tone="go" onClick={() => showTab('inbox')}>
                  Review
                </Btn>
              )
            }
          >
            {feed.inbox.length ? (
              <>
                {feed.inbox.slice(0, INBOX_SHOWN).map((i) => (
                  <Line key={i.key} mark="◇" title={i.title} detail={i.type} age="" />
                ))}
                {feed.inbox.length > INBOX_SHOWN && <Quiet>and {feed.inbox.length - INBOX_SHOWN} more.</Quiet>}
              </>
            ) : (
              <Quiet>Nothing waits for a decision.</Quiet>
            )}
          </Section>
        </div>
        <div className="memory-column">
          <Section title="Given lately" count={feed.fired.length}>
            {feed.fired.length ? (
              feed.fired.map((f) => <Line key={`${f.slug}:${f.source}`} mark={<i className="memory-dot" />} title={f.name} detail={SOURCE[f.source] ?? SOURCE.reflex} age={ago(f.at, now)} />)
            ) : (
              <Quiet>No rule has been given yet.</Quiet>
            )}
          </Section>
          <Section title="Learned here" count={feed.learned.length}>
            {feed.learned.length ? feed.learned.map((l) => <Line key={l.slug} mark="+" title={l.name} detail={l.slug} age={ago(l.at, now)} />) : <Quiet>Nothing learned yet.</Quiet>}
          </Section>
        </div>
      </div>
    </div>
  )
}

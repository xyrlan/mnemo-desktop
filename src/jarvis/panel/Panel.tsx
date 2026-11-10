import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from 'zustand'
import { Kbd, Label, StateMark } from '../../ds'
import { useOverlayRoot } from '../../notify/overlay'
import type { SessionState } from '../../world/types'
import type { BrainConfig, Research } from '../client'
import type { Jarvis } from '../loop'
import type { ParentState } from '../parent'
import { approvals, unended, type JarvisStore, type Line, type Parent, type ResearchRun, type Setup } from '../store'
import { alive, presenceHosts, presenceOf } from './james'
import { JamesOrb } from './Orb'
import { Presence } from './Presence'
import './panel.css'

type Props = {
  store: JarvisStore
  jarvis: Pick<Jarvis, 'ask' | 'answer' | 'ensure' | 'openUrl'>
  /** `jarvis.toggle`'s chord, shown on his presence; none while it has no chord. */
  shortcut?: string
}

const GB = 1024 ** 3
const gb = (n: number) => `${(n / GB).toFixed(n < 10 * GB ? 1 : 0)} GB`
const fileName = (f: string) => f.split(/[\\/]/).pop() ?? f

/** One line on what the model is doing, for the bar. */
function setupWord(s: Setup): string {
  switch (s.kind) {
    case 'idle':
      return 'model not started'
    case 'download':
      return `downloading ${s.total ? Math.floor((s.done / s.total) * 100) : 0}%`
    case 'verifying':
      return 'checking the model'
    case 'starting':
      return 'starting the model'
    case 'ready':
      return s.vision ? 'ready · sees the screen' : 'ready'
    case 'error':
      return 'model failed'
  }
}

/** Who answers, for the bar: Claude and its model, or the local model's state. */
const brainWord = (brain: BrainConfig | null, setup: Setup) => (brain?.kind === 'claude' ? `claude · ${brain.model}` : setupWord(setup))

const STATE: Record<ParentState, string> = {
  starting: 'starting',
  working: 'working',
  idle: 'turn ended',
  asking: 'asking',
  approval: 'needs approval',
  exited: 'exited',
}

/** A parent is a session: the shape and hue of the state it is in. */
const PARENT_SIGN: Record<ParentState, SessionState> = { starting: 'working', working: 'working', idle: 'idle', asking: 'need', approval: 'need', exited: 'ended' }

/** A state's shape, beside a word of the panel's own: the mark's own word stays unread. */
function Sign({ state }: { state: SessionState }) {
  return (
    <span className="jv-sign" aria-hidden="true">
      <StateMark state={state} />
    </span>
  )
}

function SetupCard({ setup, onStart }: { setup: Setup; onStart(): void }) {
  if (setup.kind === 'ready') return null
  if (setup.kind === 'idle')
    return (
      <div className="jv-setup" data-kind="idle">
        <p>The local model starts with the first request. The first time it downloads about 7 GB.</p>
        <button type="button" className="jv-btn" onClick={onStart}>
          Prepare now
        </button>
      </div>
    )
  if (setup.kind === 'error')
    return (
      <div className="jv-setup" data-kind="error" role="alert">
        <p>{setup.message}</p>
        <button type="button" className="jv-btn" onClick={onStart}>
          Try again
        </button>
      </div>
    )
  const share = setup.kind === 'download' && setup.total ? setup.done / setup.total : null
  return (
    <div className="jv-setup" data-kind={setup.kind} role="status">
      <p>
        {setup.kind === 'download'
          ? `Downloading ${fileName(setup.file)}: ${gb(setup.done)} of ${gb(setup.total)}`
          : setup.kind === 'verifying'
            ? `Checking ${fileName(setup.file)}`
            : 'Starting the model'}
      </p>
      <div className="jv-bar" data-indeterminate={share === null ? '' : undefined}>
        <div style={share === null ? undefined : { width: `${share * 100}%` }} />
      </div>
    </div>
  )
}

function Approval({ parent, onAnswer }: { parent: Parent; onAnswer(allow: boolean): void }) {
  return (
    <div className="jv-approval" data-session={parent.ref.sessionId}>
      <div className="jv-approval-head">
        <Sign state="need" />
        <span>
          <b>{parent.ref.project}</b> waits on your approval
        </span>
      </div>
      <p className="jv-approval-q">{parent.question}</p>
      <div className="jv-approval-actions">
        <button type="button" className="jv-btn" data-tone="bad" onClick={() => onAnswer(false)}>
          Deny
        </button>
        <button type="button" className="jv-btn" data-tone="good" onClick={() => onAnswer(true)}>
          Allow
        </button>
      </div>
    </div>
  )
}

const RESEARCH_STATE: Record<ResearchRun['state'], string> = {
  queued: 'queued',
  running: 'researching',
  done: 'done',
  failed: 'failed',
}

/** A research's state as a shape: a ring while it queues, the working dot, a triangle once it
 *  found its answer, a cross when it failed. */
const RESEARCH_SIGN: Record<ResearchRun['state'], SessionState> = { queued: 'idle', running: 'working', done: 'ready', failed: 'stalled' }

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** The pages a search rests on: each opens in the browser. */
function Sources({ sources, onOpen }: { sources: Research['sources']; onOpen(url: string): void }) {
  return (
    <ul className="jv-sources">
      {sources.map((s) => (
        <li key={s.url}>
          <button type="button" className="jv-source" title={s.url} onClick={() => onOpen(s.url)}>
            {s.title}
          </button>
          <span className="jv-source-host">{hostOf(s.url)}</span>
        </li>
      ))}
    </ul>
  )
}

const answerWord = (n: number) => (n === 0 ? 'Answer' : n === 1 ? 'Answer and 1 source' : `Answer and ${n} sources`)

/** A research James runs in the background (jarvis-research): its state, and once it ends what
 *  it found, whole, with its sources, or why it failed. `open`: the answer shown, not folded. */
function ResearchCard({ run, open, onOpen }: { run: ResearchRun; open: boolean; onOpen(url: string): void }) {
  const { result } = run
  return (
    <article className="jv-research" data-state={run.state} data-id={run.id}>
      <div className="jv-research-head">
        <Sign state={RESEARCH_SIGN[run.state]} />
        <span className="jv-research-state">{RESEARCH_STATE[run.state]}</span>
        <span className="jv-research-q" title={run.question}>
          {run.question}
        </span>
      </div>
      {run.state === 'running' && (
        <div className="jv-bar" data-indeterminate="">
          <div />
        </div>
      )}
      {result && (
        <>
          <p className="jv-research-summary">{result.summary}</p>
          <details className="jv-research-more" open={open}>
            <summary>{answerWord(result.sources.length)}</summary>
            <p className="jv-research-details">{result.details}</p>
            {result.sources.length > 0 && <Sources sources={result.sources} onOpen={onOpen} />}
          </details>
        </>
      )}
      {run.state === 'failed' && (
        <p className="jv-research-error" role="alert">
          {run.error}
        </p>
      )}
    </article>
  )
}

function LineRow({ line, onOpen }: { line: Line; onOpen(url: string): void }) {
  return (
    <li className="jv-line" data-who={line.who} data-error={line.who === 'note' && line.error ? '' : undefined}>
      {line.who === 'you' && <span className="jv-who">{line.spoken ? 'you (spoken)' : 'you'}</span>}
      {line.who === 'james' && <span className="jv-who">James</span>}
      {line.who === 'parent' && <span className="jv-who">{line.project}</span>}
      {line.who === 'web' ? (
        <>
          <span className="jv-who">sources · {line.text}</span>
          <Sources sources={line.sources} onOpen={onOpen} />
        </>
      ) : (
        <span className="jv-text">{line.text}</span>
      )}
    </li>
  )
}

/** James on screen (#505): the conversation, the model's setup, the parents Jarvis opened and an
 *  approval any of them waits on, his researches (jarvis-research), and a field to type to him.
 *  Docked on the right, over whatever front is mounted and under a Nexus window.
 *
 *  Closed, it is nothing where a top bar has his presence (`JamesPresence`); where none has, it
 *  docks that presence in the corner, so there is always a way in. */
export function JarvisPanel({ store, jarvis, shortcut }: Props): JSX.Element | null {
  const open = useStore(store, (s) => s.open)
  const brain = useStore(store, (s) => s.brain)
  const setup = useStore(store, (s) => s.setup)
  const lines = useStore(store, (s) => s.lines)
  const parents = useStore(store, (s) => s.parents)
  const researches = useStore(store, (s) => s.researches)
  const busy = useStore(store, (s) => s.busy)
  const voice = useStore(store, (s) => s.voice)
  const asking = useStore(store, (s) => s.pending !== null)
  const moving = useStore(store, (s) => alive(presenceOf(s).state))
  const hosted = useStore(presenceHosts, (s) => s.hosts > 0)
  const panel = useOverlayRoot('jv-panel')
  const dock = useOverlayRoot('jv-dock')
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const close = () => store.setState({ open: false })

  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, open])

  const waiting = approvals({ parents })
  const openUrl = (url: string) => void jarvis.openUrl(url)
  // The newest research ended shows its answer whole; older ones fold theirs.
  const newestEnded = researches.find((r) => !unended(r))?.id
  if (!open) {
    if (hosted) return null
    return (
      <div {...dock}>
        <Presence store={store} shortcut={shortcut} />
      </div>
    )
  }

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void jarvis.ask(text)
  }

  return (
    <section {...panel} role="complementary" aria-label="James" data-voice={voice}>
      <header className="jv-head">
        <JamesOrb alive={moving} />
        <div className="jv-id">
          <h2 className="jv-name">James</h2>
          <span className="jv-word" data-testid="jv-setup-word" data-brain={brain?.kind ?? 'local'}>
            {brainWord(brain, setup)}
            {voice !== 'idle' ? ` · ${voice}` : ''}
          </span>
        </div>
        <button type="button" className="jv-close" aria-label="Close" title="Close (Esc)" onClick={close}>
          <Kbd>Esc</Kbd>
        </button>
      </header>
      {/* With Claude the local model only sees the screen: its card shows once a look starts it. */}
      {!(brain?.kind === 'claude' && setup.kind === 'idle') && <SetupCard setup={setup} onStart={() => void jarvis.ensure()} />}
      {waiting.map((p) => (
        <Approval key={p.ref.sessionId} parent={p} onAnswer={(allow) => void jarvis.answer(p.ref.sessionId, allow)} />
      ))}
      {parents.length > 0 && (
        <div className="jv-parents">
          <h3 className="jv-section">
            <Label>Parents</Label>
          </h3>
          {parents.map((p) => (
            <div key={p.ref.sessionId} className="jv-parent" data-state={p.state}>
              <Sign state={PARENT_SIGN[p.state]} />
              <b>{p.ref.project}</b>
              <span className="jv-parent-state">{STATE[p.state]}</span>
              <span className="jv-parent-req" title={p.ref.request}>
                {p.ref.request}
              </span>
            </div>
          ))}
        </div>
      )}
      {researches.length > 0 && (
        <div className="jv-researches">
          <h3 className="jv-section">
            <Label>Research</Label>
          </h3>
          {researches.map((r) => (
            <ResearchCard key={r.id} run={r} open={r.id === newestEnded} onOpen={openUrl} />
          ))}
        </div>
      )}
      <ol ref={list} className="jv-lines" aria-live="polite">
        {lines.length === 0 && <li className="jv-empty">Type to James in Portuguese. He reads; anything that writes goes to a parent session.</li>}
        {lines.map((l) => (
          <LineRow key={l.id} line={l} onOpen={openUrl} />
        ))}
        {busy && (
          <li className="jv-thinking" aria-label="James is thinking">
            <i />
            <i />
            <i />
          </li>
        )}
      </ol>
      <form
        className="jv-compose"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <span className="jv-prompt" aria-hidden="true">
          ›
        </span>
        <textarea
          ref={field}
          className="jv-field"
          rows={2}
          value={draft}
          placeholder={asking ? 'Answer James…' : 'Ask James…'}
          aria-label="Ask James"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              close()
            }
          }}
        />
        <button type="submit" className="jv-send" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}

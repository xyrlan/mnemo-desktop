import { useEffect, useRef, useState, type JSX } from 'react'
import { useStore } from 'zustand'
import type { Jarvis } from '../loop'
import type { ParentState } from '../parent'
import { approvals, type JarvisStore, type Line, type Parent, type Setup } from '../store'
import '../../nexus/ui/ui.css'
import './panel.css'

type Props = {
  store: JarvisStore
  jarvis: Pick<Jarvis, 'ask' | 'answer' | 'ensure'>
  /** `jarvis.toggle`'s chord, printed on the launcher; none while it has no chord. */
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

const STATE: Record<ParentState, string> = {
  starting: 'starting',
  working: 'working',
  idle: 'turn ended',
  asking: 'asking',
  approval: 'needs approval',
  exited: 'exited',
}

function SetupCard({ setup, onStart }: { setup: Setup; onStart(): void }) {
  if (setup.kind === 'ready') return null
  if (setup.kind === 'idle')
    return (
      <div className="jv-setup" data-kind="idle">
        <p className="nx-muted">The local model starts with the first request. The first time it downloads about 7 GB.</p>
        <button type="button" className="nx-btn" onClick={onStart}>
          Prepare now
        </button>
      </div>
    )
  if (setup.kind === 'error')
    return (
      <div className="jv-setup" data-kind="error" role="alert">
        <p>{setup.message}</p>
        <button type="button" className="nx-btn" onClick={onStart}>
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
        <b>{parent.ref.project}</b> waits on your approval
      </div>
      <p className="jv-approval-q">{parent.question}</p>
      <div className="jv-approval-actions">
        <button type="button" className="nx-btn" data-tone="danger" onClick={() => onAnswer(false)}>
          Deny
        </button>
        <button type="button" className="nx-btn" data-tone="go" onClick={() => onAnswer(true)}>
          Allow
        </button>
      </div>
    </div>
  )
}

function LineRow({ line }: { line: Line }) {
  return (
    <li className="jv-line" data-who={line.who} data-error={line.who === 'note' && line.error ? '' : undefined}>
      {line.who === 'you' && <span className="jv-who">{line.spoken ? 'you (spoken)' : 'you'}</span>}
      {line.who === 'james' && <span className="jv-who">James</span>}
      {line.who === 'parent' && <span className="jv-who">{line.project}</span>}
      <span className="jv-text">{line.text}</span>
    </li>
  )
}

/** James on screen (#505): the conversation, the model's setup, the parents Jarvis opened and an
 *  approval any of them waits on, and a field to type to him. Docked on the right, over the ship
 *  and under a Nexus window. */
export function JarvisPanel({ store, jarvis, shortcut }: Props): JSX.Element {
  const open = useStore(store, (s) => s.open)
  const setup = useStore(store, (s) => s.setup)
  const lines = useStore(store, (s) => s.lines)
  const parents = useStore(store, (s) => s.parents)
  const busy = useStore(store, (s) => s.busy)
  const voice = useStore(store, (s) => s.voice)
  const asking = useStore(store, (s) => s.pending !== null)
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
  if (!open)
    return (
      <button
        type="button"
        className="nx jv-launcher"
        data-waiting={waiting.length ? '' : undefined}
        aria-label="Open James"
        title={shortcut ? `James (${shortcut})` : 'James'}
        onClick={() => store.setState({ open: true })}
      >
        J{waiting.length ? <span className="jv-badge">{waiting.length}</span> : null}
      </button>
    )

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void jarvis.ask(text)
  }

  return (
    <section className="nx jv-panel" role="complementary" aria-label="James" data-voice={voice}>
      <div className="nx-window-bar">
        <h2 className="nx-window-title">James</h2>
        <span className="nx-window-sub" data-testid="jv-setup-word">
          {setupWord(setup)}
          {voice !== 'idle' ? ` · ${voice}` : ''}
        </span>
        <button type="button" className="nx-window-close" aria-label="Close" title="Close (Esc)" onClick={close}>
          ×
        </button>
      </div>
      <SetupCard setup={setup} onStart={() => void jarvis.ensure()} />
      {waiting.map((p) => (
        <Approval key={p.ref.sessionId} parent={p} onAnswer={(allow) => void jarvis.answer(p.ref.sessionId, allow)} />
      ))}
      {parents.length > 0 && (
        <div className="jv-parents">
          <h3 className="nx-section">Parents</h3>
          {parents.map((p) => (
            <div key={p.ref.sessionId} className="nx-row jv-parent" data-state={p.state}>
              <b>{p.ref.project}</b>
              <span className="jv-parent-state">{STATE[p.state]}</span>
              <span className="jv-parent-req" title={p.ref.request}>
                {p.ref.request}
              </span>
            </div>
          ))}
        </div>
      )}
      <ol ref={list} className="jv-lines" aria-live="polite">
        {lines.length === 0 && <li className="jv-empty nx-muted">Type to James in Portuguese. He reads; anything that writes goes to a parent session.</li>}
        {lines.map((l) => (
          <LineRow key={l.id} line={l} />
        ))}
        {busy && <li className="jv-line jv-thinking nx-muted">…</li>}
      </ol>
      <form
        className="jv-compose"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <textarea
          ref={field}
          className="nx-input jv-field"
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
        <button type="submit" className="nx-btn" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  )
}

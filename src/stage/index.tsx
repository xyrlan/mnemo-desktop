// The stage: the session the maintainer is in, with its terminal. Console's middle column
// (docs/superpowers/specs/2026-11-10-recreation-front.md, "stage"): the session's figure, name
// and facts, its family across the top, what it is doing now, the rhythm of its tool calls,
// and its terminal: the live one when the runtime can host it, else the transcript drawn
// from the world, with a reply box under it.

import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Figure, Kbd, Label, StateMark } from '../ds'
import { PendingCard, armedPending } from '../pending'
import { LiveTerminal, canHost } from '../runtime'
import { actions } from '../world/actions'
import { age, tilde } from '../world/format'
import { go, routeStore, select, useRoute } from '../world/route'
import { pendingOf, sessionOf, useWorld, worldStore } from '../world/store'
import type { Session, World } from '../world/types'
import { factsOf, familyOf, familyStep, nowOf, parentOf, pulseOf, statusOf, transcriptOf, type Line } from './model'
import { saidStore, useDraft, useSent } from './said'
import './stage.css'

export { familyOf, familyStep } from './model'

/** Walk the family on stage: `step` is -1 for left and 1 for right, and it wraps. For the
 *  frame's keys. False when there is no session on stage or it has no family to walk. */
export function walkFamily(step: number): boolean {
  const world = worldStore.getState().world
  const here = sessionOf(world, routeStore.getState().route.session)
  const next = here && familyStep(world, here, step)
  if (!next) return false
  select(next.id)
  return true
}

/** Put the keys in the stage's terminal: the live one, or the reply box under a drawn
 *  transcript. For the frame's Enter. False when there is nothing to type into. */
export function focusTerminal(): boolean {
  const stage = document.querySelector<HTMLElement>('[data-stage]')
  const target = stage?.querySelector<HTMLElement>('[data-stage-reply]') ?? stage?.querySelector<HTMLElement>('.stage-live textarea, .stage-live [tabindex]')
  if (!target) return false
  target.focus()
  return document.activeElement === target
}

/** Console's middle column: the session `route.session` names. */
export function Stage() {
  const id = useRoute((r) => r.session)
  const world = useWorld((w) => w)
  const session = sessionOf(world, id)
  const root = useRef<HTMLElement>(null)
  // The focus follows a walk made from inside the stage, so the next key lands here too.
  const follow = useRef(false)
  // Nothing "enters" on the first draw: a screenshot of a URL is never taken mid-entrance.
  const [shown, setShown] = useState({ id: session?.id ?? null, entered: false })
  if (shown.id !== (session?.id ?? null)) setShown({ id: session?.id ?? null, entered: shown.id !== null && !!session })

  useLayoutEffect(() => {
    const chip = root.current?.querySelector<HTMLElement>('.stage-chip[aria-current="true"]')
    const family = chip?.parentElement
    if (chip && family) {
      const out = chip.getBoundingClientRect()
      const box = family.getBoundingClientRect()
      if (out.top < box.top || out.bottom > box.bottom) family.scrollTop += out.top - box.top - 4
    }
    if (!follow.current) return
    follow.current = false
    ;(chip ?? root.current)?.focus()
  }, [session?.id])

  const stageOn = (sessionId: string) => {
    follow.current = sessionId !== session?.id
    select(sessionId)
  }

  // Keys are the stage's only while the focus is in it, and never in a terminal or a field.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !session) return
    const on = e.target as HTMLElement
    if (on.closest('input, textarea, select, [contenteditable], .stage-live')) return
    let took = false
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = familyStep(world, session, e.key === 'ArrowLeft' ? -1 : 1)
      if (next) stageOn(next.id)
      took = !!next
    } else if (e.key === 'Enter' && !on.closest('button, a')) {
      took = focusTerminal()
    }
    if (took) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <section ref={root} className="stage" data-stage data-state={session?.state} tabIndex={-1} onKeyDown={onKeyDown}>
      {session ? <Body key={session.id} world={world} session={session} entered={shown.entered} stageOn={stageOn} /> : <Empty waiting={world.pending.length} sessions={world.sessions.length} />}
    </section>
  )
}

function Empty({ waiting, sessions }: { waiting: number; sessions: number }) {
  return (
    <div className="stage-none">
      <Label>stage</Label>
      <p className="stage-none-line">No session on stage</p>
      <p className="stage-none-hint">
        {sessions === 0 ? (
          'No session in this world yet.'
        ) : (
          <>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> pick one from the roster
            {waiting > 0 && (
              <>
                {' · '}
                <Kbd>N</Kbd> the next of {waiting} that {waiting === 1 ? 'waits' : 'wait'}
              </>
            )}
          </>
        )}
      </p>
    </div>
  )
}

function Body({ world, session: s, entered, stageOn }: { world: World; session: Session; entered: boolean; stageOn: (id: string) => void }) {
  const wide = useRoute((r) => r.wide)
  const view = useRoute((r) => r.view)
  const family = familyOf(world, s)
  const parent = parentOf(world, s)
  const live = canHost(s)
  return (
    <div className={entered ? 'stage-in stage-enter' : 'stage-in'} data-wide={wide || undefined}>
      <header className="stage-head">
        <span className="stage-field" aria-hidden="true" />
        <ContextFigure session={s} />
        <div className="stage-id">
          <div className="stage-kick">
            {s.project && <span className="stage-project">{s.project}</span>}
            {parent ? (
              <span className="stage-of">
                child of{' '}
                <button type="button" className="stage-link" onClick={() => stageOn(parent.id)}>
                  {parent.title}
                </button>
              </span>
            ) : (
              s.role === 'child' && <span className="stage-of">dispatched child, its parent is not in this world</span>
            )}
            <span className="stage-short mn-mono">{s.short}</span>
          </div>
          <h1 className="stage-title">{s.title}</h1>
          <div className="stage-facts">
            <span className="stage-state">
              <StateMark state={s.state} word />
            </span>
            {factsOf(world, s).map((f) => (
              <span key={f.key} className={`stage-fact${f.mono ? ' mn-mono' : ''}`} data-fact={f.key} data-tone={f.tone}>
                {f.text}
              </span>
            ))}
          </div>
        </div>
      </header>

      <nav className="stage-family" aria-label="Family">
        <span className="stage-family-keys">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </span>
        {family.length > 1 ? (
          family.map((m, i) => (
            <button key={m.id} type="button" className="stage-chip" data-state={m.state} aria-current={m.id === s.id ? 'true' : undefined} onClick={() => stageOn(m.id)}>
              {i === 0 && <span className="stage-chip-role">parent</span>}
              <StateMark state={m.state} />
              <span className="stage-chip-title">{m.title}</span>
              {pendingOf(world, m.id).length > 0 && <span className="stage-chip-waits">waits</span>}
            </button>
          ))
        ) : (
          <span className="stage-family-none">
            No children. <Kbd>;</Kbd> dispatch sends one.
          </span>
        )}
      </nav>

      <NowLine world={world} session={s} />
      <PulseStrip world={world} session={s} />

      {live ? (
        <section className="stage-term" data-live aria-label="Terminal">
          <TermBar session={s}>
            <RoomButton wide={wide} />
          </TermBar>
          <div className="stage-live">
            <LiveTerminal key={s.id} sessionId={s.id} active={view === 'console'} />
          </div>
        </section>
      ) : (
        <Transcript world={world} session={s} wide={wide} />
      )}
    </div>
  )
}

/** The session's figure, large, inside a ring that fills as its context does. */
function ContextFigure({ session: s }: { session: Session }) {
  const percent = s.context.percent == null ? null : Math.max(0, Math.min(100, s.context.percent))
  const R = 46
  const around = 2 * Math.PI * R
  const ticks = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2 - Math.PI / 2
        const from = i % 10 === 0 ? 50 : 52
        return { x1: Math.cos(a) * from, y1: Math.sin(a) * from, x2: Math.cos(a) * 54, y2: Math.sin(a) * 54 }
      }),
    [],
  )
  return (
    <div className="stage-figure" role="img" aria-label={percent == null ? 'context not known' : `context ${Math.round(percent)}%`}>
      <svg className="stage-figure-ticks" viewBox="-56 -56 112 112" aria-hidden="true">
        {ticks.map((t, i) => (
          <line key={i} x1={t.x1.toFixed(2)} y1={t.y1.toFixed(2)} x2={t.x2.toFixed(2)} y2={t.y2.toFixed(2)} />
        ))}
      </svg>
      <svg viewBox="-56 -56 112 112" aria-hidden="true">
        <circle r={R} className="stage-figure-track" />
        {percent != null && <circle r={R} className="stage-figure-fill" data-hot={percent >= 80 || undefined} transform="rotate(-90)" strokeDasharray={`${((around * percent) / 100).toFixed(2)} ${around.toFixed(2)}`} />}
      </svg>
      <Figure id={s.id} size={64} />
    </div>
  )
}

function NowLine({ world, session: s }: { world: World; session: Session }) {
  const sent = useSent(s.id)
  const now = nowOf(s, sent)
  return (
    <section className="stage-now" data-running={now?.kind === 'running' || undefined} aria-label="Now">
      <Label>now</Label>
      <div className="stage-now-text">
        {now ? (
          <>
            <span className="stage-now-kind">{now.kind}</span>
            {now.tool != null ? (
              <>
                <b className="mn-mono">{now.tool}</b> <span className="mn-mono stage-now-target">{now.target}</span>
              </>
            ) : (
              now.text
            )}
          </>
        ) : (
          <span className="stage-now-none">nothing recorded yet</span>
        )}
      </div>
      {now?.at != null && <span className="stage-now-age mn-num">{age(now.at, world.at)} ago</span>}
    </section>
  )
}

function PulseStrip({ world, session: s }: { world: World; session: Session }) {
  const pulse = useMemo(() => pulseOf(s), [s])
  if (!pulse) return null
  const end = age(pulse.to, world.at)
  return (
    <section className="stage-pulse" aria-label="Tool calls over time">
      <div className="stage-pulse-head">
        <Label>pulse</Label>
        <b className="mn-num">{pulse.total.toLocaleString('en-US')}</b>
        <span>tool {pulse.total === 1 ? 'call' : 'calls'}</span>
        <span className="stage-pulse-kinds">
          {pulse.kinds.map(([kind, n]) => (
            <span key={kind}>
              <b className="mn-num">{n.toLocaleString('en-US')}</b> {kind}
            </span>
          ))}
        </span>
      </div>
      <div className="stage-pulse-bars" aria-hidden="true">
        {pulse.bars.map((b) => (
          <i key={b.t} style={{ left: `${b.left.toFixed(2)}%`, width: `${b.width.toFixed(2)}%`, height: `${b.height.toFixed(0)}%` }} />
        ))}
      </div>
      <div className="stage-pulse-axis">
        <span>{age(pulse.from, world.at)} ago</span>
        <span>{end === '0s' ? 'now' : `${end} ago`}</span>
      </div>
    </section>
  )
}

/** The bar over the terminal. A drawn transcript says that it is one, in `note`. */
function TermBar({ session: s, note, children }: { session: Session; note?: string; children: ReactNode }) {
  return (
    <div className="stage-term-bar">
      <Label>{note ? 'transcript' : 'terminal'}</Label>
      <span className="stage-term-cwd mn-mono">{tilde(s.cwd)}</span>
      {note && <span className="stage-term-note">{note}</span>}
      <span className="stage-term-hints">{children}</span>
    </div>
  )
}

/** The terminal takes the instruments' room, and gives it back (`route.wide`). */
function RoomButton({ wide, hint }: { wide: boolean; hint?: boolean }) {
  return (
    <button type="button" className="stage-hint" data-room onClick={() => go({ wide: !wide })}>
      {hint && <Kbd>Enter</Kbd>}
      {wide ? 'give the room back' : 'take the room'}
    </button>
  )
}

/** The transcript drawn from the world, and the reply box that speaks to the session. */
function Transcript({ world, session: s, wide }: { world: World; session: Session; wide: boolean }) {
  const sent = useSent(s.id)
  const draft = useDraft(s.id)
  const armedId = useRoute((r) => armedPending(world, r)?.id ?? null)
  const lines = useMemo(() => transcriptOf(world, s, sent), [world, s, sent])
  const [typing, setTyping] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const waits = lines.some((l) => l.kind === 'pending')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    // Enter on an empty box is "again": the terminal takes the room, and gives it back.
    if (!text) return go({ wide: !wide })
    if (busy) return
    setBusy(true)
    let why: string | null = null
    try {
      const outcome = await actions().reply(s.id, text)
      if (!outcome.ok) why = outcome.why
    } catch (err) {
      why = err instanceof Error ? err.message : String(err)
    }
    if (why == null) {
      saidStore.getState().say(s.id, text, Date.now())
      saidStore.getState().draft(s.id, '')
    }
    setRefused(why)
    setBusy(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return
    // Esc leaves the box and keeps the keys on the stage.
    e.currentTarget.closest<HTMLElement>('[data-stage]')?.focus()
  }

  return (
    <section className="stage-term" data-typing={typing || undefined} aria-label="Transcript">
      <TermBar session={s} note="not hosted here">
        {typing ? (
          draft.trim() ? (
            <span className="stage-hint">
              <Kbd>Enter</Kbd>send
            </span>
          ) : (
            <RoomButton wide={wide} hint />
          )
        ) : (
          <>
            <button type="button" className="stage-hint" onClick={() => input.current?.focus()}>
              <Kbd>Enter</Kbd>type here
            </button>
            <RoomButton wide={wide} />
          </>
        )}
      </TermBar>
      <div className="stage-term-scroll">
        <div className="stage-log" role="log" aria-label="What the session did">
          {lines.map((line) => (
            <TranscriptLine key={line.key} line={line} armedId={armedId} />
          ))}
        </div>
      </div>
      <form className="stage-reply mn-mono" onSubmit={submit}>
        <span className="stage-reply-sign" aria-hidden="true">
          &gt;
        </span>
        <input
          ref={input}
          data-stage-reply
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-label={waits ? 'Answer in your own words' : 'Say something to this session'}
          placeholder={waits ? 'answer in your own words' : 'say something to this session'}
          value={draft}
          onChange={(e) => {
            saidStore.getState().draft(s.id, e.target.value)
            if (refused) setRefused(null)
          }}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          onKeyDown={onKeyDown}
        />
      </form>
      {refused && (
        <p className="stage-refused" role="status">
          <span className="stage-refused-k">not sent</span>
          {refused}
        </p>
      )}
      <div className="stage-status mn-mono">{statusOf(s)}</div>
    </section>
  )
}

function TranscriptLine({ line, armedId }: { line: Line; armedId: string | null }) {
  switch (line.kind) {
    case 'note':
      return <p className="stage-line-note">{line.text}</p>
    case 'prompt':
      return (
        <div className="stage-line stage-line-you" data-line="prompt" data-tag={line.tag ?? undefined}>
          <span className="stage-line-time">{line.tag ?? ''}</span>
          <span className="stage-line-sign">&gt;</span>
          <span className="stage-line-said">{line.text}</span>
        </div>
      )
    case 'call':
      return (
        <div className="stage-line" data-line="call" data-failed={line.failed || undefined}>
          <span className="stage-line-time">{line.time ?? ''}</span>
          <i className="stage-line-dot" />
          <span className="stage-line-call">
            <b>{line.tool}</b>
            <span>{line.target}</span>
          </span>
          <span className="stage-line-took">
            {line.failed ? 'failed ' : ''}
            {line.took}
          </span>
        </div>
      )
    case 'words':
      return (
        <div className="stage-line stage-line-says" data-line="words">
          <span className="stage-line-time">{line.time}</span>
          <i className="stage-line-dot" />
          <span className="stage-line-said">
            {line.label && <span className="stage-line-label">{line.label}</span>}
            {line.text}
          </span>
        </div>
      )
    case 'running':
      return (
        <div className="stage-line stage-line-runs" data-line="running">
          <span className="stage-line-time">{line.time}</span>
          <i className="stage-line-dot" />
          <span className="stage-line-call">
            <b>{line.tool}</b>
            <span>{line.target}</span>
          </span>
          <span className="stage-line-took">running {line.since}</span>
        </div>
      )
    case 'working':
      return (
        <div className="stage-line stage-line-runs" data-line="working">
          <span className="stage-line-time" />
          <i className="stage-line-dot" />
          <span className="stage-line-call">
            <b>working</b>
          </span>
          <span className="stage-line-took" />
        </div>
      )
    case 'pending':
      return (
        <div className="stage-line-waits" data-line="pending">
          <PendingCard pending={line.pending} armed={armedId === line.pending.id} />
        </div>
      )
  }
}

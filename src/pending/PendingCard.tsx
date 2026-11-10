// One card for every kind of waiting, drawn the same wherever the item is listed: a roster
// entry, a body in Orbit, a line's now edge in Score, the foot of the stage's transcript
// (docs/superpowers/specs/2026-11-10-recreation-design.md, "One way to answer").

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Kbd } from '../ds'
import { actions } from '../world/actions'
import { age } from '../world/format'
import { go } from '../world/route'
import { useWorld } from '../world/store'
import type { Pending, PendingKind, PullRequest } from '../world/types'
import { answer, cardOf, closeWords, openWords, pendingStore, sendWords, takesFocus, typeWords, type Card } from './state'
import './pending.css'

/** A kind's signal: the state whose hue and shape it wears. A question and a permission are
 *  a need; a merge is ready; a stalled or blocked session is stalled. */
export const TONE: Record<PendingKind, 'need' | 'ready' | 'stalled'> = { question: 'need', permission: 'need', merge: 'ready', stalled: 'stalled', blocked: 'stalled' }

/** The signal's shape, drawn so it is the same size on every machine: a diamond, a triangle,
 *  a cross. The ones `GLYPH` names, for the three states a waiting item can mean. */
export function Shape({ tone, on }: { tone: 'need' | 'ready' | 'stalled'; on?: boolean }) {
  return (
    <svg className="pending-shape" data-tone={tone} data-on={on ? 'true' : undefined} viewBox="0 0 10 10" aria-hidden="true">
      {tone === 'need' && <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" />}
      {tone === 'ready' && <path d="M5 1 9.5 8.8H0.5Z" />}
      {tone === 'stalled' && <path d="M1.4 1.4 8.6 8.6M8.6 1.4 1.4 8.6" fill="none" stroke="currentColor" strokeWidth="1.5" />}
    </svg>
  )
}

/** How long it has waited, as the world's own clock has it. */
function useWaited(pending: Pending): string {
  const now = useWorld((w) => w.at)
  return age(pending.since, now) || 'now'
}

/** What the item says. A permission is what a terminal printed, and says its kind already. */
const words = (pending: Pending): string => (pending.kind === 'permission' ? pending.text.replace(/^permission:\s*/i, '') : pending.text)

function Kind({ pending }: { pending: Pending }) {
  return (
    <span className="pending-kind">
      <Shape tone={TONE[pending.kind]} />
      {pending.kind}
    </span>
  )
}

function Checks({ pr }: { pr: PullRequest }) {
  const says = pr.ci ? `checks ${pr.ci}` : 'no checks'
  return (
    <span className="pending-ci" data-ci={pr.ci ?? 'none'} title={says}>
      <span>{says}</span>
    </span>
  )
}

const settledWord = (card: Card): string => (card.sending !== null ? 'sending' : card.settled?.words ? 'answered in your words' : 'answered')

/** A waiting item with its choices. `armed`: digits answer this one now. */
export function PendingCard({ pending, armed }: { pending: Pending; armed: boolean }) {
  const card = pendingStore((s) => cardOf(s, pending))
  const focus = pendingStore((s) => (s.focus?.id === pending.id ? s.focus.n : 0))
  const waited = useWaited(pending)
  const root = useRef<HTMLElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const back = useRef(false)

  // The entrance plays when a card that was listed is armed, never when it is first drawn: a
  // screenshot of a URL finds it at rest.
  const was = useRef(armed)
  const entered = useRef(false)
  if (was.current !== armed) {
    entered.current = armed
    was.current = armed
  }

  useEffect(() => {
    if (!focus || !card.words || !field.current || !root.current) return
    if (!takesFocus(pending.id, root.current)) return
    field.current.focus()
    field.current.select()
    // Only when the field is opened: typing in it must not select it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, card.words])

  // Walking on closes the field and keeps the draft: a card that is armed again must not take
  // the keys that walk.
  useEffect(() => {
    if (!armed && card.words) closeWords(pending)
  }, [armed, card.words, pending])

  useEffect(() => {
    if (card.words || !back.current) return
    back.current = false
    opener.current?.focus()
  }, [card.words])

  const tone = TONE[pending.kind]
  const busy = card.sending !== null
  const done = card.settled

  if (!armed) {
    const n = pending.choices.length
    return (
      <button
        type="button"
        className="pending pending-line"
        data-pending={pending.kind}
        data-pending-id={pending.id}
        data-tone={tone}
        data-settled={done || busy ? 'true' : undefined}
        aria-expanded={false}
        onClick={() => go({ pending: pending.id, session: pending.session })}
      >
        <Kind pending={pending} />
        {pending.pr && <span className="pending-pr">#{pending.pr.number}</span>}
        {pending.pr && <Checks pr={pending.pr} />}
        <span className="pending-line-text">{words(pending)}</span>
        <span className="pending-count">{done || busy ? settledWord(card) : `${n} ${n === 1 ? 'choice' : 'choices'}`}</span>
        <span className="pending-age">{waited}</span>
      </button>
    )
  }

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      back.current = true
      closeWords(pending)
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.stopPropagation()
      void sendWords(pending)
    }
  }
  const suggested = !!pending.suggestedReply && card.draft === pending.suggestedReply

  return (
    <section
      ref={root}
      className="pending"
      data-pending={pending.kind}
      data-pending-id={pending.id}
      data-tone={tone}
      data-armed="true"
      data-entered={entered.current ? 'true' : undefined}
      data-settled={done ? 'true' : undefined}
      aria-label={`${pending.kind}, waiting ${waited}`}
    >
      <header className="pending-head">
        <Kind pending={pending} />
        <span className="pending-age">waiting {waited}</span>
      </header>
      <p className="pending-text" data-printed={pending.kind === 'permission' ? 'true' : undefined}>
        {words(pending)}
      </p>
      {(pending.detail || pending.pr) && (
        <p className="pending-detail">
          {pending.pr ? (
            <button type="button" className="pending-link" title={pending.pr.url} onClick={() => void actions().external(pending.pr!.url)}>
              {pending.detail ?? `#${pending.pr.number}`}
            </button>
          ) : (
            <span>{pending.detail}</span>
          )}
          {pending.pr && <Checks pr={pending.pr} />}
        </p>
      )}

      {done ? (
        <p className="pending-settled" role="status">
          <i aria-hidden="true">✓</i>
          <span className="pending-settled-word">{settledWord(card)}</span>
          <span className="pending-settled-said">{done.said}</span>
          {done.note && <span className="pending-settled-note">{done.note}</span>}
        </p>
      ) : (
        <div className="pending-choices">
          {pending.choices.map((c) => (
            <button
              key={c.key}
              type="button"
              className="pending-choice"
              data-tone={c.tone}
              data-sending={card.sending === c.key ? 'true' : undefined}
              aria-keyshortcuts={c.key <= 9 ? String(c.key) : undefined}
              disabled={busy}
              onClick={() => void answer(pending, c.key)}
            >
              <Kbd>{c.key}</Kbd>
              <span className="pending-label">{c.label}</span>
              {card.sending === c.key ? <small className="pending-hint">sending…</small> : c.hint && <small className="pending-hint">{c.hint}</small>}
            </button>
          ))}
          {pending.reply && !card.words && (
            <button ref={opener} type="button" className="pending-choice pending-own" aria-keyshortcuts="R" disabled={busy} onClick={() => openWords(pending, root.current)}>
              <Kbd>R</Kbd>
              <span className="pending-label">in your words</span>
              {card.draft && <small className="pending-hint">{card.draft}</small>}
            </button>
          )}
        </div>
      )}
      {!done && pending.reply && card.words && (
        <div className="pending-words" data-sending={card.sending === 'words' ? 'true' : undefined}>
          <span className="pending-prompt" aria-hidden="true">
            ›
          </span>
          <textarea
            ref={field}
            rows={Math.min(6, card.draft.split('\n').length)}
            value={card.draft}
            placeholder="Answer in your own words"
            aria-label="Answer in your own words"
            readOnly={busy}
            spellCheck={false}
            onChange={(e) => typeWords(pending, e.target.value)}
            onKeyDown={keys}
          />
          <span className="pending-words-keys">
            {card.sending === 'words' ? (
              'sending…'
            ) : (
              <>
                {suggested && <em>mnemo's suggestion</em>}
                <Kbd>Enter</Kbd> send <Kbd>Esc</Kbd> back
              </>
            )}
          </span>
        </div>
      )}

      {card.trouble && (
        <p className="pending-trouble" role="alert">
          <i aria-hidden="true">✕</i>
          {card.trouble}
        </p>
      )}
    </section>
  )
}

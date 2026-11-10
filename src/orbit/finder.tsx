// The finder: type part of a name, a project, a branch or an id.

import { useEffect, useRef } from 'react'
import { Label, StateMark } from '../ds'
import { WORD } from '../world/format'
import { rootOf } from '../world/store'
import type { Session, World } from '../world/types'

/** How many hits are listed; the rest ask for another letter. */
export const LISTED = 9

export function Finder({ world, text, hits, hit, onText, onHit, onOpen, onClose }: { world: World; text: string; hits: Session[]; hit: number; onText: (text: string) => void; onHit: (index: number) => void; onOpen: (s: Session) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  const last = Math.max(0, Math.min(LISTED, hits.length) - 1)
  return (
    <div className="orbit-finder" data-orbit-finder onClick={(e) => e.stopPropagation()}>
      <Label>find a session</Label>
      <input
        ref={input}
        type="text"
        value={text}
        autoComplete="off"
        spellCheck={false}
        aria-label="Find a session"
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          // a text field: its keys are its own, and none of them is the fleet's
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') onHit(Math.min(last, hit + 1))
          else if (e.key === 'ArrowUp') onHit(Math.max(0, hit - 1))
          else if (e.key === 'Enter') {
            if (hits[hit]) onOpen(hits[hit])
          } else return
          e.preventDefault()
        }}
      />
      <ul>
        {hits.slice(0, LISTED).map((s, i) => {
          const root = rootOf(world, s)
          return (
            <li key={s.id} data-hit={s.id} data-on={i === hit || undefined} data-state={s.state} onClick={() => onOpen(s)} onMouseEnter={() => onHit(i)}>
              <StateMark state={s.state} />
              <span className="orbit-f-title">{s.title}</span>
              <span className="orbit-f-meta">
                {s.project ?? ''}
                {root !== s ? ` · child of ${root.title.slice(0, 30)}` : ''} · {WORD[s.state]}
              </span>
            </li>
          )
        })}
        {!hits.length && <li className="orbit-f-none">{text.trim() ? 'No session has that in its name.' : 'Type part of a name, a project, a branch or an id.'}</li>}
      </ul>
      {hits.length > LISTED && <div className="orbit-f-more">+ {hits.length - LISTED} more: keep typing</div>}
    </div>
  )
}

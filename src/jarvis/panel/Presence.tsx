// James's presence: the way into him, and what he is doing, wherever it stands. The frame's top
// bar renders `JamesPresence`; with no top bar that has him, the panel docks the same thing in
// the corner (`./Panel`).

import { useEffect, type JSX } from 'react'
import { useStore } from 'zustand'
import { shortcutLabel } from '../../actions/chords'
import { Kbd } from '../../ds'
import type { JarvisStore } from '../store'
import { alive, hostPresence, jamesStore, PRESENCE_WORD, presenceOf } from './james'
import './panel.css'

/** The thread orb, small: a sphere wound from one thread, as six turns of it. It turns while
 *  James is alive (`panel.css`). */
export function ThreadOrb(): JSX.Element {
  return (
    <svg className="jv-thread" viewBox="-16 -16 32 32" data-asset="james-thread" aria-hidden="true">
      <circle r={13.5} />
      <g>
        {[0, 30, 60, 90, 120, 150].map((turn) => (
          <ellipse key={turn} rx={13.5} ry={turn % 60 ? 4.6 : 8.4} transform={`rotate(${turn})`} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  )
}

type Props = {
  store: JarvisStore
  /** `jarvis.toggle`'s chord, shown as a key; none while it has no chord. */
  shortcut?: string
}

/** The presence over a store: his orb, his name, what he is doing, the approvals that wait, and
 *  his chord. A click opens the panel, or closes it. */
export function Presence({ store, shortcut }: Props): JSX.Element {
  const open = useStore(store, (s) => s.open)
  // One string, so a line added to the conversation redraws nothing here.
  const key = useStore(store, (s) => {
    const p = presenceOf(s)
    return `${p.state} ${p.approvals}`
  })
  const [state, n] = key.split(' ') as [keyof typeof PRESENCE_WORD, string]
  const waiting = Number(n)
  const word = PRESENCE_WORD[state]
  const says = [word && `James is ${state === 'waiting' ? 'listening for more' : state === 'error' ? 'stopped by a failure' : word}`, waiting ? `${waiting} ${waiting === 1 ? 'approval waits' : 'approvals wait'}` : '']
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type="button"
      className="jv-presence"
      data-james={state}
      data-alive={alive(state) || undefined}
      data-open={open || undefined}
      aria-label={says ? `James: ${says}` : 'James'}
      aria-expanded={open}
      title={shortcut ? `James (${shortcut})` : 'James'}
      onClick={() => store.setState((s) => ({ open: !s.open }))}
    >
      <ThreadOrb />
      <span className="jv-presence-name">James</span>
      {word && <span className="jv-presence-word">{word}</span>}
      {waiting > 0 && (
        <span className="jv-presence-need" data-state="need">
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" />
          </svg>
          <b className="mn-num">{waiting}</b>
        </span>
      )}
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </button>
  )
}

/** The top bar's way into James: his state, and a click or his chord (`jarvis.toggle`, bound by
 *  the app's keymap) opens the panel. It reads the app's one James, so it takes no props. */
export function JamesPresence(): JSX.Element {
  useEffect(() => hostPresence(), [])
  return <Presence store={jamesStore} shortcut={shortcutLabel('jarvis.toggle')} />
}

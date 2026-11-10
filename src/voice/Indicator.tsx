// adapted from stablyai/orca src/renderer/src/components/dictation/DictationIndicator.tsx (MIT, 122b8c25)
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { Kbd } from '../ds'
import { useOverlayRoot } from '../notify/overlay'
import type { Phase, VoiceState } from './controller'
import { Grapes } from './Grapes'
import './voice.css'

type Props = {
  store: StoreApi<VoiceState>
  /** The toggle's keys, shown on the Stop button: `['⌘', 'E']`. */
  shortcut: readonly string[]
  /** The hold chord's keys, shown beside the toggle's: `['⌥', 'Space']`. */
  hold?: readonly string[]
  onStop(): void
  /** Hides an error, which otherwise stays until the next take. */
  onDismiss?(): void
}

function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="voice-keys">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  )
}

/** The line beside the grapes. */
function label(phase: Exclude<Phase, { kind: 'idle' }>, downloading: boolean): string {
  switch (phase.kind) {
    case 'starting':
      return 'Starting mic…'
    case 'listening':
      return 'Listening'
    case 'transcribing':
      return downloading ? 'Waiting for the model…' : 'Processing…'
    case 'done':
      return phase.landed ? 'Dictated' : 'Not typed: the field it was for is gone'
    case 'note':
      return phase.text
    case 'error':
      return phase.message
  }
}

/** The dictation indicator, floating at the foot of the window in the new identity
 *  (`./voice.css`): the grapes, what dictation is doing, the microphone it listens to, and Stop
 *  with the keys that stop it while a take is open. After the take, the transcript lingers under
 *  it for a moment (whisper has only the final text). An error is shown whole, wrapped, and stays
 *  until dismissed. */
export function Indicator({ store, shortcut, hold = [], onStop, onDismiss }: Props) {
  const phase = useStore(store, (s) => s.phase)
  const download = useStore(store, (s) => s.download)
  const root = useOverlayRoot('voice-ind')
  if (phase.kind === 'idle') return null

  const open = phase.kind === 'starting' || phase.kind === 'listening'
  const busy = open || phase.kind === 'transcribing'
  const isError = phase.kind === 'error'
  const text = label(phase, download !== null)
  const transcript = phase.kind === 'done' ? phase.text.trim() : ''
  const device = phase.kind === 'listening' ? phase.device : null
  const wide = transcript !== '' || download !== null || isError
  const stopLabel = 'Stop dictation'

  return (
    // z 85 (`voice.css`): over every window (60), confirmation (61), menu (70), notification card
    // (75), toast (80) and Triage (`z-modal`), so Stop shows and takes the click while a field in
    // one is dictated into.
    <div data-ui="" data-testid="dictation-indicator" data-phase={phase.kind} data-shape={wide ? 'card' : 'pill'} data-tone={isError ? 'error' : undefined} {...root}>
      <div className="voice-row">
        <Grapes level={0} active={busy} transitioning={phase.kind === 'starting' || phase.kind === 'transcribing'} />
        <span aria-hidden data-testid="dictation-text" className="voice-text" data-whole={isError || undefined}>
          {text}
        </span>
        {device ? (
          <span aria-hidden data-testid="dictation-device" title={device} className="voice-device">
            {device}
          </span>
        ) : null}
        <span role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} aria-atomic="true" className="mn-sr">
          {device ? `${text}: ${device}` : text}
        </span>
        {isError && onDismiss ? (
          <button type="button" aria-label="Dismiss" title="Dismiss" className="voice-dismiss" onMouseDown={(event) => event.preventDefault()} onClick={onDismiss}>
            ×
          </button>
        ) : null}
        {open ? (
          <>
            <i aria-hidden className="voice-rule" />
            <button
              type="button"
              aria-label={stopLabel}
              title={stopLabel}
              className="voice-stop"
              // Keep focus where the text is going.
              onMouseDown={(event) => event.preventDefault()}
              onClick={onStop}
            >
              <i aria-hidden className="voice-square" />
              Stop
              {shortcut.length > 0 ? <Keys keys={shortcut} /> : null}
            </button>
            {hold.length > 0 ? (
              <span aria-hidden className="voice-hold">
                or release
                <Keys keys={hold} />
              </span>
            ) : null}
          </>
        ) : null}
      </div>
      {transcript ? <p className="voice-said">{transcript}</p> : null}
      {download !== null ? (
        <div className="voice-download">
          Downloading speech model {Math.floor(download * 100)}%
          <div className="voice-bar">
            <div style={{ width: `${download * 100}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

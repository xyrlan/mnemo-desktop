import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { VoiceState } from './controller'

export default function Pill({ store }: { store: StoreApi<VoiceState> }) {
  const phase = useStore(store, (s) => s.phase)
  const download = useStore(store, (s) => s.download)
  if (phase.kind === 'idle') return null

  let body: React.ReactNode
  switch (phase.kind) {
    case 'listening':
      body = (
        <>
          <span className="voice-dot" /> listening…
        </>
      )
      break
    case 'transcribing':
      body = download === null ? 'transcribing…' : 'waiting for the model…'
      break
    case 'done':
      body = (
        <>
          <span className="voice-text">{phase.text}</span>
          {!phase.landed && <span className="voice-muted"> · no text field focused</span>}
        </>
      )
      break
    case 'note':
      body = <span className="voice-muted">{phase.text}</span>
      break
    case 'error':
      body = phase.message
      break
  }

  return (
    <div className={`voice-pill voice-${phase.kind}`} role="status" aria-live="polite">
      <div className="voice-line">{body}</div>
      {download !== null && (
        <div className="voice-progress">
          downloading speech model {Math.floor(download * 100)}%
          <div className="voice-bar" style={{ width: `${download * 100}%` }} />
        </div>
      )}
    </div>
  )
}

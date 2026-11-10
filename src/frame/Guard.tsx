// What a build mounts for the new front: the frame, loaded apart from the app's own start and
// kept behind a guard. If the frame fails to load or to draw, what stands in its place says so
// and offers the ship (docs/superpowers/specs/2026-11-10-recreation-swap.md): a broken new
// front never strands the maintainer without the old one.
//
// This file imports nothing of the frame but the flag, and styles itself inline: whatever broke
// the frame cannot break what replaces it.

import { Component, lazy, Suspense, type ComponentType, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { showClassic } from './flag'

const say = (e: unknown): string => (e instanceof Error ? e.message || e.name : String(e))

const BOX: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: 32,
  background: '#000',
  color: '#f4f4f5',
  font: '15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif',
}
const BUTTON: CSSProperties = { padding: '9px 16px', border: '1px solid rgb(255 255 255 / 0.55)', borderRadius: 999, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }

/** What stands where the frame would: what went wrong, and the two ways on. */
export function Broken({ error, classic, again }: { error: unknown; classic: () => string | null; again: () => void }) {
  return (
    <div role="alert" data-frame-broken style={BOX}>
      <div style={{ maxWidth: 620 }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.6 }}>mnemo</p>
        <h1 style={{ margin: '10px 0 12px', fontSize: 24, fontWeight: 600 }}>The new interface could not be drawn.</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Your sessions are not affected: their terminals belong to the app, not to this screen. The classic interface shows them as before.
        </p>
        <pre data-frame-broken-why style={{ margin: '16px 0 20px', padding: '10px 12px', border: '1px solid rgb(255 255 255 / 0.2)', borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: '12px/1.5 ui-monospace, Consolas, monospace', opacity: 0.85 }}>
          {say(error)}
        </pre>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button type="button" autoFocus style={{ ...BUTTON, background: '#f4f4f5', color: '#000' }} onClick={() => void classic()}>
            Classic interface
          </button>
          <button type="button" style={BUTTON} onClick={again}>
            Try again
          </button>
        </div>
      </div>
    </div>
  )
}

type GuardProps = { children: ReactNode; classic?: () => string | null; again?: () => void }

/** Catches whatever the frame throws while it loads or draws. */
export class Guard extends Component<GuardProps, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false }

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('mnemo: the new interface could not be drawn', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <Broken error={this.state.error} classic={this.props.classic ?? showClassic} again={this.props.again ?? (() => location.reload())} />
  }
}

/** The frame behind its guard. `load` is how the frame is fetched: the app's own, unless a test
 *  hands one in. */
export function guarded(load: () => Promise<{ Frame: ComponentType }>, props: Omit<GuardProps, 'children'> = {}): ComponentType {
  const Frame = lazy(() => load().then((m) => ({ default: m.Frame })))
  return function NewFront() {
    return (
      <Guard {...props}>
        <Suspense fallback={null}>
          <Frame />
        </Suspense>
      </Guard>
    )
  }
}

/** What `view.tsx` mounts. */
export const NewFront = guarded(() => import('./Frame'))

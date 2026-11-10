import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { useOverlayRoot } from '../notify/overlay'
import type { Work } from './files'
import { Grapes } from './Grapes'
import './voice.css'

type Box = { left: number; top: number; width: number }

/** Where `el` is on screen, followed frame by frame while the badge shows: a drawer resized or a
 *  popup moved takes its badge with it. Null while `el` is not on the page. */
function useBox(el: HTMLElement | null): Box | null {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      const r = el?.isConnected ? el.getBoundingClientRect() : null
      const next = r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width } : null
      setBox((b) => (b?.left === next?.left && b?.top === next?.top && b?.width === next?.width ? b : next))
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [el])
  return box
}

/** One drop's state, at the top of what it was dropped on: the model download with its bar, then
 *  "Transcribing <file>". With what it was dropped on gone, at the bottom of the window, so the
 *  work is never silent (its transcript then goes to the clipboard, `./files`). */
function Badge({ work }: { work: Work }) {
  const box = useBox(work.el)
  const root = useOverlayRoot('voice-work')
  const style = box
    ? { left: box.left + box.width / 2, top: box.top + 8, maxWidth: Math.max(160, box.width - 16) }
    : { left: '50%', bottom: '6rem', maxWidth: 'calc(100vw - 2rem)' }
  return (
    // z 85 (`voice.css`), with dictation's indicator: over the drawer, a popup and a window.
    <div data-ui="" data-testid="voice-file-work" role="status" aria-live="polite" style={style} {...root}>
      <div className="voice-row">
        <Grapes level={0} active transitioning />
        <span className="voice-text">{work.label}</span>
      </div>
      {work.download !== null ? (
        <div className="voice-bar">
          <div style={{ width: `${work.download * 100}%` }} />
        </div>
      ) : null}
    </div>
  )
}

/** Every drop of voice notes still being transcribed. */
export function FileWork({ store }: { store: StoreApi<{ work: Work[] }> }) {
  const work = useStore(store, (s) => s.work)
  if (!work.length) return null
  return createPortal(
    <>
      {work.map((w) => (
        <Badge key={w.id} work={w} />
      ))}
    </>,
    document.body,
  )
}

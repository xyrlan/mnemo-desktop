// James's presence in his panel: the thread orb, as the generated loop (`src/ds/art/ART.md`).
// It turns while James listens, thinks or speaks and holds still at rest. Reduced motion shows
// its first frame and loads no clip.

import { useEffect, useRef, type JSX } from 'react'
import still from '../../ds/art/james-orb-first.jpg'
import mp4 from '../../ds/art/james-orb.mp4'
import webm from '../../ds/art/james-orb.webm'
import { useStilled } from '../../notify/overlay'

export function JamesOrb({ alive }: { alive: boolean }): JSX.Element {
  const stilled = useStilled()
  const clip = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = clip.current
    if (!el) return
    if (!alive) return el.pause()
    // A webview that will not play it leaves the poster, which is the orb at rest.
    void Promise.resolve(el.play()).catch(() => {})
  }, [alive, stilled])

  if (stilled) return <img className="jv-orb" data-asset="james-orb" data-still="" data-alive={alive || undefined} src={still} alt="" />
  return (
    // The WebM first and the MP4 second: the three systems' webviews do not agree on one.
    <video ref={clip} className="jv-orb" data-asset="james-orb" data-alive={alive || undefined} poster={still} muted loop playsInline preload="metadata" disablePictureInPicture tabIndex={-1} aria-hidden="true">
      <source src={webm} type="video/webm" />
      <source src={mp4} type="video/mp4" />
    </video>
  )
}

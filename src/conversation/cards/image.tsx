import { useEffect, useRef, useState } from 'react'
import type { ImageRef } from '../types'
import { useCards } from './context'

export const dataUrl = (img: ImageRef) => `data:${img.mediaType};base64,${img.data}`

/** One image as a thumbnail. The base64 (up to ~500 KB a line) becomes an `<img>` only once the
 *  thumbnail is near the viewport, so a long transcript never decodes what is off screen. */
function Thumb({ img }: { img: ImageRef }) {
  const { openImage } = useCards()
  const ref = useRef<HTMLButtonElement>(null)
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (near || !ref.current) return
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(ref.current)
    return () => io.disconnect()
  }, [near])
  return (
    <button ref={ref} className="cv-thumb" title="Enlarge" onClick={() => openImage(img)}>
      {near ? <img src={dataUrl(img)} alt="" decoding="async" /> : <span className="cv-thumb-wait">image</span>}
    </button>
  )
}

export function Thumbs({ images }: { images: ImageRef[] }) {
  if (!images.length) return null
  return (
    <div className="cv-thumbs">
      {images.map((img, i) => (
        <Thumb key={i} img={img} />
      ))}
    </div>
  )
}

/** The enlarged image, over the face; a click or Esc closes it. */
export function Lightbox({ img, onClose }: { img: ImageRef; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="cv-lightbox" role="dialog" aria-label="Image" onClick={onClose}>
      <img src={dataUrl(img)} alt="" />
    </div>
  )
}

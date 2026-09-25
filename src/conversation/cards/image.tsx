// the thumbnail's look adapted from stablyai/orca
// src/renderer/src/components/native-chat/NativeChatTranscriptChrome.tsx (TranscriptImagePreview)
import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
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
    <button
      ref={ref}
      type="button"
      className="cv-thumb flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      title="View image"
      aria-label="View image"
      onClick={() => openImage(img)}
    >
      {near ? <img src={dataUrl(img)} alt="" decoding="async" className="size-full object-cover" /> : <ImageIcon className="cv-thumb-wait size-4 text-muted-foreground" aria-hidden />}
    </button>
  )
}

export function Thumbs({ images, className }: { images: ImageRef[]; className?: string }) {
  if (!images.length) return null
  return (
    <div className={`cv-thumbs mt-1.5 flex flex-wrap gap-1.5 ${className ?? ''}`}>
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
    <div className="cv-lightbox absolute inset-0 z-10 flex cursor-zoom-out items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Image" onClick={onClose}>
      <img src={dataUrl(img)} alt="" className="max-h-full max-w-full object-contain" />
    </div>
  )
}

// adapted from stablyai/orca src/renderer/src/components/dictation/DictationGrapes.tsx (MIT, 122b8c25)

const GRAPES = [
  { base: 0.64, response: 0.45, lift: 1 },
  { base: 0.76, response: 0.75, lift: -1 },
  { base: 0.9, response: 1, lift: 1 },
  { base: 1, response: 1.25, lift: -1 },
  { base: 0.86, response: 0.9, lift: 1 },
  { base: 0.72, response: 1.1, lift: -1 },
  { base: 0.82, response: 0.7, lift: 1 },
  { base: 0.68, response: 0.55, lift: -1 },
  { base: 0.58, response: 0.35, lift: 1 },
] as const

type Props = {
  /** Input level, 0–1. Our recorder reports none yet, so the indicator passes 0. */
  level: number
  active: boolean
  transitioning: boolean
}

/** Dictation's mark: nine dots that rise with the voice, and breathe while it starts or
 *  transcribes (`voice.css`). */
export function Grapes({ level, active, transitioning }: Props) {
  const normalizedLevel = Math.min(1, Math.max(0, level))

  return (
    <div data-testid="dictation-grapes" aria-hidden="true" className="voice-grapes" data-breathing={transitioning || undefined}>
      {GRAPES.map((grape, index) => {
        const energy = active ? normalizedLevel : 0
        const scale = grape.base + energy * grape.response
        const verticalOffset = energy * grape.lift * 2
        return <span key={index} style={{ transform: `translateY(${verticalOffset}px) scale(${scale})` }} />
      })}
    </div>
  )
}

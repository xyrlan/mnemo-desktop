/** The mnemo octopus playing one scene. Pass `scene` for a thing mnemo did, or `state` for
 *  what a dispatched child is doing. Decorative by design: the caption beside it is what a
 *  screen reader announces. */
import { SCENES, STATE_SCENES, withPartIndex, type ChildWord, type Scene } from './scenes'
import type { PulseKind } from '../pulse/types'
import './avatar.css'

type Props = { size: number } & ({ scene: PulseKind; state?: never } | { state: ChildWord; scene?: never })

export default function Avatar({ size, scene, state }: Props) {
  const s: Scene = scene ? SCENES[scene] : STATE_SCENES[state as ChildWord]
  return (
    <svg
      className={`av av-${s.tone} ${s.className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {withPartIndex(s.rects).map(([rect, n], i) => (
        <rect key={i} className={`av-${rect.part} av-${rect.part}-${n}`} x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      ))}
    </svg>
  )
}

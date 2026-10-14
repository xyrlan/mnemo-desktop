import type { PulseEvent } from '../pulse/types'
import type { Target } from './types'

export type HoverCardProps = { target: Target; events: PulseEvent[]; now: number }

/** What a hover shows (spec, premises): for a robot its issue and title, model and effort, state,
 *  current tool, age, PR and checks, context tokens and the rules mnemo injected; for a nexus its
 *  session and children; for an archive its pages.
 *
 *  Stub until the `interact` piece lands. */
export function HoverCard({ target }: HoverCardProps) {
  const label = target.kind === 'nexus' ? target.nexus.label : target.kind === 'robot' ? target.robot.label : target.archive.project
  return <div className="nexus-hover">{label}</div>
}

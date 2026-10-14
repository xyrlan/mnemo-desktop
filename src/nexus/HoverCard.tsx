import type { JSX, ReactNode } from 'react'
import { childWord } from '../mission/types'
import type { PulseEvent } from '../pulse/types'
import { ago } from '../rightbar/memory'
import { injectedRules } from './packets'
import type { Archive, Nexus, Robot, Target } from './types'

export type HoverCardProps = { target: Target; events: PulseEvent[]; now: number }

const POSE_WORD: Record<Nexus['pose'], string> = { busy: 'busy', waiting: 'waiting on you', idle: 'idle', dead: 'ended' }
const TIER_WORD: Record<Archive['tier'], string> = { 0: 'small', 1: 'grown', 2: 'full' }
const CI_WORD = { pass: 'checks passed', fail: 'checks failing', pending: 'checks running', none: 'no checks' } as const

/** `812`, `42k`, `1.3M`: a context size at a glance. */
export function tokensWord(n: number): string {
  if (n < 1000) return `${n}`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex gap-2" data-row={name}>
      <dt className="w-14 shrink-0 text-muted-foreground">{name}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** What the robot is doing, in words: its state, then what it waits on or why it is stalled. */
function robotState(r: Robot): string {
  const c = r.child
  const word = childWord(c)
  if (r.badge === 'zzz') return c.detail ? `rate-limited: ${c.detail}` : 'rate-limited'
  const why = c.waiting_for ?? c.needs
  return why && (r.halo === 'needs-you' || word === 'BLOCKED') ? `${word.toLowerCase()}: ${why}` : word.toLowerCase()
}

function RobotCard({ robot: r, events, now }: { robot: Robot; events: PulseEvent[]; now: number }) {
  const c = r.child
  const title = c.name ?? c.intent
  const updated = c.updated_at ? Date.parse(c.updated_at) : NaN
  const rules = r.sessionId ? injectedRules(events, r.sessionId) : []
  return (
    <>
      <div className="font-medium">
        {r.label}
        {title && <span className="ml-1.5 font-normal text-muted-foreground">{title}</span>}
      </div>
      <dl className="mt-1 flex flex-col gap-0.5">
        <Row name="model">
          {c.model ?? 'default'} · effort {c.effort ?? 'default'}
        </Row>
        <Row name="state">{robotState(r)}</Row>
        {r.tool && <Row name="tool">{r.tool}</Row>}
        {Number.isFinite(updated) && <Row name="age">{ago(updated, now)}</Row>}
        {c.pr && (
          <Row name="PR">
            #{c.pr.number} {c.pr.state.toLowerCase()}
            {c.pr.draft ? ' draft' : ''} · {CI_WORD[c.pr.ci]}
            {c.pr.failing?.length ? `: ${c.pr.failing.join(', ')}` : ''}
          </Row>
        )}
        <Row name="context">{tokensWord(c.tokens)} tokens</Row>
        <Row name="rules">{rules.length ? <ul>{rules.map((s) => <li key={s}>{s}</li>)}</ul> : <span className="text-muted-foreground">none injected</span>}</Row>
      </dl>
    </>
  )
}

function NexusCard({ nexus: n }: { nexus: Nexus }) {
  const why = n.pose === 'waiting' ? n.parent?.waiting_for : null
  return (
    <>
      <div className="font-medium">{n.label}</div>
      <dl className="mt-1 flex flex-col gap-0.5">
        <Row name="session">{n.sessionId.slice(0, 8)}</Row>
        <Row name="state">{why ? `${POSE_WORD[n.pose]}: ${why}` : POSE_WORD[n.pose]}</Row>
        <Row name="cwd">{n.cwd}</Row>
        <Row name="robots">
          {n.robots.length ? (
            <ul>
              {n.robots.map((r) => (
                <li key={r.id}>
                  {r.label} · {childWord(r.child).toLowerCase()}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">none</span>
          )}
        </Row>
      </dl>
    </>
  )
}

function ArchiveCard({ archive: a }: { archive: Archive }) {
  return (
    <>
      <div className="font-medium">{a.project}</div>
      <dl className="mt-1 flex flex-col gap-0.5">
        <Row name="pages">
          {a.pages} live {a.pages === 1 ? 'page' : 'pages'} · {TIER_WORD[a.tier]}
        </Row>
      </dl>
    </>
  )
}

/** What a hover shows (spec Q15): for a robot its label and title, model and effort, state,
 *  current tool, age, PR and checks, context tokens and the rules mnemo injected; for a nexus its
 *  session and its robots; for an archive its pages. The scene places it. */
export function HoverCard({ target, events, now }: HoverCardProps): JSX.Element {
  return (
    <div className="nexus-hover max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-[11px] text-popover-foreground shadow-md" data-kind={target.kind} data-ui>
      {target.kind === 'robot' ? (
        <RobotCard robot={target.robot} events={events} now={now} />
      ) : target.kind === 'nexus' ? (
        <NexusCard nexus={target.nexus} />
      ) : (
        <ArchiveCard archive={target.archive} />
      )}
    </div>
  )
}

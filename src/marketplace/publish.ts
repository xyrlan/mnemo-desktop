/** Publish → Open PR for one repo root. Publishing shows `mnemo publish`'s output;
 *  Open PR asks for a confirmation click before any git command runs. A second
 *  click while a command runs is ignored, and a result for a flow no longer
 *  waiting on it is dropped. */
export type Publish =
  | { status: 'idle' }
  | { status: 'publishing' }
  | { status: 'published'; ok: boolean; output: string }
  | { status: 'confirming'; output: string }
  | { status: 'opening'; output: string }
  | { status: 'opened'; ok: boolean; output: string; url: string; branch: string }

export type PublishEvent =
  | { type: 'start' }
  | { type: 'published'; ok: boolean; output: string }
  | { type: 'ask' }
  | { type: 'cancel' }
  | { type: 'open' }
  | { type: 'opened'; ok: boolean; output: string; url?: string; branch?: string }
  | { type: 'dismiss' }

export const IDLE_PUBLISH: Publish = { status: 'idle' }

export const busy = (p: Publish) => p.status === 'publishing' || p.status === 'opening'

export function publishReducer(p: Publish, e: PublishEvent): Publish {
  switch (e.type) {
    case 'start':
      return busy(p) ? p : { status: 'publishing' }
    case 'published':
      return p.status === 'publishing' ? { status: 'published', ok: e.ok, output: e.output } : p
    case 'ask':
      if (p.status === 'idle') return { status: 'confirming', output: '' }
      if ((p.status === 'published' || p.status === 'opened') && p.ok) return { status: 'confirming', output: p.output }
      return p
    case 'cancel':
      if (p.status !== 'confirming') return p
      return p.output ? { status: 'published', ok: true, output: p.output } : IDLE_PUBLISH
    case 'open':
      return p.status === 'confirming' ? { status: 'opening', output: p.output } : p
    case 'opened':
      return p.status === 'opening'
        ? { status: 'opened', ok: e.ok, output: e.output, url: e.url ?? '', branch: e.branch ?? '' }
        : p
    case 'dismiss':
      return busy(p) ? p : IDLE_PUBLISH
  }
}

/** Today in local time as `YYYY-MM-DD`, the `team-rules/<date>` branch date. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

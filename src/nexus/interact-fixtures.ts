import type { ChildSession, ParentSession } from '../mission/types'
import type { Nexus, Robot } from './types'

/** Synthetic rows for the interact piece's tests: no real session, path or log. */

export const child = (over: Partial<ChildSession> = {}): ChildSession => ({
  id: 'a1b2c3d4',
  session_id: '11111111-0000-4000-8000-000000000001',
  name: 'nexus hover card',
  state: 'working',
  tempo: 'active',
  needs: null,
  detail: '',
  suggested_reply: null,
  cwd: '/work/mnemo-desktop-wt-c-interact',
  tokens: 42_300,
  live: true,
  updated_at: null,
  intent: null,
  branch: 'feat/nexus/interact',
  timeline_len: 3,
  account: 'default',
  ...over,
})

export const robot = (over: Partial<Robot> = {}): Robot => {
  const c = over.child ?? child()
  return {
    id: c.id,
    sessionId: c.session_id,
    label: 'interact',
    klass: 'mech',
    level: 2,
    accessory: 1,
    pose: 'working',
    halo: 'working',
    badge: null,
    exit: null,
    tool: null,
    ...over,
    child: c,
  }
}

export const parent = (over: Partial<ParentSession> = {}): ParentSession => ({
  session_id: '22222222-0000-4000-8000-000000000002',
  pid: 4242,
  name: 'nexus round',
  status: 'busy',
  cwd: '/work/mnemo-desktop',
  account: 'default',
  ...over,
})

export const nexus = (over: Partial<Nexus> = {}): Nexus => {
  const p = over.parent === undefined ? parent() : over.parent
  return {
    sessionId: p?.session_id ?? '33333333-0000-4000-8000-000000000003',
    label: 'nexus round',
    cwd: '/work/mnemo-desktop',
    pose: 'busy',
    halo: 'working',
    robots: [],
    ...over,
    parent: p,
  }
}

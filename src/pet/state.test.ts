import { describe, expect, it } from 'vitest'
import type { AgentNode, AgentState } from '../fleet/types'
import { POSES, STATE_SCENES } from '../avatar/scenes'
import { clampPosition, loadPosition, petScene, petStateOf, savePosition, STORAGE_KEY } from './state'

const fleet = (...states: AgentState[]) => ({
  repos: [
    {
      root: '/r',
      name: 'r',
      worktrees: [
        {
          path: '/r',
          name: 'r',
          branch: null,
          kind: 'main' as const,
          pr: null,
          unread: false,
          agents: states.map((state, i) => ({ sessionId: String(i), paneId: null, state, waitingFor: null, title: '', since: 0 }) as AgentNode),
        },
      ],
    },
  ],
})

describe('petStateOf', () => {
  it('is idle with no agents', () => expect(petStateOf({ repos: [] })).toBe('idle'))
  it('ranks needs-you over working over done', () => {
    expect(petStateOf(fleet('done', 'working', 'needs-you'))).toBe('needs-you')
    expect(petStateOf(fleet('done', 'working', 'idle'))).toBe('working')
    expect(petStateOf(fleet('idle', 'done'))).toBe('done')
  })
})

describe('petScene', () => {
  it('maps agent states to child scenes', () => {
    expect(petScene('working')).toBe(STATE_SCENES.active)
    expect(petScene('needs-you')).toBe(STATE_SCENES.BLOCKED)
    expect(petScene('done')).toBe(STATE_SCENES.done)
  })
  it('idle wears the vault pose', () => {
    expect(petScene('idle')).toBe(POSES.fair)
    const sick = { pages: 100, rules_fired: 0, dormant: 100, label_only: 0, inbox: 300, fires: 0 } as never
    expect(petScene('idle', sick)).toBe(POSES.poor)
  })
})

describe('position', () => {
  it('clamps inside the window', () => {
    const v = { width: 400, height: 300 }
    expect(clampPosition({ x: -50, y: 999 }, v)).toEqual({ x: 8, y: 300 - 64 - 8 })
    expect(clampPosition({ x: 999, y: 0 }, v).x).toBe(400 - 64 - 8)
  })
  it('round-trips and survives junk', () => {
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(loadPosition(s)).toBeNull()
    savePosition(s, { x: 5, y: 6 })
    expect(loadPosition(s)).toEqual({ x: 5, y: 6 })
    m.set(STORAGE_KEY, '{oops')
    expect(loadPosition(s)).toBeNull()
  })
})

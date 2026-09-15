import type { ChildSession, ParentSession, RepoGroup, Snapshot } from './types'

/** Snapshot fixtures for scope, token and rendering tests. Shaped like `mission_snapshot`
 *  output: a child's cwd is its worktree, beside the main checkout rather than under it. */

export function child(over: Partial<ChildSession> & { id: string }): ChildSession {
  return {
    session_id: null, name: null, state: 'working', tempo: 'active', needs: null, detail: '', suggested_reply: null,
    cwd: '', tokens: 0, live: true, updated_at: null, intent: null, branch: null, timeline_len: 0,
    ...over,
  }
}

export function parent(over: Partial<ParentSession> & { session_id: string }): ParentSession {
  return { pid: 1, name: null, status: 'idle', cwd: '', ...over }
}

export const desktop: RepoGroup = {
  root: '/Users/me/github/mnemo-desktop',
  name: 'mnemo-desktop',
  parents: [
    parent({ session_id: '0ff9d810-aaaa', status: 'busy', cwd: '/Users/me/github/mnemo-desktop', name: 'round3 dispatch', tokens: 210_000, cache_read: 9_400_000, children_tokens: 640_000 }),
  ],
  missions: [
    {
      feature: 'round3',
      contract_path: '/Users/me/github/mnemo-desktop/docs/contracts/round3.md',
      landable: false,
      pieces: [
        {
          name: 'cockpit', branch: 'feat/round3/cockpit', pr: null,
          child: child({ id: 'a43d3832', branch: 'feat/round3/cockpit', cwd: '/Users/me/github/mnemo-desktop-wt-c-cockpit', detail: 'writing the cockpit pane', tokens: 320_000, parent_session: '0ff9d810-aaaa', timeline_len: 4 }),
        },
        {
          name: 'vault', branch: 'feat/round3/vault', pr: null,
          child: child({ id: '094c6a03', cwd: '/Users/me/github/mnemo-desktop-wt-c-vault', tempo: 'blocked', needs: 'may I add a crate?', suggested_reply: 'yes', detail: 'waiting', parent_session: '0ff9d810-aaaa' }),
        },
      ],
    },
  ],
  children: [],
}

export const mnemo: RepoGroup = {
  root: '/Users/me/github/mnemo',
  name: 'mnemo',
  parents: [parent({ session_id: '812d9d86-bbbb', cwd: '/Users/me/github/mnemo/crates/cli' })],
  missions: [],
  children: [child({ id: 'c0ffee01', cwd: '/Users/me/github/mnemo-issue-40', detail: 'issue 40', name: 'issue-40' })],
}

export const notes: RepoGroup = {
  root: '/Users/me/notes',
  name: 'notes',
  parents: [parent({ session_id: 'deadbeef-cccc', cwd: '/Users/me/notes' })],
  missions: [],
  children: [],
}

export const snapshot: Snapshot = { repos: [desktop, mnemo, notes], errors: [], at: '2026-09-15T12:00:00Z' }

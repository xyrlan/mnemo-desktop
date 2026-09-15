import type { Pane } from '../layout/store'
import { snapshot } from '../mission/fixtures'
import { barInfo, paneParent, pulseLabel, pulseTitle } from './info'

const term = (over: Partial<Pane> = {}): Pane => ({ id: 1, view: 'terminal', ...over })

test('a terminal in a repo shows git repo and branch, and its title', () => {
  const info = barInfo(term({ cwd: '/Users/me/github/mnemo-desktop/src', title: 'zsh' }), snapshot, { repo: 'mnemo-desktop', branch: 'feat/round5/chrome' })
  expect(info).toMatchObject({ place: 'mnemo-desktop', branch: 'feat/round5/chrome', title: 'zsh', tokens: undefined })
})

test('before git answers the repo comes from the snapshot, else the folder name', () => {
  expect(barInfo(term({ cwd: '/Users/me/github/mnemo-desktop-wt-c-cockpit' }), snapshot).place).toBe('mnemo-desktop')
  expect(barInfo(term({ cwd: '/tmp/scratch/' }), snapshot).place).toBe('scratch')
  expect(barInfo(term(), snapshot)).toEqual({ cwd: undefined, place: undefined, branch: undefined, tokens: undefined, title: 'terminal' })
})

test('tokens come from the session the pane was opened for', () => {
  const info = barInfo(term({ cwd: '/elsewhere', sessionId: '0ff9d810-aaaa' }), snapshot)
  expect(info.tokens).toBe('parent 210k · children 640k')
})

test('without a session id, a parent in exactly the same cwd counts; a subdirectory does not', () => {
  expect(paneParent(term({ cwd: '/Users/me/github/mnemo-desktop/' }), '/Users/me/github/mnemo-desktop/', snapshot)?.session_id).toBe('0ff9d810-aaaa')
  expect(paneParent(term(), '/Users/me/github/mnemo-desktop/src', snapshot)).toBeUndefined()
  expect(paneParent({ id: -2, view: 'editor' }, '/Users/me/github/mnemo-desktop', snapshot)).toBeUndefined()
})

test('two parents in one cwd are ambiguous, and a parent without counts shows no tokens', () => {
  const [desktop] = snapshot.repos
  const twin = { ...desktop, parents: [...desktop.parents, { ...desktop.parents[0], session_id: 'other' }] }
  expect(paneParent(term(), desktop.root, { ...snapshot, repos: [twin] })).toBeUndefined()
  expect(barInfo(term({ cwd: '/Users/me/notes' }), snapshot).tokens).toBeUndefined()
})

test('non-terminal panes use their view cwd and title', () => {
  const info = barInfo({ id: -1, view: 'editor', props: { root: '/Users/me/notes' }, title: 'todo.md' }, snapshot, { repo: null, branch: null })
  expect(info).toMatchObject({ cwd: '/Users/me/notes', place: 'notes', branch: undefined, title: 'todo.md' })
  expect(barInfo({ id: -3, view: 'cockpit' }, snapshot)).toMatchObject({ cwd: undefined, title: 'cockpit' })
})

test('a pulse label names its first rule, how many more, or the tool when no rule fired', () => {
  const e = { at: 1, kind: 'reflex' as const, project: 'p', agent: 'p', slugs: ['run-tests'] }
  expect(pulseLabel(e)).toBe('↯ run-tests')
  expect(pulseLabel({ ...e, slugs: ['a', 'b', 'c'] })).toBe('↯ a +2')
  expect(pulseLabel({ ...e, kind: 'tool', slugs: [], tool: 'session_start.inject' })).toBe('↯ session_start.inject')
  expect(pulseLabel({ ...e, kind: 'tool', slugs: [] })).toBe('↯ tool')
  expect(pulseTitle({ ...e, kind: 'enforce', tool: 'Bash', slugs: ['no-force-push'] })).toBe('mnemo blocked Bash: no-force-push (click to open in the vault)')
  expect(pulseTitle({ ...e, kind: 'tool', tool: 'session_start.inject', slugs: [] })).toBe('mnemo tool call session_start.inject')
})

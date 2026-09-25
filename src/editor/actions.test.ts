import { createStore } from '../layout/store'
import type { PtyClient } from '../pty/client'
import type { Action } from '../actions/registry'
import { createSessions } from './sessions'
import { registerEditorActions, type PromptFn, type PromptResult } from './actions'

const pty: PtyClient = {
  spawn: async () => 1,
  write: async () => {},
  resize: async () => {},
  kill: async () => {},
  onExit: async () => () => {},
}

function setup(answer: PromptResult | null) {
  const app = createStore(pty)
  const sessions = createSessions()
  const actions: Record<string, Action> = {}
  const asked: string[] = []
  const prompt: PromptFn = async ({ initial }) => {
    asked.push(initial)
    return answer
  }
  registerEditorActions({ app, fs: { home: async () => '/Users/me' }, prompt, register: (a) => (actions[a.id] = a) })
  return { app, sessions, actions, asked }
}

test('editor.open resolves relative to the focused terminal cwd and opens it to the side', async () => {
  const { app, actions, asked } = setup({ value: 'src/main.ts', place: 'split-row' })
  await app.getState().newTab()
  app.getState().setCwd(1, '/Users/me/proj')
  await actions['editor.open'].run()

  expect(asked).toEqual(['/Users/me/proj/'])
  const st = app.getState()
  const editor = Object.values(st.panes).find((p) => p.view === 'editor')!
  expect(editor.props).toEqual({ path: '/Users/me/proj/src/main.ts', root: '/Users/me/proj' })
  expect(editor.title).toBe('main.ts')
  // Enter opens to the side: a group to the right of the terminal's.
  expect(st.groupRoot).toMatchObject({ kind: 'split', dir: 'row' })
  expect(st.groups[st.activeGroup].tabs).toHaveLength(1)
  expect(st.tabs.map((t) => t.root)).toEqual([{ kind: 'leaf', pane: 1 }, { kind: 'leaf', pane: editor.id }])
  expect(st.tabs.find((t) => t.id === st.activeTab)!.focused).toBe(editor.id)
})

test('editor.open without a terminal cwd roots at home and honours the tab place', async () => {
  const { app, actions, asked } = setup({ value: '~/notes.md', place: 'tab' })
  await app.getState().newTab()
  await actions['editor.open'].run()
  expect(asked).toEqual(['/Users/me/'])
  const st = app.getState()
  expect(st.tabs).toHaveLength(2)
  expect(st.groupRoot).toEqual({ kind: 'group', group: st.activeGroup })
  expect(st.panes[st.tabs[1].focused].props).toEqual({ path: '/Users/me/notes.md', root: '/Users/me' })
})

test('editor.open cancelled or empty opens nothing', async () => {
  for (const answer of [null, { value: '   ', place: 'tab' as const }]) {
    const { app, actions } = setup(answer)
    await app.getState().newTab()
    await actions['editor.open'].run()
    expect(Object.values(app.getState().panes).map((p) => p.view)).toEqual(['terminal'])
  }
})

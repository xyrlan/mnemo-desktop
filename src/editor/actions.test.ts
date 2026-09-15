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
  registerEditorActions({ app, sessions, fs: { home: async () => '/Users/me' }, prompt, register: (a) => (actions[a.id] = a) })
  return { app, sessions, actions, asked }
}

test('editor.open resolves relative to the focused terminal cwd and splits beside it', async () => {
  const { app, actions, asked } = setup({ value: 'src/main.ts', place: 'split-row' })
  await app.getState().newTab()
  app.getState().setCwd(1, '/Users/me/proj')
  await actions['editor.open'].run()

  expect(asked).toEqual(['/Users/me/proj/'])
  const st = app.getState()
  const editor = Object.values(st.panes).find((p) => p.view === 'editor')!
  expect(editor.props).toEqual({ path: '/Users/me/proj/src/main.ts', root: '/Users/me/proj' })
  expect(editor.title).toBe('main.ts')
  // 'split-row' from the prompt becomes 'auto'; with no pane sizes (jsdom) auto opens a tab.
  expect(st.tabs.some((t) => JSON.stringify(t.root).includes(`"pane":${editor.id}`))).toBe(true)
  expect(st.tabs.find((t) => t.id === st.activeTab)!.focused).toBe(editor.id)
})

test('editor.open without a terminal cwd roots at home and honours the tab place', async () => {
  const { app, actions, asked } = setup({ value: '~/notes.md', place: 'tab' })
  await app.getState().newTab()
  await actions['editor.open'].run()
  expect(asked).toEqual(['/Users/me/'])
  const st = app.getState()
  expect(st.tabs).toHaveLength(2)
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

test('editor.toggle-tree toggles only a focused editor pane', async () => {
  const { app, sessions, actions } = setup(null)
  await app.getState().newTab()
  app.getState().openView('editor', { path: '/w/a.ts' }, 'split-row')
  const id = app.getState().tabs[0].focused
  sessions.getState().open(id, '/w/a.ts', '/w')
  sessions.getState().open(1, '/decoy', '/w')

  await actions['editor.toggle-tree'].run()
  expect(sessions.getState().sessions[id].treeOpen).toBe(false)

  app.getState().focusPane(1)
  await actions['editor.toggle-tree'].run()
  expect(sessions.getState().sessions[id].treeOpen).toBe(false)
  expect(sessions.getState().sessions[1].treeOpen).toBe(true)
})

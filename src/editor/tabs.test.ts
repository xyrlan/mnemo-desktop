import { createStore } from '../layout/store'
import { registerReuse } from '../layout/reuse'
import type { PtyClient } from '../pty/client'
import { createSessions } from './sessions'
import { editorShows, keepEditedTabs } from './tabs'

const pty: PtyClient = { spawn: async () => 1, write: async () => {}, resize: async () => {}, kill: async () => {}, onExit: async () => () => {} }

function setup() {
  const app = createStore(pty)
  const sessions = createSessions()
  const off = registerReuse(
    'editor',
    (id, p) => {
      const s = sessions.getState().sessions[id]
      if (!s || s.dirty || typeof p.path !== 'string') return false
      sessions.getState().navigate(id, p.path)
      return true
    },
    editorShows(app, sessions),
  )
  const stop = keepEditedTabs(app, sessions)
  return { app, sessions, done: () => (off(), stop()) }
}
const editors = (app: ReturnType<typeof createStore>) => Object.values(app.getState().panes).filter((p) => p.view === 'editor')

test('a file open in the group is shown, not opened twice', async () => {
  const { app, done } = setup()
  await app.getState().newTab()
  app.getState().openView('editor', { path: '/r/a.ts' }, 'auto', 'a.ts')
  app.getState().openView('editor', { path: '/r/b.ts' }, 'auto', 'b.ts')
  app.getState().openView('editor', { path: '/r/a.ts' }, 'auto', 'a.ts')
  expect(editors(app).map((p) => p.props?.path)).toEqual(['/r/a.ts', '/r/b.ts'])
  const st = app.getState()
  expect(st.panes[st.tabs.find((t) => t.id === st.activeTab)!.focused].props?.path).toBe('/r/a.ts')
  done()
})

test('a preview is replaced by the next one until its buffer is edited', async () => {
  const { app, sessions, done } = setup()
  await app.getState().newTab()
  const preview = (path: string) => app.getState().openView('editor', { path }, 'auto', path, { preview: true })
  preview('/r/a.ts')
  const first = app.getState().tabs.find((t) => t.preview)!
  const pane = first.focused
  sessions.getState().open(pane, '/r/a.ts', '/r')
  preview('/r/b.ts')
  // Taken in place: same tab, same pane, now on b.
  expect(editors(app)).toHaveLength(1)
  expect(sessions.getState().sessions[pane].path).toBe('/r/b.ts')

  sessions.getState().setDirty(pane, true)
  expect(app.getState().tabs.find((t) => t.id === first.id)!.preview).toBeFalsy()
  preview('/r/c.ts')
  expect(editors(app)).toHaveLength(2)
  done()
})

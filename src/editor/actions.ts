import type { Store, Place } from '../layout/store'
import type { Action } from '../actions/registry'
import type { FsClient } from './client'
import type { Sessions } from './sessions'
import { basename, defaultRoot, resolvePath } from './paths'

export type PromptResult = { value: string; place: Place }
export type PromptFn = (opts: { initial: string; hint: string }) => Promise<PromptResult | null>

export type Deps = {
  app: Store
  sessions: Sessions
  fs: Pick<FsClient, 'home'>
  prompt: PromptFn
  register: (a: Action) => void
}

/** Opens `path` as an editor pane. Split panes inherit the opener's tree root. */
export function openEditor(app: Store, path: string, root: string | undefined, place: Place) {
  app.getState().openView('editor', root === undefined ? { path } : { path, root }, place, basename(path))
}

export function registerEditorActions({ app, sessions, fs, prompt, register }: Deps) {
  register({
    id: 'editor.open',
    title: 'Open file…',
    run: async () => {
      const home = await fs.home()
      const root = defaultRoot(app.getState(), home)
      const got = await prompt({
        initial: root === '/' ? '/' : `${root}/`,
        hint: 'Enter: split right · ⌘Enter: new tab · relative paths resolve from the tree root',
      })
      if (!got || !got.value.trim()) return
      openEditor(app, resolvePath(got.value, root, home), root, got.place)
    },
  })
  register({
    id: 'editor.toggle-tree',
    title: 'Toggle file tree',
    run: () => {
      const st = app.getState()
      const tab = st.tabs.find((t) => t.id === st.activeTab)
      if (tab && st.panes[tab.focused]?.view === 'editor') sessions.getState().toggleTree(tab.focused)
    },
  })
}

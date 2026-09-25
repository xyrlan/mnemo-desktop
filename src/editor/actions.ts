import type { Store, Place } from '../layout/store'
import type { Action } from '../actions/registry'
import type { FsClient } from './client'
import { basename, defaultRoot, resolvePath } from './paths'

export type PromptResult = { value: string; place: Place }
export type PromptFn = (opts: { initial: string; hint: string }) => Promise<PromptResult | null>

export type Deps = {
  app: Store
  fs: Pick<FsClient, 'home'>
  prompt: PromptFn
  register: (a: Action) => void
}

/** Opens `path` as a tab: `split-row` to the side of the active group, `tab` in the active group
 *  (`auto` too, showing the tab that has the file). Root is inherited by the opener. */
export function openEditor(app: Store, path: string, root: string | undefined, place: Place) {
  app.getState().openView('editor', root === undefined ? { path } : { path, root }, place, basename(path))
}

export function registerEditorActions({ app, fs, prompt, register }: Deps) {
  register({
    id: 'editor.open',
    title: 'Open file…',
    run: async () => {
      const home = await fs.home()
      const root = defaultRoot(app.getState(), home)
      const got = await prompt({
        initial: root === '/' ? '/' : `${root}/`,
        hint: 'Enter: to the side · ⌘Enter: tab in this group · relative paths resolve from the current root',
      })
      if (!got || !got.value.trim()) return
      openEditor(app, resolvePath(got.value, root, home), root, got.place)
    },
  })
}

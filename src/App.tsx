import { useEffect, useState } from 'react'
import { store } from './layout/app-store'
import Palette from './palette/Palette'
import { installKeys } from './actions/keys'
import { registerBuiltins } from './actions/registry'
import { startWorkspace, type Workspace } from './layout/persist'
import Shell from './shell/Shell'
import { registerShellActions } from './shell/actions'
import { pollMission, reloadUnknownTitles, showFirstWorktree } from './shell/live'

// Every `src/<view>/view.tsx` registers its pane view, or mounts its screen in a shell slot
// (`mountInSlot`, src/shell/slots.ts), on import. A new one therefore needs no edit here.
import.meta.glob('./*/view.tsx', { eager: true })
import './terminal/cmd-view'

registerBuiltins(store)
registerShellActions()

/** Started once per app run (StrictMode mounts twice): restores the saved layout, then saves it. */
let workspace: Workspace | undefined

export default function App() {
  // The workbench says nothing about an empty worktree until the saved tabs are back, so a
  // restored workspace does not flash an empty state first.
  const [boot, setBoot] = useState<{ ready: boolean; notice: string | null }>({ ready: false, notice: null })

  useEffect(() => installKeys(), [])
  // What the mission sidebar ran while it was mounted: the snapshot poll, and Home's titles.
  useEffect(() => pollMission(), [])
  useEffect(() => reloadUnknownTitles(), [])
  useEffect(() => {
    workspace ??= startWorkspace(store)
    let live = true
    void workspace.ready.then(({ notice }) => live && setBoot({ ready: true, notice }))
    return () => {
      live = false
    }
  }, [])
  // The restore shows the worktree it saved; with none, the first repo's main checkout shows.
  useEffect(() => (boot.ready ? showFirstWorktree() : undefined), [boot.ready])

  return (
    <>
      <Shell ready={boot.ready} notice={boot.notice} onDismissNotice={() => setBoot({ ready: true, notice: null })} />
      <Palette />
    </>
  )
}

import { useEffect } from 'react'
import { toast } from '@/ui'
import { store } from './layout/app-store'
import { detectPlatform, installKeys } from './actions/keys'
import { installNotAPage } from './actions/not-a-page'
import { startWorkspace, type Workspace } from './layout/persist'
import Shell from './shell/Shell'
import { tellNewerRelease } from './about/release'
import { pollMission, refreshGithubEvery, reloadUnknownTitles } from './shell/live'

// Every `src/<dir>/view.tsx` mounts its screen in the shell's overlay slot (`mountInSlot`,
// src/shell/slots.ts) or connects what it needs, on import: the Nexus, its notifications, the
// pulse, dictation, the desktop MCP and the terminal view the drawer draws. A new one needs no
// edit here.
import.meta.glob('./*/view.tsx', { eager: true })

/** Started once per app run (StrictMode mounts twice): restores the saved sessions, then saves
 *  them. The layout store is the session registry: every terminal the app runs, shown in the
 *  drawer or not. */
let workspace: Workspace | undefined

export default function App() {
  useEffect(() => installKeys(), [])
  // A dev build keeps the webview's context menu, for Inspect.
  useEffect(() => installNotAPage(detectPlatform(), { keepMenu: import.meta.env.DEV }), [])
  // The snapshot poll the ship reads, and the session titles it names captains by.
  useEffect(() => pollMission(), [])
  useEffect(() => reloadUnknownTitles(), [])
  useEffect(() => refreshGithubEvery(), [])
  // A newer release on GitHub is said once per version (#366).
  useEffect(() => void tellNewerRelease(toast), [])
  useEffect(() => {
    workspace ??= startWorkspace(store, undefined, undefined, (why) =>
      toast.error('Could not save the workspace layout', { id: 'workspace-save', description: why }),
    )
    let live = true
    // A restore that failed says so once: this run's sessions are not saved over the file.
    void workspace.ready.then(({ notice }) => live && notice && toast.error('Could not restore the last workspace', { id: 'workspace-restore', description: notice }))
    return () => {
      live = false
    }
  }, [])

  return <Shell />
}

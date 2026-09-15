import { useEffect, useState } from 'react'
import { store, useApp } from './layout/app-store'
import SplitView from './layout/SplitView'
import Palette from './palette/Palette'
import { installKeys } from './actions/keys'
import { registerBuiltins } from './actions/registry'
import { startWorkspace, type Workspace } from './layout/persist'

// Every `src/<view>/view.tsx` registers its pane view on import. A new pane kind
// (editor, browser, mission) therefore needs no edit here.
import.meta.glob('./*/view.tsx', { eager: true })
import './terminal/cmd-view'
import Sidebar from './mission/Sidebar'
import Home from './home/Home'
import ErrorBoundary from './panes/ErrorBoundary'

registerBuiltins(store)

/** Started once per app run (StrictMode mounts twice): restores the saved layout, then saves it. */
let workspace: Workspace | undefined

export default function App() {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  // Home waits for the saved tabs, so a restored workspace does not flash Home first.
  const [boot, setBoot] = useState<{ ready: boolean; notice: string | null }>({ ready: false, notice: null })

  useEffect(() => installKeys(), [])
  useEffect(() => {
    workspace ??= startWorkspace(store)
    let live = true
    void workspace.ready.then(({ notice }) => live && setBoot({ ready: true, notice }))
    return () => {
      live = false
    }
  }, [])

  return (
    <div className="app">
      <div className="app-main">
        <div className="workspace">
          {tabs.map((t) => (
            <div
              key={t.id}
              style={{ position: 'absolute', inset: 0, display: t.id === activeTab ? 'block' : 'none' }}
            >
              <ErrorBoundary label={`tab ${panes[t.focused]?.title || 'shell'}`}>
                <SplitView node={t.root} />
              </ErrorBoundary>
            </div>
          ))}
          {activeTab === '' && boot.ready && (
            <>
              {boot.notice && (
                <div className="ws-notice" onClick={() => setBoot({ ready: true, notice: null })} title="Dismiss">
                  {boot.notice}
                </div>
              )}
              <ErrorBoundary label="Home">
                <Home />
              </ErrorBoundary>
            </>
          )}
        </div>
      </div>
      <ErrorBoundary label="sidebar">
        <Sidebar />
      </ErrorBoundary>
      <Palette />
    </div>
  )
}

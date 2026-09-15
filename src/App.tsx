import { useEffect } from 'react'
import { store, useApp } from './layout/app-store'
import SplitView from './layout/SplitView'
import Palette from './palette/Palette'
import { installKeys } from './actions/keys'
import { registerBuiltins } from './actions/registry'

// Every `src/<view>/view.tsx` registers its pane view on import. A new pane kind
// (editor, browser, mission) therefore needs no edit here.
import.meta.glob('./*/view.tsx', { eager: true })
import './terminal/cmd-view'
import Sidebar from './mission/Sidebar'
import Home from './home/Home'
import ErrorBoundary from './panes/ErrorBoundary'

registerBuiltins(store)

export default function App() {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)

  // No tab at boot: Home shows until the user opens or resumes something.
  useEffect(() => installKeys(), [])

  return (
    <div className="app">
      <div className="app-main">
      <div className="tabbar">
        <div className={`tab-home${activeTab === '' ? ' active' : ''}`} title="Home (⌘⇧H)" onMouseDown={() => store.getState().showHome()}>
          ⌂
        </div>
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`tab${t.id === activeTab ? ' active' : ''}`}
            onMouseDown={() => store.getState().goToTab(i)}
          >
            <span className="tab-title">{panes[t.focused]?.title || 'shell'}</span>
            <button
              className="tab-close"
              title="Close tab"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                void store.getState().closeTab(t.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="tab-new" onMouseDown={() => void store.getState().newTab()}>
          +
        </div>
      </div>
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
        {activeTab === '' && (
          <ErrorBoundary label="Home">
            <Home />
          </ErrorBoundary>
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

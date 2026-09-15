import { useEffect } from 'react'
import { store, useApp } from './layout/app-store'
import SplitView from './layout/SplitView'
import Palette from './palette/Palette'
import { installKeys } from './actions/keys'
import { registerBuiltins } from './actions/registry'

registerBuiltins(store)

/** StrictMode runs effects twice before the first newTab resolves; boot exactly once. */
let booted = false

export default function App() {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)

  useEffect(() => {
    if (!booted && store.getState().tabs.length === 0) {
      booted = true
      void store.getState().newTab()
    }
    return installKeys()
  }, [])

  return (
    <div className="app">
      <div className="tabbar">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`tab${t.id === activeTab ? ' active' : ''}`}
            onMouseDown={() => store.getState().goToTab(i)}
          >
            {panes[t.focused]?.title || 'shell'}
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
            <SplitView node={t.root} />
          </div>
        ))}
      </div>
      <Palette />
    </div>
  )
}

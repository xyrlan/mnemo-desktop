import { useStore } from 'zustand'
import { SquareDashedMousePointer } from 'lucide-react'
import { leaves } from '../layout/tree'
import type { State } from '../layout/store'
import { DesignCard } from './DesignCard'
import { design, useAgentTarget } from './design-live'

/** The pane `browser.design-mode` acts on: the focused pane when it is a browser, else the
 *  active tab's first browser pane; null when the tab shows none. */
export function designPane(s: Pick<State, 'tabs' | 'activeTab' | 'panes'>): number | null {
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  if (!tab) return null
  if (s.panes[tab.focused]?.view === 'browser') return tab.focused
  return leaves(tab.root).find((id) => s.panes[id]?.view === 'browser') ?? null
}

/** Design Mode's toggle in the pane's bar, lit while it is on. */
export function DesignToggle({ id }: { id: number }) {
  const on = useStore(design.store, (s) => !!s.panes[id] && s.panes[id].mode !== 'sent')
  return (
    <button
      type="button"
      className={`browser-design${on ? ' on' : ''}`}
      title={on ? 'Leave Design Mode' : 'Design Mode: pick an element on the page and send it to the agent'}
      aria-label="Design Mode"
      aria-pressed={on}
      onClick={() => design.toggle(id)}
    >
      <SquareDashedMousePointer size={15} strokeWidth={1.75} />
    </button>
  )
}

function LiveCard({ id }: { id: number }) {
  const target = useAgentTarget()
  return <DesignCard id={id} design={design} target={target} copy={(text) => navigator.clipboard.writeText(text)} />
}

/** The strip under the bar while Design Mode is on; nothing otherwise, so a pane not using it
 *  never follows the fleet. */
export function DesignStrip({ id }: { id: number }) {
  const on = useStore(design.store, (s) => id in s.panes)
  return on ? <LiveCard id={id} /> : null
}

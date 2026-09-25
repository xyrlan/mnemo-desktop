import { useStore } from 'zustand'
import { SquareDashedMousePointer } from 'lucide-react'
import { leaves } from '../layout/tree'
import type { Actions, State } from '../layout/store'
import { DesignCard } from './DesignCard'
import type { DesignMode } from './design'
import { BLANK } from './url'
import { design, useAgentTarget } from './design-live'

/** The pane `browser.design-mode` acts on: the focused pane when it is a browser, else the
 *  active tab's first browser pane; null when the tab shows none. */
export function designPane(s: Pick<State, 'tabs' | 'activeTab' | 'panes'>): number | null {
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  if (!tab) return null
  if (s.panes[tab.focused]?.view === 'browser') return tab.focused
  return leaves(tab.root).find((id) => s.panes[id]?.view === 'browser') ?? null
}

/** ⌘K "Design Mode": toggles it on the tab's browser pane. With none open it opens one, whose
 *  blank page says what to do, and Design Mode waits there for a page to arm; so does a pane
 *  still on a blank page. `url` is what a pane's page has loaded, if anything. */
export function runDesignMode(
  layout: { getState(): Pick<State, 'tabs' | 'activeTab' | 'panes'> & Pick<Actions, 'openView'> },
  design: Pick<DesignMode, 'toggle' | 'wait'>,
  url: (id: number) => string | undefined,
) {
  const id = designPane(layout.getState())
  if (id !== null) {
    const page = url(id)
    return design.toggle(id, !!page && page !== BLANK)
  }
  layout.getState().openView('browser', { url: '' }, 'auto', 'browser')
  const opened = designPane(layout.getState())
  if (opened !== null) design.wait(opened)
}

/** Design Mode's toggle in the pane's bar, named in words and lit while it is on. `ready` is
 *  false while the pane has no page: turning it on then waits for one. */
export function DesignToggle({ id, ready = true }: { id: number; ready?: boolean }) {
  const on = useStore(design.store, (s) => !!s.panes[id] && s.panes[id].mode !== 'sent')
  return (
    <button
      type="button"
      className={`browser-design${on ? ' on' : ''}`}
      title={on ? 'Leave Design Mode' : 'Design Mode: pick an element on the page and send it to the agent'}
      aria-label="Design Mode"
      aria-pressed={on}
      onClick={() => design.toggle(id, ready)}
    >
      <SquareDashedMousePointer size={14} strokeWidth={1.75} />
      <span>Design</span>
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

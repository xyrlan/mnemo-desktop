// Panels: what the ship's windows become (docs/superpowers/specs/2026-11-10-recreation-design.md,
// "The frame"). A panel takes the right side of the screen, never covers the stage's terminal
// column entirely, and closes with Esc. `route.panel` names the open one, so a panel has a URL.
//
// Each panel lives in its own folder and registers itself on import:
//
//   // src/panels/missions/index.tsx
//   registerPanel({ id: 'missions', title: 'Missions', Component: MissionsPanel })

import { useEffect } from 'react'
import { Kbd, Label } from '../ds'
import { go, useRoute, type PanelId } from '../world/route'
import { panelOf } from './registry'
import './panels.css'

export { panels, registerPanel, type PanelSpec } from './registry'

export const openPanel = (id: PanelId): void => go({ panel: id, command: false })
export const closePanel = (): void => go({ panel: null })

// Every folder beside this file is a panel; importing it registers it.
import.meta.glob('./*/index.tsx', { eager: true })

/** The open panel, or nothing. The frame renders this once, over its views. */
export function Panels() {
  const id = useRoute((r) => r.panel)
  const spec = panelOf(id)
  useEffect(() => {
    if (!spec) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        closePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [spec])
  if (!spec) return null
  const { Component } = spec
  return (
    <aside className="mn-panel" data-panel={spec.id} data-size={spec.size ?? 'side'} role="dialog" aria-label={spec.title}>
      <header className="mn-panel-head">
        <div>
          <h2 className="mn-panel-title">{spec.title}</h2>
          {spec.hint && <Label>{spec.hint}</Label>}
        </div>
        <button type="button" className="mn-panel-close" onClick={closePanel}>
          <Kbd>Esc</Kbd> close
        </button>
      </header>
      <div className="mn-panel-body">
        <Component />
      </div>
    </aside>
  )
}

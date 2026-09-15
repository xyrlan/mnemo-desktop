import type { ComponentType } from 'react'

/** A pane view renders one leaf of the layout tree. `terminal` is built in;
 *  sub-projects register their own (editor, browser, mission) without touching
 *  SplitView or the store. */
export type PaneViewProps = { id: number; props: Record<string, unknown> }

const views = new Map<string, ComponentType<PaneViewProps>>()

export function registerPaneView(view: string, component: ComponentType<PaneViewProps>) {
  views.set(view, component)
}

export function paneView(view: string): ComponentType<PaneViewProps> | undefined {
  return views.get(view)
}

export function paneViews(): string[] {
  return [...views.keys()]
}

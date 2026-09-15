import type { PaneId } from './tree'

/** Takes new props into an existing pane of the view. Returns false to decline, in which
 *  case `openView(…, 'auto')` places a fresh pane instead (an editor with unsaved edits). */
export type ReuseFn = (id: PaneId, props: Record<string, unknown>) => boolean

const handlers = new Map<string, ReuseFn>()

/** Views whose props are read once at mount register here; without a handler the store
 *  replaces the pane's props in place, which only suits views that render from props. */
export function registerReuse(view: string, fn: ReuseFn): () => void {
  handlers.set(view, fn)
  return () => {
    if (handlers.get(view) === fn) handlers.delete(view)
  }
}

export function reuseHandler(view: string): ReuseFn | undefined {
  return handlers.get(view)
}

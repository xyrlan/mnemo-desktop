import type { PaneId } from './tree'

/** Takes new props into an existing pane of the view. Returns false to decline, in which
 *  case `openView(…, 'auto')` places a fresh pane instead (an editor with unsaved edits). */
export type ReuseFn = (id: PaneId, props: Record<string, unknown>) => boolean

/** Whether pane `id` already shows what `props` ask for (an editor showing that file). A view
 *  that answers it is a document view: `auto` shows the tab already showing the document before
 *  anything else, and a preview tab of it is replaced by the next preview. */
export type ShowsFn = (id: PaneId, props: Record<string, unknown>) => boolean

const handlers = new Map<string, { fn: ReuseFn; shows?: ShowsFn }>()

/** Views whose props are read once at mount register here; without a handler the store
 *  replaces the pane's props in place, which only suits views that render from props. */
export function registerReuse(view: string, fn: ReuseFn, shows?: ShowsFn): () => void {
  const entry = { fn, shows }
  handlers.set(view, entry)
  return () => {
    if (handlers.get(view) === entry) handlers.delete(view)
  }
}

export function reuseHandler(view: string): ReuseFn | undefined {
  return handlers.get(view)?.fn
}

export function showsHandler(view: string): ShowsFn | undefined {
  return handlers.get(view)?.shows
}

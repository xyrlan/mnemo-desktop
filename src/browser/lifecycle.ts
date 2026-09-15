import type { Bounds, BrowserClient } from './client'

const HIDDEN: Bounds = { x: 0, y: 0, w: 0, h: 0 }

/** Keeps a pane's webview alive across React remounts. Splitting the tree moves a leaf
 *  to a new parent, which unmounts and remounts its view; destroying the webview there
 *  would reload the page and lose its state. A release only hides the webview and
 *  destroys it after a grace period, which a remount of the same pane cancels. */
export function makeWebviews(
  client: Pick<BrowserClient, 'create' | 'setBounds' | 'destroy'>,
  graceMs = 250,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (t: unknown) => void } = {
    set: (f, ms) => setTimeout(f, ms),
    clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  },
) {
  const leaving = new Map<number, unknown>()
  const urls = new Map<number, string>()

  return {
    /** Shows the pane's webview at `b`, creating it on `url` unless it is still alive. */
    acquire(id: number, url: string, b: Bounds): Promise<void> {
      const pending = leaving.get(id)
      if (pending !== undefined) {
        timers.clear(pending)
        leaving.delete(id)
        return client.setBounds(id, b)
      }
      urls.set(id, url)
      return client.create(id, url, b)
    },
    release(id: number) {
      client.setBounds(id, HIDDEN).catch(() => {})
      leaving.set(
        id,
        timers.set(() => {
          leaving.delete(id)
          urls.delete(id)
          client.destroy(id).catch(() => {})
        }, graceMs),
      )
    },
    /** Last URL the pane was on, so a remounted address bar starts where the page is. */
    url: (id: number) => urls.get(id),
    remember(id: number, url: string) {
      urls.set(id, url)
    },
  }
}

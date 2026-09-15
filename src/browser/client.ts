export type Bounds = { x: number; y: number; w: number; h: number }
export type PageState = { url: string; loading: boolean }
type Unlisten = () => void

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
export type Listen = <T>(event: string, cb: (payload: T) => void) => Promise<Unlisten>

export interface BrowserClient {
  create(id: number, url: string, b: Bounds): Promise<void>
  navigate(id: number, url: string): Promise<void>
  setBounds(id: number, b: Bounds): Promise<void>
  destroy(id: number): Promise<void>
  back(id: number): Promise<void>
  forward(id: number): Promise<void>
  reload(id: number): Promise<void>
  /** URL of the open PR for the branch in `cwd`, or null (no `gh`, no PR). */
  prUrl(cwd?: string): Promise<string | null>
  onState(id: number, cb: (s: PageState) => void): Promise<Unlisten>
  onTitle(id: number, cb: (title: string) => void): Promise<Unlisten>
}

/** Webview commands run on Tauri's async pool, so two invokes for the same pane can land
 *  out of order (StrictMode's create → destroy → create is the classic case). Every call
 *  for a pane therefore waits for the previous one to settle, success or not. */
export function makeBrowserClient(invoke: Invoke, listen: Listen): BrowserClient {
  const tails = new Map<number, Promise<unknown>>()
  const queued = <T,>(id: number, cmd: string, args: Record<string, unknown> = {}): Promise<T> => {
    const run = (tails.get(id) ?? Promise.resolve()).then(
      () => invoke<T>(cmd, { id, ...args }),
      () => invoke<T>(cmd, { id, ...args }),
    )
    const tail = run.catch(() => undefined)
    tails.set(id, tail)
    void tail.then(() => {
      if (tails.get(id) === tail) tails.delete(id)
    })
    return run
  }

  return {
    create: (id, url, b) => queued(id, 'browser_create', { url, ...b }),
    navigate: (id, url) => queued(id, 'browser_navigate', { url }),
    setBounds: (id, b) => queued(id, 'browser_set_bounds', { ...b }),
    destroy: (id) => queued(id, 'browser_destroy'),
    back: (id) => queued(id, 'browser_back'),
    forward: (id) => queued(id, 'browser_forward'),
    reload: (id) => queued(id, 'browser_reload'),
    prUrl: (cwd) => invoke<string | null>('browser_pr_url', { cwd: cwd ?? null }),
    onState: (id, cb) => listen<PageState>(`browser://state/${id}`, cb),
    onTitle: (id, cb) => listen<{ title: string }>(`browser://title/${id}`, (p) => cb(p.title)),
  }
}

/** Where the webview goes: the page area in window coordinates, or a zero rectangle
 *  (which the Rust side treats as hidden) when it must not cover anything. Whole pixels,
 *  so sub-pixel layout jitter does not become a stream of native resizes. */
export function pageBounds(rect: { left: number; top: number; width: number; height: number }, show: boolean): Bounds {
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  if (!show || w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: Math.round(rect.left), y: Math.round(rect.top), w, h }
}

export const sameBounds = (a: Bounds | null, b: Bounds) => !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

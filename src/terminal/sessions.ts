import type { PaneId } from '../pty/client'

/** A terminal the core holds (`pty_list`): its folder (the one it last reported, else the one it
 *  started in), the pid of the program in it, and whether that program still runs. It keeps
 *  running while the app is closed or reloading, so a restored pane can attach to it. */
export type PtyInfo = { id: number; cwd: string; pid: number; alive: boolean }

/** The terminals that outlived the page (see `src-tauri/src/pty.rs`), for the workspace restore. */
export interface SessionClient {
  list(): Promise<PtyInfo[]>
  /** Sends what terminal `id` prints to `onOutput` from now on, and resolves to the bytes that draw
   *  it as it is now, which go before any of that output. Rejects when its program has ended. */
  attach(id: PaneId, onOutput: (bytes: Uint8Array) => void): Promise<Uint8Array>
}

let provided: SessionClient | null = null

/** The terminal view offers the core's terminals when it loads (`view.tsx`), as it registers
 *  itself: the store is built without Tauri, and its `restore` may be called through a wrapper
 *  that passes the saved layout alone. */
export function provideSessions(client: SessionClient | null) {
  provided = client
}

/** The client offered by `provideSessions`; none in a test that did not offer one. */
export function providedSessions(): SessionClient | null {
  return provided
}

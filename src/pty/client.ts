import { invoke, Channel } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type PaneId = number

export interface PtyClient {
  spawn(opts: { cwd?: string; cols: number; rows: number; onOutput: (bytes: Uint8Array) => void }): Promise<PaneId>
  write(id: PaneId, data: string): Promise<void>
  resize(id: PaneId, cols: number, rows: number): Promise<void>
  kill(id: PaneId): Promise<void>
  onExit(id: PaneId, cb: (code: number | null) => void): Promise<UnlistenFn>
}

export const tauriPty: PtyClient = {
  async spawn({ cwd, cols, rows, onOutput }) {
    const ch = new Channel<ArrayBuffer | number[]>()
    ch.onmessage = (m) => onOutput(m instanceof ArrayBuffer ? new Uint8Array(m) : Uint8Array.from(m))
    return invoke<PaneId>('pty_spawn', { cwd: cwd ?? null, cols, rows, onOutput: ch })
  },
  write: (id, data) => invoke('pty_write', { id, data }),
  resize: (id, cols, rows) => invoke('pty_resize', { id, cols, rows }),
  kill: (id) => invoke('pty_kill', { id }),
  onExit: (id, cb) => listen<{ code: number | null }>(`pty://exit/${id}`, (e) => cb(e.payload.code)),
}

/** The pid of the shell a terminal pane runs, null once it has exited. Kept off `PtyClient`:
 *  only the chrome's session lookup needs it. */
export const ptyPid = (id: PaneId) => invoke<number | null>('pty_pid', { id })

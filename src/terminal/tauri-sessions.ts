import { invoke, Channel } from '@tauri-apps/api/core'
import type { PtyInfo, SessionClient } from './sessions'

const bytes = (m: ArrayBuffer | number[]) => (m instanceof ArrayBuffer ? new Uint8Array(m) : Uint8Array.from(m))

export const ptyList = () => invoke<PtyInfo[]>('pty_list')

/** `pty_list` and `pty_attach`: the terminals the core kept running while the page was away. */
export const tauriSessions: SessionClient = {
  list: ptyList,
  async attach(id, onOutput) {
    const ch = new Channel<ArrayBuffer | number[]>()
    ch.onmessage = (m) => onOutput(bytes(m))
    return bytes(await invoke<ArrayBuffer | number[]>('pty_attach', { id, onOutput: ch }))
  },
}

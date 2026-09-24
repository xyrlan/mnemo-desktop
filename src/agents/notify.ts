import { invoke } from '@tauri-apps/api/core'

/**
 * A native OS notification (`agent_notify` in `src-tauri/src/agent_hooks.rs`). Only the
 * primitive: deciding when an agent deserves one is the caller's job. Rejects when the OS
 * refuses it.
 */
export async function notifyAgent(title: string, body: string): Promise<void> {
  await invoke('agent_notify', { title, body })
}

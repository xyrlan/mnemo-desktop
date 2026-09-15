/** Desktop MCP (issue #74). No pane view: it lives in `view.tsx` because App imports every
 *  `src/*\/view.tsx`, and that import is where the webview starts answering the questions
 *  the `mnemo-desktop-mcp` binary relays through the app's socket. Rust emits
 *  `mcp://ask`; the answer goes back through `mcp_answer`. */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { store } from '../layout/app-store'
import { readBuffer } from '../terminal/buffer'
import { browserBridge, callTool, type Content, type ToolDeps } from './tools'

type Ask = { ask: number; method: string; params?: Record<string, unknown> }

const deps: ToolDeps = { state: () => store.getState(), readBuffer, browser: browserBridge }

const unlisten = listen<Ask>('mcp://ask', async ({ payload }) => {
  let content: Content[] | null = null
  let error: string | null = null
  try {
    content = await callTool(deps, payload.method, payload.params ?? {})
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  await invoke('mcp_answer', { ask: payload.ask, content, error }).catch((e) => console.warn('mcp: answer lost', e))
})

// The app binds the socket once someone is listening for its questions.
void unlisten
  .then(() => invoke<string>('mcp_socket_path'))
  .catch((e) => console.warn('mcp: not serving', e))

import.meta.hot?.dispose(() => {
  void unlisten.then((off) => off())
})

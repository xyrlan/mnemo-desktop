import type { PaneId } from '../layout/tree'
import { tail } from '../terminal/buffer'
import type { DriveResult } from './drive'
import type { McpSession } from './sessions'

/** MCP tool result content, passed through the socket and the stdio binary unchanged. */
export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export type ToolDeps = {
  /** The Nexus's sessions (`listSessions`). */
  sessions: () => McpSession[]
  /** Terminal `pane`'s lines, shown or not; undefined when it has none to read yet. */
  read: (pane: PaneId) => Promise<string[] | undefined>
  /** `desktop_app_drive`, given only in a debug build (see `drive.ts`). */
  drive?: (params: Record<string, unknown>) => Promise<DriveResult>
}

export const DEFAULT_LINES = 100
export const MAX_LINES = 5000

const text = (t: string): Content[] => [{ type: 'text', text: t }]

function paneArg(params: Record<string, unknown>): PaneId {
  const raw = params.pane
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new Error('`pane` must be a pane id from desktop_list_panes')
  return n
}

function linesArg(params: Record<string, unknown>): number {
  const raw = params.lines
  if (raw === undefined || raw === null) return DEFAULT_LINES
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('`lines` must be a number')
  return Math.min(MAX_LINES, Math.max(1, Math.floor(n)))
}

/** Answers one tool call from the MCP binary. Throws with a message the model can act on. */
export async function callTool(deps: ToolDeps, method: string, params: Record<string, unknown> = {}): Promise<Content[]> {
  switch (method) {
    case 'desktop_list_panes':
      return text(JSON.stringify(deps.sessions(), null, 2))

    case 'desktop_terminal_read': {
      const id = paneArg(params)
      if (!deps.sessions().some((s) => s.pane === id)) throw new Error(`no session has pane ${id}; desktop_list_panes lists them`)
      const lines = await deps.read(id)
      if (!lines) throw new Error(`terminal ${id} has nothing to read yet; try again`)
      const out = tail(lines, linesArg(params))
      return text(out.length ? out.join('\n') : '(the terminal is empty)')
    }

    case 'desktop_app_drive': {
      if (!deps.drive) throw new Error('desktop_app_drive only exists in a debug build of the app (pnpm tauri dev)')
      return text(JSON.stringify(await deps.drive(params)))
    }

    default:
      throw new Error(`unknown tool ${method}`)
  }
}

/** What the browser view offered `desktop_browser_read` and `desktop_pane_snapshot`, which went
 *  with the workbench (Q16). `src/browser/view.tsx` registers it still; wave 2b deletes that view,
 *  and this with it. */
export type BrowserBridge = {
  url(id: PaneId): string | undefined
  read(id: PaneId): Promise<string>
  snapshot(id: PaneId): Promise<{ mime: string; data: string }>
}

/** Nothing reads it any more. */
export function registerBrowserBridge(_: BrowserBridge) {}

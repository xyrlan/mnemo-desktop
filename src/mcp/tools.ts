import { leaves, type PaneId } from '../layout/tree'
import type { State } from '../layout/store'
import { tail } from '../terminal/buffer'

/** MCP tool result content, passed through the socket and the stdio binary unchanged. */
export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** What the browser view offers the MCP; registered from `src/browser/view.tsx`. */
export type BrowserBridge = {
  /** Where the pane's page is now (it may have navigated away from its props). */
  url(id: PaneId): string | undefined
  read(id: PaneId): Promise<string>
  snapshot(id: PaneId): Promise<{ mime: string; data: string }>
}

export type ToolDeps = {
  state: () => Pick<State, 'tabs' | 'activeTab' | 'panes'>
  readBuffer: (id: PaneId) => string[] | undefined
  browser: () => BrowserBridge | undefined
}

export type PaneInfo = {
  pane: PaneId
  view: string
  title?: string
  cwd?: string
  url?: string
  /** 1-based, as ⌘1-9 counts. */
  tab: number
  activeTab: boolean
  focused: boolean
  sessionId?: string
  exitCode?: number | null
}

export const DEFAULT_LINES = 100
export const MAX_LINES = 5000

const text = (t: string): Content[] => [{ type: 'text', text: t }]

export function listPanes(deps: ToolDeps): PaneInfo[] {
  const s = deps.state()
  const bridge = deps.browser()
  return s.tabs.flatMap((t, i) =>
    leaves(t.root).map((id) => {
      const p = s.panes[id]
      const url = p?.view === 'browser' ? bridge?.url(id) ?? (typeof p.props?.url === 'string' ? p.props.url : undefined) : undefined
      const info: PaneInfo = {
        pane: id,
        view: p?.view ?? 'unknown',
        title: p?.title,
        cwd: p?.cwd,
        url: url || undefined,
        tab: i + 1,
        activeTab: t.id === s.activeTab,
        focused: t.focused === id,
        sessionId: p?.sessionId,
        exitCode: p?.exitCode,
      }
      return Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)) as PaneInfo
    }),
  )
}

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

function paneOf(deps: ToolDeps, id: PaneId, view: string, tool: string) {
  const p = deps.state().panes[id]
  if (!p) throw new Error(`no pane ${id}; desktop_list_panes lists the open ones`)
  if (p.view !== view) {
    const hint = p.view === 'terminal' ? 'desktop_terminal_read' : p.view === 'browser' ? 'desktop_browser_read' : null
    throw new Error(`pane ${id} is a ${p.view} pane; ${tool} reads ${view} panes${hint ? ` (use ${hint})` : ''}`)
  }
  return p
}

/** Answers one tool call from the MCP binary. Throws with a message the model can act on. */
export async function callTool(deps: ToolDeps, method: string, params: Record<string, unknown> = {}): Promise<Content[]> {
  switch (method) {
    case 'desktop_list_panes':
      return text(JSON.stringify(listPanes(deps), null, 2))

    case 'desktop_terminal_read': {
      const id = paneArg(params)
      paneOf(deps, id, 'terminal', method)
      const lines = deps.readBuffer(id)
      if (!lines) throw new Error(`terminal pane ${id} is not on screen yet`)
      const out = tail(lines, linesArg(params))
      return text(out.length ? out.join('\n') : '(the terminal is empty)')
    }

    case 'desktop_browser_read': {
      const id = paneArg(params)
      paneOf(deps, id, 'browser', method)
      return text(await bridgeOf(deps).read(id))
    }

    case 'desktop_pane_snapshot': {
      const id = paneArg(params)
      paneOf(deps, id, 'browser', method)
      const shot = await bridgeOf(deps).snapshot(id)
      return [{ type: 'image', data: shot.data, mimeType: shot.mime }]
    }

    default:
      throw new Error(`unknown tool ${method}`)
  }
}

function bridgeOf(deps: ToolDeps): BrowserBridge {
  const b = deps.browser()
  if (!b) throw new Error('browser panes are not loaded in this build')
  return b
}

let bridge: BrowserBridge | undefined

export function registerBrowserBridge(b: BrowserBridge) {
  bridge = b
}

export const browserBridge = () => bridge

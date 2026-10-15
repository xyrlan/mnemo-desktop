import type { Pane, Tab } from '../layout/store'
import type { PaneId } from '../layout/tree'
import type { HostedSession, SessionKey } from '../session/host'
import type { DrawerTab } from '../nexus/store'

/** Where a transcript lands (spec `2026-10-15-nexus-app-design.md`, Q12). Resolved when dictation
 *  starts, so the text goes where the user was when they began speaking. */
export type DictationTarget =
  /** A live terminal: the drawer's active tab's, by its PTY. */
  | { kind: 'pty'; pane: PaneId }
  /** A focused text field: the bridge's prompt, or any other the user is typing in. */
  | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'editable'; el: HTMLElement }

/** What a target is resolved from: the Nexus's drawer, the session host's PTYs and the layout's
 *  panes (the session registry). `tabs`, `activeTab` and `activeTab`'s focused pane are the
 *  workbench's, read only while the Nexus is closed. */
export type Where = {
  nexus: { open: boolean; tabs: DrawerTab[]; activeTab: string | null; collapsed: boolean }
  sessions: Record<SessionKey, HostedSession>
  layout: { tabs: Tab[]; activeTab: string; panes: Record<PaneId, Pane> }
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel'])

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled
}

function isEditable(el: HTMLElement): boolean {
  const attr = el.closest('[contenteditable]')?.getAttribute('contenteditable')
  return el.isContentEditable || attr === '' || attr === 'true' || attr === 'plaintext-only'
}

/** A PTY that still runs a program. An attach's PTY is in no pane; a pane's must not have exited. */
function live(pty: PaneId | null | undefined, panes: Record<PaneId, Pane>): DictationTarget | null {
  if (pty === null || pty === undefined || pty <= 0) return null
  const pane = panes[pty]
  if (pane && (pane.view !== 'terminal' || pane.exitCode !== undefined || pane.error)) return null
  return { kind: 'pty', pane: pty }
}

/** The drawer's active tab's terminal, while the drawer is shown: a tab showing a conversation
 *  read-only, or an attach still starting, has none. */
function drawerTerminal(w: Where): DictationTarget | null {
  const { open, tabs, activeTab, collapsed } = w.nexus
  if (!open || collapsed) return null
  const tab = tabs.find((t) => t.id === activeTab)
  if (!tab?.key) return null
  return live(w.sessions[tab.key]?.pty, w.layout.panes)
}

/** The workbench's active tab's focused terminal. Only while the Nexus is closed: after wave 2b
 *  nothing closes it, and this goes with the workbench. */
function workbenchTerminal(w: Where): DictationTarget | null {
  const tab = w.layout.tabs.find((t) => t.id === w.layout.activeTab)
  return tab ? live(tab.focused, w.layout.panes) : null
}

/** Where dictation types (Q12). DOM focus first: a terminal is its PTY, a text field (the bridge's
 *  prompt, `[data-fleet-prompt] input`, among them) or a contenteditable is itself. With nothing
 *  typeable focused, the drawer's active terminal. With neither, null: dictation says so and
 *  records nothing. A palette's or a prompt's field (`data-palette`) is for choosing, not for
 *  dictating into. */
export function resolveTarget(active: Element | null, w: Where): DictationTarget | null {
  const el = active instanceof HTMLElement && !active.closest('[data-palette]') ? active : null
  if (el?.closest('.xterm')) {
    // Only the active tab's terminal is on screen in the drawer; a workbench pane says its PTY.
    if (el.closest('[data-nexus-drawer]')) return drawerTerminal(w)
    const paneEl = w.nexus.open ? null : el.closest<HTMLElement>('.pane[data-pane]')
    const t = paneEl ? live(Number(paneEl.dataset.pane), w.layout.panes) : null
    if (t) return t
  } else if (el) {
    if (isTextField(el)) return { kind: 'field', el }
    if (isEditable(el)) return { kind: 'editable', el }
  }
  return w.nexus.open ? drawerTerminal(w) : workbenchTerminal(w)
}

/** What the indicator says when dictation has nowhere to type. */
export const NOWHERE = 'Nowhere to dictate: open a session in the drawer, or click the prompt'

/** A space between the text before the caret and the transcript, unless one side already
 *  has it or the transcript opens with punctuation. */
export function withSeparator(before: string, text: string): string {
  return before && !/\s$/.test(before) && !/^[\s.,!?;:]/.test(text) ? ` ${text}` : text
}

export function insertInField(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const t = withSeparator(el.value.slice(0, start), text)
  el.focus()
  // execCommand keeps the field's undo stack; where it is missing (jsdom) edit the value and
  // announce it, which React's onChange also picks up.
  if (document.activeElement === el && typeof document.execCommand === 'function' && document.execCommand('insertText', false, t)) return
  el.setRangeText(t, start, end, 'end')
  el.dispatchEvent(new InputEvent('input', { bubbles: true, data: t, inputType: 'insertText' }))
}

export type Sinks = {
  writePty(pane: PaneId, text: string): Promise<void>
}

/** Resolves false when the text had nowhere to go. A terminal gets no trailing newline:
 *  the user reads it and presses Enter. */
export async function insert(target: DictationTarget, text: string, sinks: Sinks): Promise<boolean> {
  if (!text) return false
  switch (target.kind) {
    case 'pty':
      await sinks.writePty(target.pane, text)
      return true
    case 'field':
      if (!target.el.isConnected) return false
      insertInField(target.el, text)
      return true
    case 'editable':
      if (!target.el.isConnected) return false
      target.el.focus()
      return typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
  }
}

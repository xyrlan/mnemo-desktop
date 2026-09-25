import type { Pane, Tab } from '../layout/store'
import type { PaneId } from '../layout/tree'

/** Where a transcript lands. Resolved when dictation starts, so the text goes where the
 *  user was when they began speaking. */
export type Target =
  | { kind: 'pty'; pane: PaneId }
  | { kind: 'monaco'; el: HTMLElement }
  | { kind: 'field'; el: HTMLInputElement | HTMLTextAreaElement }
  | { kind: 'editable'; el: HTMLElement }
  | { kind: 'none' }

export type Layout = { tabs: Tab[]; activeTab: string; panes: Record<PaneId, Pane> }

const NONE: Target = { kind: 'none' }
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel'])

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type) && !el.readOnly && !el.disabled
}

function isEditable(el: HTMLElement): boolean {
  const attr = el.closest('[contenteditable]')?.getAttribute('contenteditable')
  return el.isContentEditable || attr === '' || attr === 'true' || attr === 'plaintext-only'
}

/** A live shell: terminal panes carry the PTY id as their pane id. */
function terminal(pane: Pane | undefined): Target | null {
  if (!pane || pane.view !== 'terminal' || pane.id <= 0 || pane.exitCode !== undefined || pane.error) return null
  return { kind: 'pty', pane: pane.id }
}

/** DOM focus first: Monaco (its input is a textarea, so it is checked before plain fields),
 *  a terminal, a text field, a contenteditable. When nothing typeable has focus (the palette
 *  just closed, say), the active tab's focused pane. */
export function resolveTarget(active: Element | null, layout: Layout, root: ParentNode = document): Target {
  // A palette's or a prompt's field (`data-palette`) is for choosing, not for dictating into.
  const el = active instanceof HTMLElement && !active.closest('[data-palette]') ? active : null
  if (el) {
    const monaco = el.closest<HTMLElement>('.monaco-editor')
    if (monaco) return { kind: 'monaco', el: monaco }
    const paneEl = el.closest<HTMLElement>('.pane[data-pane]')
    if (el.closest('.xterm') && paneEl) {
      const t = terminal(layout.panes[Number(paneEl.dataset.pane)])
      if (t) return t
    }
    if (isTextField(el)) return { kind: 'field', el }
    if (isEditable(el)) return { kind: 'editable', el }
  }
  const tab = layout.tabs.find((t) => t.id === layout.activeTab)
  if (!tab) return NONE
  const t = terminal(layout.panes[tab.focused])
  if (t) return t
  const monaco = root.querySelector<HTMLElement>(`.pane[data-pane="${tab.focused}"] .monaco-editor`)
  return monaco ? { kind: 'monaco', el: monaco } : NONE
}

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
  /** Types at the caret of the Monaco editor rooted at `el`; false if none is found. */
  typeInMonaco(el: HTMLElement, text: string): Promise<boolean>
}

/** Resolves false when the text had nowhere to go. A terminal gets no trailing newline:
 *  the user reads it and presses Enter. */
export async function insert(target: Target, text: string, sinks: Sinks): Promise<boolean> {
  if (!text) return false
  switch (target.kind) {
    case 'pty':
      await sinks.writePty(target.pane, text)
      return true
    case 'monaco':
      return target.el.isConnected && sinks.typeInMonaco(target.el, text)
    case 'field':
      if (!target.el.isConnected) return false
      insertInField(target.el, text)
      return true
    case 'editable':
      if (!target.el.isConnected) return false
      target.el.focus()
      return typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    case 'none':
      return false
  }
}

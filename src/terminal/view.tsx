import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { tauriPty } from '../pty/client'
import { store, useApp } from '../layout/app-store'
import { xtermTheme, cssVar } from '../theme'
import { parseOsc7 } from './osc7'
import { macChord, pasteBytes } from './keymap'
import { holdFileDrop } from './file-drop'
import { bufferLines, registerBuffer } from './buffer'
import { resizeRequest } from './reattach'
import { provideSessions } from './sessions'
import { tauriSessions } from './tauri-sessions'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { openUrl } from '../github/actions'
import { openTerminalLink } from './links'
import ConversationFace from '../conversation/Face'

export default function TerminalPane({ id }: PaneViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const pane = useApp((s) => s.panes[id])
  const broken = id < 0

  useEffect(() => {
    if (broken) return
    const el = host.current!
    // Bare URLs (the addon) and OSC-8 hyperlinks (linkHandler) share one click path.
    const openLink = (_: MouseEvent, uri: string) => void openTerminalLink(uri, term.hasSelection(), openUrl)
    const term = new Terminal({
      theme: xtermTheme(),
      fontFamily: cssVar('--font-mono'),
      fontSize: parseInt(cssVar('--font-size'), 10) || 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
      linkHandler: { activate: openLink },
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon(openLink))
    term.open(el)
    try {
      // A dev build keeps the drawing buffer, so the eyes' WebKit snapshot sees terminal text.
      const webgl = new WebglAddon(import.meta.env.DEV)
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch (e) {
      console.warn('webgl unavailable, canvas fallback', e)
    }
    fit.fit()

    /** Fits the terminal to its box and tells the shell; not while the box has no size (a hidden
     *  tab), so a shell that kept running is never squeezed to xterm's 80×24 meanwhile. */
    const refit = () => {
      const d = fit.proposeDimensions()
      if (!d || !(d.cols > 0 && d.rows > 0)) return
      fit.fit()
      void tauriPty.resize(id, term.cols, term.rows)
    }
    // A shell attached again (a reload, a relaunch) comes back drawn at the size it had:
    // `CSI 8 ; rows ; cols t`, then its scrollback and screen. The terminal takes that size to draw
    // them, and fits its box again as soon as that write is parsed, before any output after it:
    // the shell prints that for the fitted size.
    let refitAfterWrite = false
    const resized = term.parser.registerCsiHandler({ final: 't' }, (params) => {
      const size = resizeRequest(params)
      if (!size) return false
      term.resize(size.cols, size.rows)
      refitAfterWrite = true
      return true
    })
    const settle = () => {
      if (!refitAfterWrite) return
      refitAfterWrite = false
      refit()
    }
    store.getState().attachSink(id, (b) => term.write(b, settle))
    // The desktop MCP reads what this pane shows (`desktop_terminal_read`).
    const unregisterBuffer = registerBuffer(id, () => bufferLines(term.buffer.active))
    // ⌘←/→/⌫/↩ as readline bytes, ⌘C/⌘V through the clipboard (an image pastes as Ctrl+V).
    // App chords (⌘K, ⌘W…) are handled by the window listener in the capture phase before
    // xterm sees them.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      const r = macChord(e)
      if (!r) return true
      if ('write' in r) {
        void tauriPty.write(id, r.write)
        return false
      }
      if (r.clipboard === 'copy') {
        const sel = term.getSelection()
        if (!sel) return true // no selection: let ⌘C reach the shell as nothing (matches Terminal.app)
        void navigator.clipboard.writeText(sel)
        return false
      }
      void pasteBytes(navigator.clipboard).then((b) => {
        if (b) void tauriPty.write(id, b)
      })
      return false
    })
    const data = term.onData((d) => {
      void tauriPty.write(id, d)
    })
    const title = term.onTitleChange((t) => store.getState().setTitle(id, t))
    const osc7 = term.parser.registerOscHandler(7, (d) => {
      const p = parseOsc7(d)
      if (p) store.getState().setCwd(id, p)
      return true
    })

    const ro = new ResizeObserver(refit)
    ro.observe(el)
    refit()
    const releaseDrop = holdFileDrop()

    return () => {
      unregisterBuffer()
      releaseDrop()
      ro.disconnect()
      data.dispose()
      title.dispose()
      osc7.dispose()
      resized.dispose()
      term.dispose()
      termRef.current = null
    }
  }, [id, broken])

  useEffect(() => {
    if (focused) termRef.current?.focus()
  }, [focused])

  const exited = pane?.exitCode !== undefined
  const close = () => void store.getState().closePane()
  return (
    <div
      className="pane-body"
      onKeyDown={exited ? close : undefined}
      tabIndex={exited || broken ? 0 : -1}
    >
      {!broken && <div ref={host} style={{ height: '100%' }} />}
      {!broken && pane?.face === 'conversation' && <ConversationFace paneId={id} />}
      {exited && (
        <div className="pane-message">[process exited with code {pane?.exitCode ?? '?'}] press any key to close</div>
      )}
      {pane?.error && (
        <div className="pane-message">
          {pane.error}
          <button onClick={close}>close</button>
        </div>
      )}
    </div>
  )
}

registerPaneView('terminal', TerminalPane)
// The workspace restore attaches each saved terminal to its shell when the shell kept running.
provideSessions(tauriSessions)

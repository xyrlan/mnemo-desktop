import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { tauriPty } from '../pty/client'
import { store, useApp } from '../layout/app-store'
import { xtermTheme, cssVar } from '../theme'
import { parseOsc7 } from './osc7'
import { macChord } from './keymap'
import { registerPaneView, type PaneViewProps } from '../panes/registry'

export default function TerminalPane({ id }: PaneViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const pane = useApp((s) => s.panes[id])
  const broken = id < 0

  useEffect(() => {
    if (broken) return
    const el = host.current!
    const term = new Terminal({
      theme: xtermTheme(),
      fontFamily: cssVar('--font-mono'),
      fontSize: parseInt(cssVar('--font-size'), 10) || 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
      macOptionIsMeta: true,
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch (e) {
      console.warn('webgl unavailable, canvas fallback', e)
    }
    fit.fit()

    store.getState().attachSink(id, (b) => term.write(b))
    // ⌘←/→/⌫/↩ as readline bytes, ⌘C/⌘V through the clipboard. App chords (⌘K, ⌘W…)
    // are handled by the window listener in the capture phase before xterm sees them.
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
      void navigator.clipboard.readText().then((t) => {
        if (t) void tauriPty.write(id, t)
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

    const ro = new ResizeObserver(() => {
      fit.fit()
      void tauriPty.resize(id, term.cols, term.rows)
    })
    ro.observe(el)
    void tauriPty.resize(id, term.cols, term.rows)

    return () => {
      ro.disconnect()
      data.dispose()
      title.dispose()
      osc7.dispose()
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

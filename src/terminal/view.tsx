import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import './terminal.css'
import { tauriPty } from '../pty/client'
import { store, useApp } from '../layout/app-store'
import { xtermTheme, cssVar } from '../theme'
import { parseOsc7, parseOsc9 } from './osc7'
import { pasteBytes, terminalKey } from './keymap'
import { detectPlatform } from '../actions/chords'
import { holdFileDrop } from './file-drop'
import { bufferLines, registerBuffer } from './buffer'
import { resizeRequest } from './reattach'
import { loadFaces, onFaces, redraw, track } from './fonts'
import { provideSessions } from './sessions'
import { tauriSessions } from './tauri-sessions'
import type { PaneViewProps } from '../panes/registry'
import { openUrl } from '../github/actions'
import { openTerminalLink } from './links'
import './shell-choice'

const platform = detectPlatform()

/** One view of terminal `id`. Several may show the same terminal at once (#423): the session
 *  host's presentations (the drawer's tabs). Each draws every byte; the one that owns the terminal
 *  sizes it and types into it, and the others are veiled, drawn at its size, until they take it
 *  back (`attachSink` in the layout store).
 *
 *  `props.present`: a presentation's view, not the pane's: it takes the terminal as it opens, and
 *  the layout's focus is not its. `props.name`:
 *  what the presentation calls it, as `owners[id].name` says while it owns the terminal (a tab's
 *  indicator). `props.active`: takes the terminal each time it turns true (a drawer tab shown
 *  again), with no remount. `props.close`: what a key closes once the program has exited; the
 *  pane's own view closes its pane.
 *
 *  A presentation hides a view with `display: none` or a box of no size: that is how the view
 *  knows it is hidden and hands the terminal to one on screen. A transform or `visibility` keeps
 *  the size, and so keeps the terminal. */
export default function TerminalPane({ id, props }: PaneViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const sinkRef = useRef<((b: Uint8Array) => void) | null>(null)
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const pane = useApp((s) => s.panes[id])
  const [owns, setOwns] = useState(true)
  const broken = id < 0
  const present = props.present === true
  const name = typeof props.name === 'string' ? props.name : undefined
  const active = props.active === true

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

    const sink = (b: Uint8Array) => term.write(b, settle)
    sinkRef.current = sink
    const mine = () => store.getState().owners[id]?.sink === sink
    /** Fits the terminal to its box and tells the shell; not while the box has no size (a hidden
     *  tab), so a shell that kept running is never squeezed to xterm's 80×24 meanwhile. A view that
     *  does not own the shell takes the size its owner gave it instead: the output is drawn for
     *  that size, and xterm reflows it, losing nothing, when this one takes the shell back. */
    const refit = () => {
      const d = fit.proposeDimensions()
      const shown = !!d && d.cols > 0 && d.rows > 0
      store.getState().showSink(id, sink, shown)
      const owner = store.getState().owners[id]
      if (owner && owner.sink !== sink) {
        if (owner.cols && owner.rows && (owner.cols !== term.cols || owner.rows !== term.rows)) term.resize(owner.cols, owner.rows)
        return
      }
      if (!shown) return
      fit.fit()
      store.getState().sizeSession(id, sink, term.cols, term.rows)
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
    const release = store.getState().attachSink(id, sink, present, name)
    setOwns(mine())
    // Taking the shell, losing it, or its owner sizing it again: this view fits anew.
    const unwatch = store.subscribe((s, prev) => {
      if (s.owners[id] === prev.owners[id]) return
      // Its own new size.
      if (s.owners[id]?.sink === sink && prev.owners[id]?.sink === sink) return
      setOwns(mine())
      refit()
    })
    // The desktop MCP reads what this pane shows (`desktop_terminal_read`).
    const unregisterBuffer = registerBuffer(id, () => bufferLines(term.buffer.active))
    // ⌘←/→/⌫/↩ as readline bytes, ⌘C/⌘V through the clipboard (an image pastes as Ctrl+V).
    // Off a Mac the clipboard is on Ctrl+C / Ctrl+V and Ctrl+Shift+C / Ctrl+Shift+V.
    // App chords (⌘K, ⌘W…) are handled by the window listener in the capture phase before
    // xterm sees them.
    term.attachCustomKeyEventHandler((e) => {
      const v = terminalKey(e, platform, term.getSelection())
      if ('pass' in v) return true
      // xterm does not cancel a key it is told to leave, and off a Mac the webview's own
      // Ctrl+V would then paste a second time through the textarea's paste event.
      if (platform !== 'mac') e.preventDefault()
      if ('write' in v) {
        if (mine()) void tauriPty.write(id, v.write)
      } else if ('copy' in v) {
        void navigator.clipboard.writeText(v.copy)
        // Ctrl+C is the interrupt again once the copy is taken, as in Windows Terminal.
        if (platform !== 'mac') term.clearSelection()
      } else if ('paste' in v) {
        void pasteBytes(navigator.clipboard).then((b) => {
          if (b && mine()) void tauriPty.write(id, b)
        })
      }
      return false
    })
    // Only the owner types into the shell: every view's xterm answers the program's queries (the
    // cursor position, focus), and the shell must get one answer.
    const data = term.onData((d) => {
      if (mine()) void tauriPty.write(id, d)
    })
    // A key, not `onData`: the terminal's own answers to the shell are data too.
    const noticed = term.onKey(() => store.getState().shellNoticed(id))
    const title = term.onTitleChange((t) => store.getState().setTitle(id, t))
    const osc7 = term.parser.registerOscHandler(7, (d) => {
      const p = parseOsc7(d)
      if (p) store.getState().setCwd(id, p)
      return true
    })
    // Windows' cmd and PowerShell report the folder with OSC 9;9 (`pty.rs`, the integration).
    const osc9 = term.parser.registerOscHandler(9, (d) => {
      const p = parseOsc9(d)
      if (p) store.getState().setCwd(id, p)
      return p !== null
    })

    const ro = new ResizeObserver(refit)
    ro.observe(el)
    refit()
    // The renderer keeps each glyph as it first drew it, and a web font's face arrives when it
    // is first used: the faces are asked for now, and each arrival draws the pane again (#315).
    let open = true
    const untrack = track(term)
    const family = term.options.fontFamily ?? ''
    const facesArrived = () => {
      if (!open) return
      redraw(term)
      refit()
    }
    void loadFaces(family, term.options.fontSize ?? 13).then(facesArrived)
    const stopFaces = onFaces(family, facesArrived)
    const releaseDrop = holdFileDrop()

    return () => {
      open = false
      untrack()
      stopFaces()
      unregisterBuffer()
      releaseDrop()
      ro.disconnect()
      data.dispose()
      noticed.dispose()
      title.dispose()
      osc7.dispose()
      osc9.dispose()
      resized.dispose()
      unwatch()
      release()
      term.dispose()
      termRef.current = null
    }
  }, [id, broken, present, name])

  useEffect(() => {
    if (active && sinkRef.current) store.getState().takeSession(id, sinkRef.current)
  }, [id, active])

  useEffect(() => {
    if (focused && !present) termRef.current?.focus()
  }, [focused, present])

  const exited = pane?.exitCode !== undefined
  const close = typeof props.close === 'function' ? () => void (props.close as () => void)() : () => void store.getState().closePane(id)
  return (
    <div
      className="pane-body terminal-body"
      onKeyDown={exited ? close : undefined}
      tabIndex={exited || broken ? 0 : -1}
    >
      {!broken && <div ref={host} style={{ height: '100%' }} />}
      {pane?.renewed && !exited && (
        <div className="pane-notice" role="status">
          The shell that ran in this pane is no longer running. This is a new one, in the same folder.
          <button onClick={() => store.getState().shellNoticed(id)}>ok</button>
        </div>
      )}
      {exited && (
        <div className="pane-message">[process exited with code {pane?.exitCode ?? '?'}] press any key to close</div>
      )}
      {!owns && !broken && !exited && (
        <div className="pane-message" data-veil="">
          Shown in another view.
          <button onClick={() => sinkRef.current && store.getState().takeSession(id, sinkRef.current)}>Show here</button>
        </div>
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

// The workspace restore attaches each saved terminal to its shell when the shell kept running.
provideSessions(tauriSessions)

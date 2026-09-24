import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { cursorPosition, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window'
import { store, useApp } from '../layout/app-store'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { makeBrowserClient, pageBounds, sameBounds, type Bounds } from './client'
import { AddressBar, barReducer, initialBar } from './address'
import { makeWebviews } from './lifecycle'
import { BLANK, normalizeUrl } from './url'
import { terminalCwd } from './pr'
import { focusedEvent, toViewport, watchPageFocus, type FocusHost } from './focus'
import { registerReuse } from '../layout/reuse'
import { DesignStrip, DesignToggle, designPane } from './design-view'
import { design } from './design-live'
import './browser.css'

export const browser = makeBrowserClient(invoke, <T,>(event: string, cb: (payload: T) => void) =>
  listen<T>(event, (e) => cb(e.payload)),
)
const webviews = makeWebviews(browser)

const focusHost: FocusHost = {
  windowFocused: () => getCurrentWindow().isFocused(),
  cursor: async () => {
    const win = getCurrentWindow()
    const [cursor, monitor, inner, size, scale] = await Promise.all([
      cursorPosition(),
      primaryMonitor(),
      win.innerPosition(),
      win.innerSize(),
      win.scaleFactor(),
    ])
    const cursorScale = monitor?.scaleFactor ?? scale
    return toViewport({ cursor, cursorScale, inner, innerHeight: size.height, scale, viewportHeight: window.innerHeight })
  },
  documentFocused: () => document.hasFocus(),
  onBlur: (cb) => {
    window.addEventListener('blur', cb)
    return () => window.removeEventListener('blur', cb)
  },
  onWindowFocus: (cb) => getCurrentWindow().onFocusChanged(({ payload }) => payload && cb()),
  emit: (event) => void emit(event).catch(() => {}),
}

/** Where each mounted pane's page is on screen, for telling which one a click focused.
 *  The watcher runs while at least one browser pane is mounted. */
const pages = new Map<number, () => Bounds>()
let unwatch: (() => void) | null = null
function trackPage(id: number, bounds: () => Bounds) {
  pages.set(id, bounds)
  unwatch ??= watchPageFocus(focusHost, () => [...pages].map(([pane, b]) => [pane, b()] as [number, Bounds]))
  return () => {
    if (pages.get(id) === bounds) pages.delete(id)
    if (pages.size === 0) {
      unwatch?.()
      unwatch = null
    }
  }
}

/** The page is a native child webview drawn over `.browser-page`, outside the DOM. It
 *  follows that element's rectangle every frame (splits, divider drags, window resizes)
 *  and hides whenever the element is not on screen or the palette would sit under it. */
export default function BrowserPane({ id, props }: PaneViewProps) {
  // A remount (the tree was split around this pane) resumes where the page is.
  const [known] = useState(() => webviews.url(id))
  const [start] = useState(() => known ?? normalizeUrl(String(props.url ?? '')) ?? BLANK)
  const [bar, dispatch] = useReducer(barReducer, start, (url) => ({ ...initialBar(url), loading: !known && url !== BLANK }))
  const [error, setError] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)

  useEffect(() => {
    const el = page.current!
    let alive = true
    const measure = () => pageBounds(el.getBoundingClientRect(), !store.getState().paletteOpen)
    const unlisten = [
      browser.onState(id, (s) => {
        webviews.remember(id, s.url)
        dispatch({ type: 'page', ...s })
      }),
      browser.onTitle(id, (title) => {
        if (title) store.getState().setTitle(id, title)
      }),
      // Clicking into the page moves keyboard focus there: the pane follows.
      listen(focusedEvent(id), () => store.getState().focusPane(id)),
    ]

    let last: Bounds = measure()
    const untrack = trackPage(id, () => last)
    webviews.acquire(id, start, last).then(
      () => alive && setError(null),
      (e) => alive && setError(String(e)),
    )
    let frame = 0
    const follow = () => {
      const next = measure()
      if (!sameBounds(last, next)) {
        last = next
        browser.setBounds(id, next).catch(() => {})
      }
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)

    return () => {
      alive = false
      cancelAnimationFrame(frame)
      untrack()
      for (const u of unlisten) void u.then((off) => off())
      webviews.release(id)
      design.stop(id)
    }
  }, [id, start])

  // "Open URL…" lands on a blank page: put the caret where the URL goes.
  useEffect(() => {
    if (focused && bar.url === BLANK) input.current?.focus()
  }, [focused])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = barReducer(bar, { type: 'submit' })
    if (next === bar) return
    dispatch({ type: 'submit' })
    setError(null)
    webviews.remember(id, next.url)
    browser.navigate(id, next.url).catch((err) => setError(String(err)))
    input.current?.blur()
  }
  const fail = (err: unknown) => setError(String(err))

  return (
    <div className={`pane-body browser${bar.loading ? ' loading' : ''}`}>
      <AddressBar
        id={id}
        bar={bar}
        dispatch={dispatch}
        client={browser}
        input={input}
        onSubmit={submit}
        onError={fail}
        tools={<DesignToggle id={id} />}
      />
      <DesignStrip id={id} />
      <div ref={page} className="browser-page">
        {error && <div className="pane-message">{error}</div>}
      </div>
    </div>
  )
}

registerPaneView('browser', BrowserPane)

// `openView('browser', { url }, 'auto')` navigates an open browser pane; an empty url
// (the "Open URL…" action) declines so a fresh pane appears with the bar focused.
registerReuse('browser', (id, p) => {
  const url = typeof p.url === 'string' ? p.url : ''
  if (!url) return false
  const target = normalizeUrl(url)
  if (!target) return false
  browser.navigate(id, target).catch(() => {})
  return true
})

register({
  id: 'browser.open',
  title: 'Open URL…',
  run: () => store.getState().openView('browser', { url: '' }, 'auto', 'browser'),
})

register({
  id: 'browser.design-mode',
  title: 'Design Mode: pick an element in the browser for the agent',
  run: () => {
    const id = designPane(store.getState())
    if (id !== null) design.toggle(id)
  },
})

register({
  id: 'browser.open-pr',
  title: 'Open pull request for this branch',
  run: async () => {
    const url = await browser.prUrl(terminalCwd(store.getState())).catch(() => null)
    if (url) store.getState().openView('browser', { url }, 'auto', 'pull request')
  },
})

// -- mcp: read/snapshot bridge for the desktop MCP (src/browser/read.ts, src/mcp/) --
// Imports are hoisted, so they sit in this block to keep the edit in one place.
import { readPage, snapshotPage } from './read'
import { registerBrowserBridge } from '../mcp/tools'
registerBrowserBridge({
  url: (id) => webviews.url(id),
  read: (id) => readPage(invoke, id),
  snapshot: (id) => snapshotPage(invoke, id),
})
// -- end mcp --

// Runs inside the page, before any of the app's code: stands in for what Tauri's webview
// injects (`window.__TAURI_INTERNALS__`). Playwright serialises this function into an init
// script, so it must be self-contained — no imports, no closures over module scope.
//
// Commands go to `window.__previewIpc`, a function Playwright exposes from Node, where the
// scenario's `ipc` answers them. Events never leave the page: `listen`/`emit`/`unlisten` are
// kept here, and the scenario's `events` are emitted from here on their timers.

export function installTauriMock({ events }) {
  const callbacks = new Map()
  const listeners = new Map() // event name -> Set of handler callback ids
  let nextId = 1

  const transformCallback = (callback, once = false) => {
    const id = nextId++
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id)
      return callback && callback(data)
    })
    return id
  }
  const unregisterCallback = (id) => callbacks.delete(id)
  const runCallback = (id, data) => {
    const cb = callbacks.get(id)
    if (cb) cb(data)
  }

  const emitLocal = (event, payload) => {
    for (const id of listeners.get(event) ?? []) runCallback(id, { event, id, payload })
  }

  const eventPlugin = (cmd, args) => {
    switch (cmd) {
      case 'plugin:event|listen': {
        if (!listeners.has(args.event)) listeners.set(args.event, new Set())
        listeners.get(args.event).add(args.handler)
        return args.handler
      }
      case 'plugin:event|unlisten':
        listeners.get(args.event)?.delete(args.eventId)
        return null
      case 'plugin:event|emit':
      case 'plugin:event|emit_to':
        emitLocal(args.event, args.payload)
        return null
    }
  }

  // A Channel serialises to `__CHANNEL__:<id>` (its toJSON), which is how it crosses to Node.
  const invoke = async (cmd, args = {}, _options) => {
    if (cmd.startsWith('plugin:event|')) return eventPlugin(cmd, args)
    const wire = JSON.parse(JSON.stringify(args ?? {}, (_k, v) => (v instanceof ArrayBuffer ? Array.from(new Uint8Array(v)) : v)))
    const reply = await window.__previewIpc(cmd, wire)
    if (reply && reply.error !== undefined) throw reply.error
    return reply ? reply.value : null
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc: (path, protocol = 'asset') => `${protocol}://localhost/${encodeURIComponent(path)}`,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
    plugins: { path: { sep: '/', delimiter: ':' } },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, id) => {
      listeners.get(event)?.delete(id)
      callbacks.delete(id)
    },
  }
  // Node's side of a Channel: one message, in the order Tauri's Channel expects.
  const channelIndex = new Map()
  window.__previewChannelSend = (id, message) => {
    const index = channelIndex.get(id) ?? 0
    channelIndex.set(id, index + 1)
    runCallback(id, { index, message })
  }
  window.__previewEmit = emitLocal

  // Timers start at page load; an event whose listener is not up yet is lost, as it would be
  // from Rust — give such events an `afterMs`.
  window.__previewEventsDone = false
  const start = () => {
    let pending = events.length
    if (pending === 0) window.__previewEventsDone = true
    for (const { event, payload, afterMs = 0 } of events) {
      setTimeout(() => {
        emitLocal(event, payload)
        if (--pending === 0) window.__previewEventsDone = true
      }, afterMs)
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
}

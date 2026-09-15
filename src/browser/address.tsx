import { useEffect, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react'
import type { BrowserClient, DataStore } from './client'
import { externalUrl, makeDataStore, openInChrome } from './open'
import { BLANK, displayUrl, normalizeUrl } from './url'

/** Address bar state. `url` is what the page has loaded; `input` is what the field shows,
 *  which diverges from `url` only while someone is editing it. */
export type Bar = { url: string; input: string; editing: boolean; loading: boolean }

export type BarEvent =
  | { type: 'edit'; input: string }
  | { type: 'cancel' }
  | { type: 'blur' }
  | { type: 'submit' }
  | { type: 'page'; url: string; loading: boolean }

/** A blank page may never report a load, so it does not start out loading. */
export function initialBar(url: string): Bar {
  return { url, input: displayUrl(url), editing: false, loading: url !== BLANK }
}

export function barReducer(bar: Bar, e: BarEvent): Bar {
  switch (e.type) {
    case 'edit':
      return { ...bar, input: e.input, editing: true }
    case 'cancel':
      return { ...bar, input: displayUrl(bar.url), editing: false }
    case 'blur':
      return { ...bar, editing: false }
    case 'submit': {
      const target = normalizeUrl(bar.input)
      if (!target) return bar
      return { url: target, input: displayUrl(target), editing: false, loading: true }
    }
    case 'page':
      // A redirect or a click landing mid-edit must not wipe what is being typed.
      return { ...bar, url: e.url, loading: e.loading, input: bar.editing ? bar.input : displayUrl(e.url) }
  }
}

export type AddressBarProps = {
  id: number
  bar: Bar
  dispatch: (e: BarEvent) => void
  client: Pick<BrowserClient, 'back' | 'forward' | 'reload' | 'openExternal' | 'dataStore'>
  input: RefObject<HTMLInputElement | null>
  /** Navigates to what was typed; the pane owns the webview and its error line. */
  onSubmit: (e: FormEvent) => void
  onError: (err: unknown) => void
}

const stores = new WeakMap<object, () => Promise<DataStore>>()
function dataStoreOf(client: AddressBarProps['client']) {
  let ask = stores.get(client)
  if (!ask) stores.set(client, (ask = makeDataStore(client)))
  return ask
}

/** Back, forward, reload, the URL field and "Abrir no Chrome". A pane whose logins do not
 *  survive a restart (`MNEMO_BROWSER_EPHEMERAL`) says so next to the field. */
export function AddressBar({ id, bar, dispatch, client, input, onSubmit, onError }: AddressBarProps) {
  const [store, setStore] = useState<DataStore | null>(null)
  useEffect(() => {
    let alive = true
    dataStoreOf(client)().then(
      (s) => alive && setStore(s),
      () => {},
    )
    return () => {
      alive = false
    }
  }, [client])

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    dispatch({ type: 'cancel' })
    input.current?.blur()
  }
  const external = externalUrl(bar.url)

  return (
    <form className="browser-bar" onSubmit={onSubmit}>
      <button type="button" title="Back" onClick={() => client.back(id).catch(onError)}>
        ←
      </button>
      <button type="button" title="Forward" onClick={() => client.forward(id).catch(onError)}>
        →
      </button>
      <button type="button" title="Reload" onClick={() => client.reload(id).catch(onError)}>
        ↻
      </button>
      <input
        ref={input}
        value={bar.input}
        placeholder="Enter a URL or search"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => dispatch({ type: 'edit', input: e.target.value })}
        onBlur={() => dispatch({ type: 'blur' })}
        onFocus={(e) => e.target.select()}
        onKeyDown={onKey}
      />
      {store === 'ephemeral' && (
        <span className="browser-store" title="Logins neste painel somem ao fechar o app (MNEMO_BROWSER_EPHEMERAL)">
          sem login salvo
        </span>
      )}
      <button
        type="button"
        className="browser-external"
        title={external ? 'Abrir no Chrome' : 'Abrir no Chrome (nenhuma página carregada)'}
        aria-label="Abrir no Chrome"
        disabled={!external}
        onClick={() => void openInChrome(client, bar.url).catch(onError)}
      >
        ↗
      </button>
    </form>
  )
}

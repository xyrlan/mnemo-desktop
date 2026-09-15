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

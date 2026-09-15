/** Hosts that are served locally and usually have no TLS: typed bare, they get `http://`.
 *  A dotless name with a port (`devbox:4000`) counts: it is a machine, not a website. */
const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|[^/:]+\.(localhost|local|test))(:\d+)?$|^[^/:.]+:\d+$/i
const HOST = /^[^\s/?#]+\.[a-z][a-z0-9-]*(:\d+)?$/i

export const BLANK = 'about:blank'

/** Turns what someone typed into the address bar into a URL a pane may open, or a web
 *  search when it does not look like an address. `null` for empty input and for schemes
 *  the Rust side refuses (`file:`, `tauri:`…). */
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  if (/^about:blank$/i.test(text)) return BLANK

  if (/^https?:\/\//i.test(text)) return valid(text)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null

  if (!/\s/.test(text)) {
    const host = text.split(/[/?#]/, 1)[0]
    if (LOCAL_HOST.test(host)) return valid(`http://${text}`)
    if (HOST.test(host)) return valid(`https://${text}`)
  }
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

function valid(url: string): string | null {
  try {
    return new URL(url).href
  } catch {
    return null
  }
}

/** What the address bar shows for a loaded URL: a blank page shows nothing. */
export function displayUrl(url: string): string {
  return url === BLANK ? '' : url
}

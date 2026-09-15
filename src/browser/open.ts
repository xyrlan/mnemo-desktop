import type { BrowserClient, DataStore } from './client'

/** The page a pane can hand to Chrome: what it has loaded, when that is an http(s) page.
 *  A blank page, or anything the Rust side would refuse, gives null (the button disables). */
export function externalUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** Opens the pane's page in the user's own browser; resolves false when there is nothing
 *  to open, rejects with the Rust error when no browser could be launched. */
export async function openInChrome(client: Pick<BrowserClient, 'openExternal'>, url: string): Promise<boolean> {
  const target = externalUrl(url)
  if (!target) return false
  await client.openExternal(target)
  return true
}

/** The data store is fixed for the app's lifetime, so every pane shares one answer. A
 *  failed ask is not cached: the next address bar that mounts asks again. */
export function makeDataStore(client: Pick<BrowserClient, 'dataStore'>): () => Promise<DataStore> {
  let answer: Promise<DataStore> | null = null
  return () => {
    answer ??= client.dataStore().catch((e) => {
      answer = null
      throw e
    })
    return answer
  }
}

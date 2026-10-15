/** The page the app can hand to the system browser: `url`, when it is an http(s) page. Anything
 *  else, which the Rust side would refuse, gives null. */
export function externalUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

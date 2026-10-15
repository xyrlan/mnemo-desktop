import { externalUrl } from '../browser/open'

/** What a click on a terminal link does: an http(s) target opens in the system browser. Anything
 *  else is refused, and so is the mouseup that ends a drag-select
 *  across the link, so selecting a URL to copy it does not also open it. */
export function openTerminalLink(
  uri: string,
  selecting: boolean,
  open: (url: string) => void,
): boolean {
  if (selecting) return false
  const url = externalUrl(uri)
  if (!url) return false
  open(url)
  return true
}

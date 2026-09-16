import { externalUrl } from '../browser/open'

/** What a click on a terminal link does: an http(s) target opens in a browser pane, titled
 *  by its host. Anything else is refused, and so is the mouseup that ends a drag-select
 *  across the link, so selecting a URL to copy it does not also open it. */
export function openTerminalLink(
  uri: string,
  selecting: boolean,
  open: (url: string, title: string) => void,
): boolean {
  if (selecting) return false
  const url = externalUrl(uri)
  if (!url) return false
  open(url, new URL(url).host)
  return true
}

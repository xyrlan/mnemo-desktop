import { invoke } from '@tauri-apps/api/core'
import { externalUrl } from '../../../browser/open'
import { CONTRACT_DIRS } from './model'

/** What the MISSIONS window does outside itself: pages in the system browser, the contracts a repo
 *  holds, and a robot opened as a click on it does. */

/** Opens an issue or a PR in the system browser (Google Chrome, else the default one). */
export function openInBrowser(url: string): Promise<void> {
  const target = externalUrl(url)
  if (!target) return Promise.reject(new Error(`not a web page: ${url}`))
  return invoke<void>('browser_open_external', { url: target })
}

/** The names in each of the repo's contract folders; a folder that is missing lists nothing. */
export async function listContracts(root: string): Promise<{ dir: string; names: string[] }[]> {
  const base = root.replace(/[\\/]+$/, '')
  return Promise.all(
    CONTRACT_DIRS.map(async (dir) => {
      const entries = await invoke<{ name: string; is_dir: boolean }[]>('fs_list', { dir: `${base}/${dir}` }).catch(() => [])
      return { dir, names: (entries ?? []).filter((e) => !e.is_dir).map((e) => e.name) }
    }),
  )
}

/** The robot `id`'s figure on the ship, which the window covers: null when the ship does not draw
 *  it (it left, or it waits folded in a full hangar). */
export const robotFigure = (id: string): HTMLButtonElement | null =>
  [...document.querySelectorAll<HTMLElement>('[data-ship-id]')].find((e) => e.dataset.shipId === id)?.querySelector<HTMLButtonElement>('.ship-figure') ?? null

/** Opens robot `id` in the drawer exactly as a click on its figure does, once the window has
 *  closed (so the window's closing does not take the focus back from its tab). False when the ship
 *  does not draw it. */
export function openRobot(id: string, close: () => void): boolean {
  const fig = robotFigure(id)
  if (!fig) return false
  close()
  setTimeout(() => fig.isConnected && fig.click(), 0)
  return true
}

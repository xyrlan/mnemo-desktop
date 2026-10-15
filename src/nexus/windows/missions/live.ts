import { invoke } from '@tauri-apps/api/core'
import { externalUrl } from '../../../browser/open'
import { CONTRACT_DIRS } from './model'

/** What the MISSIONS window does outside itself: pages in the system browser and the contracts a
 *  repo holds. A robot opens through the window's `ctx.open`. */

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

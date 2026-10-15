import { nexusRoutes } from '../nexus/outside'
import { vault } from '../vault/app-store'
import { resolveWikilink } from '../vault/search'

/** Opens the rule `slug` in the Memory window's pages, the page of `project`'s agent first. A slug
 *  the vault does not know becomes the search, so the click still lands somewhere. */
export async function openRule(slug: string, project?: string): Promise<void> {
  if (!vault.getState().loaded) await vault.getState().load()
  const v = vault.getState()
  const agentDir = project ? v.tree.find((a) => a.name === project)?.dir : undefined
  const hit = resolveWikilink(v.tree, slug, agentDir)
  v.setMode('pages')
  nexusRoutes().pages()
  if (hit) {
    v.setQuery('')
    await v.select(hit.path)
  } else v.setQuery(slug)
}

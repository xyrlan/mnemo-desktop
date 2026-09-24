/** What the right sidebar's Memory panel shows for the worktree and session in front of you,
 *  read by `memory_feed` (`src-tauri/src/memory_feed.rs`) from what mnemo writes in its vault.
 *  Every `at` is ms since the epoch; every list is newest first except `inbox`, which keeps
 *  `mnemo inbox`'s order, oldest first. */
export type MemoryFeed = {
  /** The project as mnemo names it: the main checkout's folder name, through worktrees. */
  project: string
  /** The project's newest session briefing that is not this session's own. `path` is what
   *  `vault_page` takes. */
  briefing: { sessionId: string; date: string; tldr: string; path: string } | null
  /** The rules that fired in this session (without one, the project's latest), one per rule
   *  and source. */
  fired: Array<{ slug: string; name: string; at: number; source: 'reflex' | 'mcp' | 'denial' }>
  /** Pages extraction promoted for the project. */
  learned: Array<{ slug: string; name: string; at: number }>
  /** The project's staged pages; `key` is what `mnemo inbox --promote` / `--drop` take. */
  inbox: Array<{ key: string; type: string; title: string; excerpt: string }>
}

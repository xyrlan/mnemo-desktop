/** Mirrors `VaultLevel` in `src-tauri/src/vault.rs`, returned by `vault_level`. */
export type VaultLevel = {
  root: string | null
  /** Shared and project pages, noise left out. */
  pages: number
  /** Pages that fired at least once. */
  rules_fired: number
  /** Every fire of those pages on record; the logs are a window, so this can fall. */
  fires: number
  /** Pages that fired in the last 7 days. */
  fired_recent: number
  dormant: number
  label_only: number
  /** Pages staged in `shared/_inbox/<type>/`, as `mnemo inbox` counts them; rewrites left out. */
  inbox: number
  error: string | null
}

/** Mirrors `ProjectLevel` in `src-tauri/src/vault.rs`: `VaultLevel`'s xp numbers over one project. */
export type ProjectLevel = {
  /** The repo agent's own live pages; `shared` ones are no project's. */
  pages: number
  /** Its own and `shared` pages that fired at least once in this project. */
  rules_fired: number
  /** Every fire of those pages in this project on record. */
  fires: number
}

/** Mirrors `ProjectLevels`, returned by `vault_project_levels`: every project by name. */
export type ProjectLevels = {
  root: string | null
  projects: Record<string, ProjectLevel>
  error: string | null
}

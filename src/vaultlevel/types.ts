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
  /** Proposals staged in `_inbox` folders. */
  inbox: number
  error: string | null
}

/** Mirrors `src-tauri/src/child_memory.rs`'s `ChildMemory` and friends. */

export type BriefingRef = { path: string; at: number | null }
export type RuleHit = { slug: string; at: number | null }
export type Pushback = { rule_text: string; contradicts: string[]; injected_in_session: string[]; at: number | null }

export type ChildMemory = {
  briefing: BriefingRef | null
  injected: RuleHit[]
  friction: Pushback[]
  /** `null` means the vault's MCP log carries no session id yet (xyrlan/mnemo#438):
   *  "not recorded", never guessed empty. */
  mcp_reads: string[] | null
}

export const emptyMemory: ChildMemory = { briefing: null, injected: [], friction: [], mcp_reads: null }

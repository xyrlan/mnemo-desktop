/** Mirrors `PulseEvent` in `src-tauri/src/pulse.rs`, emitted as `mnemo://pulse`. */

export type PulseKind = 'reflex' | 'tool' | 'enrich' | 'enforce' | 'catchup' | 'briefing' | 'learned' | 'friction' | 'dispatch'

export type PulseEvent = {
  /** ms since the epoch, from the log row. */
  at: number
  kind: PulseKind
  project: string
  /** The row's agent, else its project. */
  agent: string
  /** Rule slugs, without their `agent__` prefix: the vault graph's node slugs. */
  slugs: string[]
  /** The MCP tool, the tool an enrichment rode on, or the command enforcement blocked. */
  tool?: string
  hits?: number
  session_id?: string
}

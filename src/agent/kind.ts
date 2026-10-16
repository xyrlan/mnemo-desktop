/** Which agent CLI an account runs: Claude Code or Grok Build (spec
 *  `2026-10-16-grok-accounts-design.md`, decision 1). Mirrors `agent_kind::AgentKind`.
 *
 *  The selected account's kind is the app's one signal for which CLI a new pane starts and which
 *  one mnemo dispatches children on: code that types or spawns a CLI asks the kind, never names
 *  `claude`. The app exports `MNEMO_AGENT` with it into every pane and job, which mnemo reads. */

export type AgentKind = 'claude' | 'grok'

export const AGENT_KINDS: readonly AgentKind[] = ['claude', 'grok']

/** The variable the app exports with the selected account's kind. */
export const AGENT_ENV_VAR = 'MNEMO_AGENT'

/** The variable that selects one of a CLI's accounts. */
export const HOME_VAR: Record<AgentKind, string> = { claude: 'CLAUDE_CONFIG_DIR', grok: 'GROK_HOME' }

/** The CLI's executable name. */
export const binaryOf = (kind: AgentKind): string => kind

/** What a value read off the wire or an older file means: anything but `grok` is Claude, every
 *  account before the Grok round being one. */
export const kindOf = (value: unknown): AgentKind => (value === 'grok' ? 'grok' : 'claude')

/** How the kind reads in the app. */
export const KIND_LABEL: Record<AgentKind, string> = { claude: 'Claude Code', grok: 'Grok Build' }

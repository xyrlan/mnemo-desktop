import { useArm } from '../../vault/useArm'
import type { RuleChannel, RuleChip } from '../types'
import { useCards } from './context'

const REACHED: Record<RuleChannel, string> = {
  reflex: 'injected with the prompt (reflex)',
  enrichment: 'injected before this tool call',
  briefing: 'in the session briefing',
  learned: 'learned since the last session',
  mcp: 'read over MCP',
}

/** The mnemo rules that reached a turn. A click opens one in the vault pane; × disables it,
 *  armed on the first click and run on the second, like the health table's Disable. */
export function RuleChips({ rules, label }: { rules: RuleChip[]; label?: string }) {
  const { rules: act, vetoes, veto } = useCards()
  const { armed, press } = useArm()
  if (!rules.length) return null
  return (
    <div className="cv-rules">
      {label && <span className="cv-rules-label">{label}</span>}
      {rules.map((r) => {
        const v = vetoes[r.slug]
        const off = v?.state === 'disabled'
        return (
          <span key={`${r.channel}:${r.slug}`} className={`cv-rule cv-rule-${r.channel}${off ? ' cv-rule-off' : ''}`}>
            <button className="cv-rule-open" title={`${r.slug}: ${REACHED[r.channel]}. Open it in the vault`} onClick={() => act.open(r.slug)}>
              ⟡ {r.slug}
            </button>
            {off ? (
              <span className="cv-rule-state">disabled</span>
            ) : v?.state === 'running' ? (
              <span className="cv-rule-state">disabling…</span>
            ) : (
              <button
                className={`cv-rule-veto${armed === r.slug ? ' cv-armed' : ''}`}
                title={v?.state === 'failed' ? `mnemo disable-rule failed: ${v.message}` : `Disable this rule (mnemo disable-rule ${r.slug})`}
                aria-label={`Disable rule ${r.slug}`}
                onClick={() => press(r.slug) && veto(r.slug)}
              >
                {armed === r.slug ? 'really?' : v?.state === 'failed' ? '× failed' : '×'}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

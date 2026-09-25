import { useArm } from '../../vault/useArm'
import { cn } from '@/ui/cn'
import type { RuleChannel, RuleChip } from '../types'
import { useCards } from './context'

const REACHED: Record<RuleChannel, string> = {
  reflex: 'injected with the prompt (reflex)',
  enrichment: 'injected before this tool call',
  briefing: 'in the session briefing',
  learned: 'learned since the last session',
  mcp: 'read over MCP',
}

/** The mnemo rules that reached a turn, in mnemo's own colour (the one colour that is not a
 *  state). A click opens one in the vault pane; × disables it, armed on the first click and run
 *  on the second, like the health table's Disable. */
export function RuleChips({ rules, label, className }: { rules: RuleChip[]; label?: string; className?: string }) {
  const { rules: act, vetoes, veto } = useCards()
  const { armed, press } = useArm()
  if (!rules.length) return null
  return (
    <div className={cn('cv-rules mt-1 flex flex-wrap items-center gap-1', className)}>
      {label && <span className="cv-rules-label text-[11px] text-muted-foreground">{label}</span>}
      {rules.map((r) => {
        const v = vetoes[r.slug]
        const off = v?.state === 'disabled'
        return (
          <span
            key={`${r.channel}:${r.slug}`}
            data-channel={r.channel}
            className={cn(`cv-rule cv-rule-${r.channel} inline-flex h-5 items-center overflow-hidden rounded-full border border-brand/35 text-[11px]`, off && 'cv-rule-off opacity-55')}
          >
            <button
              type="button"
              className={cn('cv-rule-open h-full pr-1 pl-2 text-brand hover:bg-brand/15', off && 'line-through')}
              title={`${r.slug}: ${REACHED[r.channel]}. Open it in the vault`}
              onClick={() => act.open(r.slug)}
            >
              ⟡ {r.slug}
            </button>
            {off ? (
              <span className="cv-rule-state pr-2 pl-1 text-muted-foreground">disabled</span>
            ) : v?.state === 'running' ? (
              <span className="cv-rule-state pr-2 pl-1 text-muted-foreground">disabling…</span>
            ) : (
              <button
                type="button"
                className={cn('cv-rule-veto h-full pr-2 pl-1 text-muted-foreground hover:text-destructive', armed === r.slug && 'cv-armed text-destructive')}
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

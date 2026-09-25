import { useState, type ReactNode } from 'react'
import { BookOpen, Brain, ChevronRight, FileText, ShieldAlert, Zap } from 'lucide-react'
import { cn } from '@/ui/cn'
import type { ChildMemory } from './types'
import { groupHits, since } from './derive'

/** What the vault gave this child and what it pushed back against — visible on the
 *  mission pane itself, not only on the vault screen (round18 · child-memory). A strip under
 *  the pane's head in the right sidebar Memory panel's look (orca-redesign-e). */
export function MemoryPanel({ memory, hasSession }: { memory: ChildMemory | null; hasSession: boolean }) {
  const [open, setOpen] = useState(true)

  if (!hasSession)
    return (
      <div className="cmem cmem-empty flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground" data-ui>
        <Brain className="size-3 shrink-0 opacity-70" aria-hidden="true" />
        <span>Memory: no session yet</span>
      </div>
    )
  if (!memory) return null

  const injected = groupHits(memory.injected)
  const badge = `${injected.length} rule${injected.length === 1 ? '' : 's'} · ${memory.friction.length} pushback${memory.friction.length === 1 ? '' : 's'}`

  return (
    <div className="cmem border-b border-border" data-ui>
      <button
        type="button"
        className="cmem-head flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
        <Brain className="size-3 shrink-0" aria-hidden="true" />
        <span className="cmem-title text-[10px] font-semibold uppercase tracking-wider">Memory</span>
        <span className="cmem-badge ml-1 text-[10px] text-muted-foreground/60">{badge}</span>
      </button>
      {open && (
        <div className="cmem-body grid max-h-48 grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-2.5 overflow-y-auto px-3 pt-0.5 pb-2.5 scrollbar-sleek">
          <Group icon={FileText} label="Briefing">
            {memory.briefing ? (
              <div className="cmem-briefing truncate text-xs text-foreground" title={memory.briefing.path}>
                {memory.briefing.path.split('/').pop()} <Since at={memory.briefing.at} />
              </div>
            ) : (
              <None>not recorded</None>
            )}
          </Group>

          <Group icon={Zap} label="Rules injected">
            {injected.length ? (
              <ul className="cmem-list flex flex-col gap-0.5">
                {injected.map((g) => (
                  <li key={g.slug} className="flex min-w-0 items-baseline gap-1 text-xs">
                    <span className="cmem-slug truncate font-mono text-[11px] text-foreground" title={g.slug}>
                      {g.slug}
                    </span>
                    {g.count > 1 && <span className="cmem-count shrink-0 text-[10px] text-muted-foreground">×{g.count}</span>}
                    <Since at={g.last} />
                  </li>
                ))}
              </ul>
            ) : (
              <None>none yet</None>
            )}
          </Group>

          <Group icon={ShieldAlert} label="Pushback">
            {memory.friction.length ? (
              <ul className="cmem-list cmem-friction flex flex-col gap-1.5">
                {memory.friction.map((p, i) => (
                  <li key={`${p.rule_text}-${p.at ?? i}`} className="text-xs">
                    <div className="cmem-rule-text text-foreground">{p.rule_text}</div>
                    {p.contradicts.length > 0 && <div className="cmem-contradicts text-[11px] text-status-warning">against: {p.contradicts.join(', ')}</div>}
                    <Since at={p.at} />
                  </li>
                ))}
              </ul>
            ) : (
              <None>none yet</None>
            )}
          </Group>

          <Group icon={BookOpen} label="Read over MCP">
            {memory.mcp_reads === null ? (
              <None>not recorded</None>
            ) : memory.mcp_reads.length ? (
              <ul className="cmem-list flex flex-col gap-0.5">
                {memory.mcp_reads.map((slug) => (
                  <li key={slug} className="flex min-w-0 text-xs">
                    <span className="cmem-slug truncate font-mono text-[11px] text-foreground" title={slug}>
                      {slug}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <None>none yet</None>
            )}
          </Group>
        </div>
      )}
    </div>
  )
}

function Group({ icon: Icon, label, children }: { icon: typeof Zap; label: string; children: ReactNode }) {
  return (
    <div className="cmem-section min-w-0">
      <div className="cmem-label mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        {label}
      </div>
      {children}
    </div>
  )
}

function None({ children }: { children: ReactNode }) {
  return <div className="cmem-none text-[11px] text-muted-foreground/70">{children}</div>
}

function Since({ at }: { at: number | null }) {
  const text = since(at)
  return text ? <span className="cmem-since ml-1.5 shrink-0 text-[10px] text-muted-foreground/60">{text}</span> : null
}

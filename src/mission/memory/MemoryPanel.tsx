import { useState } from 'react'
import type { ChildMemory } from './types'
import { groupHits, since } from './derive'

/** What the vault gave this child and what it pushed back against — visible on the
 *  mission pane itself, not only on the vault screen (round18 · child-memory). */
export function MemoryPanel({ memory, hasSession }: { memory: ChildMemory | null; hasSession: boolean }) {
  const [open, setOpen] = useState(true)

  if (!hasSession) return <div className="cmem cmem-empty">memory: no session yet</div>
  if (!memory) return null

  const injected = groupHits(memory.injected)
  const badge = `${injected.length} rule${injected.length === 1 ? '' : 's'} · ${memory.friction.length} pushback${memory.friction.length === 1 ? '' : 's'}`

  return (
    <div className="cmem">
      <button className="cmem-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="cmem-title">memory</span>
        <span className="cmem-badge">{badge}</span>
      </button>
      {open && (
        <div className="cmem-body">
          <div className="cmem-section">
            <div className="cmem-label">briefing</div>
            {memory.briefing ? (
              <div className="cmem-briefing" title={memory.briefing.path}>
                {memory.briefing.path.split('/').pop()} <span className="cmem-since">{since(memory.briefing.at)}</span>
              </div>
            ) : (
              <div className="cmem-none">not recorded</div>
            )}
          </div>

          <div className="cmem-section">
            <div className="cmem-label">rules injected</div>
            {injected.length ? (
              <ul className="cmem-list">
                {injected.map((g) => (
                  <li key={g.slug}>
                    <span className="cmem-slug">{g.slug}</span>
                    {g.count > 1 && <span className="cmem-count">×{g.count}</span>}
                    <span className="cmem-since">{since(g.last)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="cmem-none">none yet</div>
            )}
          </div>

          <div className="cmem-section">
            <div className="cmem-label">pushback</div>
            {memory.friction.length ? (
              <ul className="cmem-list cmem-friction">
                {memory.friction.map((p, i) => (
                  <li key={`${p.rule_text}-${p.at ?? i}`}>
                    <div className="cmem-rule-text">{p.rule_text}</div>
                    {p.contradicts.length > 0 && <div className="cmem-contradicts">against: {p.contradicts.join(', ')}</div>}
                    <span className="cmem-since">{since(p.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="cmem-none">none yet</div>
            )}
          </div>

          <div className="cmem-section">
            <div className="cmem-label">read over MCP</div>
            {memory.mcp_reads === null ? (
              <div className="cmem-none">not recorded</div>
            ) : memory.mcp_reads.length ? (
              <ul className="cmem-list">
                {memory.mcp_reads.map((slug) => (
                  <li key={slug}>
                    <span className="cmem-slug">{slug}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="cmem-none">none yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

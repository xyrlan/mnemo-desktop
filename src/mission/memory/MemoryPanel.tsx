import { useState } from 'react'
import type { ChildMemory } from './types'
import { groupHits, since } from './derive'

/** What the vault gave this child and what it pushed back against — visible on the
 *  mission pane itself, not only on the vault screen (round18 · child-memory). */
export function MemoryPanel({ memory, hasSession }: { memory: ChildMemory | null; hasSession: boolean }) {
  const [open, setOpen] = useState(true)

  if (!hasSession) return <div className="mm mm-empty">memory: no session yet</div>
  if (!memory) return null

  const injected = groupHits(memory.injected)
  const badge = `${injected.length} rule${injected.length === 1 ? '' : 's'} · ${memory.friction.length} pushback${memory.friction.length === 1 ? '' : 's'}`

  return (
    <div className="mm">
      <button className="mm-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="mm-title">memory</span>
        <span className="mm-badge">{badge}</span>
      </button>
      {open && (
        <div className="mm-body">
          <div className="mm-section">
            <div className="mm-label">briefing</div>
            {memory.briefing ? (
              <div className="mm-briefing" title={memory.briefing.path}>
                {memory.briefing.path.split('/').pop()} <span className="mm-since">{since(memory.briefing.at)}</span>
              </div>
            ) : (
              <div className="mm-none">not recorded</div>
            )}
          </div>

          <div className="mm-section">
            <div className="mm-label">rules injected</div>
            {injected.length ? (
              <ul className="mm-list">
                {injected.map((g) => (
                  <li key={g.slug}>
                    <span className="mm-slug">{g.slug}</span>
                    {g.count > 1 && <span className="mm-count">×{g.count}</span>}
                    <span className="mm-since">{since(g.last)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mm-none">none yet</div>
            )}
          </div>

          <div className="mm-section">
            <div className="mm-label">pushback</div>
            {memory.friction.length ? (
              <ul className="mm-list mm-friction">
                {memory.friction.map((p, i) => (
                  <li key={`${p.rule_text}-${p.at ?? i}`}>
                    <div className="mm-rule-text">{p.rule_text}</div>
                    {p.contradicts.length > 0 && <div className="mm-contradicts">against: {p.contradicts.join(', ')}</div>}
                    <span className="mm-since">{since(p.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mm-none">none yet</div>
            )}
          </div>

          <div className="mm-section">
            <div className="mm-label">read over MCP</div>
            {memory.mcp_reads === null ? (
              <div className="mm-none">not recorded</div>
            ) : memory.mcp_reads.length ? (
              <ul className="mm-list">
                {memory.mcp_reads.map((slug) => (
                  <li key={slug}>
                    <span className="mm-slug">{slug}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mm-none">none yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

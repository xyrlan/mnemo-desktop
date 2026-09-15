import { useEffect } from 'react'
import { useVault, vault } from './app-store'
import { resolveWikilink } from './search'
import { parseStale } from './stale'
import type { Review, RunResult } from './types'

const short = (path: string) => path.replace(/^\/Users\/[^/]+/, '~')

function Rows({ title, rows, empty, onOpen }: { title: string; rows: Review[]; empty: string; onOpen(path: string): void }) {
  return (
    <section className="vh-section">
      <div className="vh-section-head">
        {title} <span className="vt-count">{rows.length}</span>
      </div>
      {rows.length === 0 && <div className="vh-none">{empty}</div>}
      {rows.map((r, i) => (
        <button key={`${r.path}:${i}`} className="vh-row" disabled={!r.path} title={r.path ? short(r.path) : r.slug} onClick={() => onOpen(r.path)}>
          <span className="vh-row-name">{r.name || r.slug}</span>
          {r.reason && <span className="vh-row-reason">{r.reason}</span>}
        </button>
      ))}
    </section>
  )
}

function Text({ title, result }: { title: string; result: RunResult }) {
  const out = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n')
  const failed = result.code !== 0
  return (
    <details className="vh-text">
      <summary>
        {title}
        {failed && <span className="vh-fail"> {result.code === null ? 'not run' : `exit ${result.code}`}</span>}
      </summary>
      <pre className={failed ? 'vt-error' : undefined}>{out || '(no output)'}</pre>
    </details>
  )
}

/** Beside the graph: `mnemo status` numbers as tiles, the needs-review lists, and the raw
 *  `status` / `doctor` text. Stale runs in `cwd` (the focused terminal's repo). */
export function HealthPanel({ cwd, onOpen }: { cwd: string | undefined; onOpen(path: string): void }) {
  const health = useVault((s) => s.health)
  const stale = useVault((s) => s.stale)
  const loading = useVault((s) => s.healthLoading)
  const tree = useVault((s) => s.tree)

  useEffect(() => {
    if (!vault.getState().health) void vault.getState().loadHealth(cwd ?? '')
  }, [cwd])

  // Exit 0 with nothing printed is nothing stale, not a parse failure.
  const staleRows = !stale ? null : stale.code === 0 && !stale.stdout.trim() ? [] : parseStale(stale.stdout)
  const staleReviews: Review[] = (staleRows ?? []).map((r) => {
    const hit = r.path ? null : resolveWikilink(tree, r.slug)
    return { path: r.path ?? hit?.path ?? '', slug: r.slug, name: hit?.name ?? r.slug, reason: r.reason }
  })

  return (
    <div className="vh">
      <div className="vh-head">
        <span className="vh-title">Health</span>
        {health?.root && <span className="vt-count" title={health.root}>{short(health.root)}</span>}
        <button title="Re-run status, doctor and stale" disabled={loading} onClick={() => void vault.getState().loadHealth(cwd ?? '')}>
          {loading ? '…' : '↻'}
        </button>
      </div>
      {!health && <div className="vt-empty">{loading ? 'running mnemo status, doctor, stale…' : 'No health read yet.'}</div>}
      {health?.error && <pre className="vt-error">{health.error}</pre>}
      {health && (
        <>
          <div className="vh-tiles">
            {health.tiles.map((t) => (
              <div key={t.key} className={`vh-tile vh-${t.tone}`} title={t.detail}>
                <div className="vh-tile-value">{t.value}</div>
                <div className="vh-tile-label">{t.label}</div>
              </div>
            ))}
            <div className={`vh-tile ${health.inbox ? 'vh-warn' : 'vh-muted'}`} title="Proposals staged in _inbox">
              <div className="vh-tile-value">{health.inbox}</div>
              <div className="vh-tile-label">inbox</div>
            </div>
            <div className="vh-tile vh-muted" title="Shared and project pages with no reflex emission or MCP read on record">
              <div className="vh-tile-value">
                {health.never_fired}/{health.pages}
              </div>
              <div className="vh-tile-label">never fired</div>
            </div>
          </div>

          <div className="vh-section-title">Needs review</div>
          {stale && staleRows === null ? (
            <section className="vh-section">
              <div className="vh-section-head">stale</div>
              <pre className="vt-error">{(stale.stderr || stale.stdout).trim() || `mnemo stale exited ${stale.code}`}</pre>
              <div className="vh-none">runs in {cwd ? short(cwd) : '~'}: open a terminal in a repo to check it</div>
            </section>
          ) : (
            <Rows title="stale" rows={staleReviews} empty={`nothing stale in ${cwd ? short(cwd) : '~'}`} onOpen={onOpen} />
          )}
          <Rows title="verified without evidence" rows={health.label_only} empty="every verified rule has evidence" onOpen={onOpen} />
          <Rows title="activates_on, not fired in 30 days" rows={health.dormant} empty="every activation fired recently" onOpen={onOpen} />

          <Text title="mnemo status" result={health.status} />
          <Text title="mnemo doctor" result={health.doctor} />
        </>
      )}
    </div>
  )
}

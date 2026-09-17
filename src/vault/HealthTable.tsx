import { useEffect, useMemo, useRef, useState } from 'react'
import { useVault, vault } from './app-store'
import { EgoView } from './EgoView'
import { PageView, openInEditor, short } from './PageView'
import { applyChips, BADGE_LABEL, BADGES, BADGE_TITLE, confidenceTone, facets, reviewCount, scopeAgents, sinceText, withStale } from './rules'
import { parseStale } from './stale'
import { useArm } from './useArm'
import type { RunResult, RuleRow } from './types'

/** Rows rendered before "show more": the vault has thousands. */
export const PAGE_ROWS = 200
/** Typing waits this long before the table is read again. */
export const FILTER_MS = 200

function RawText({ title, result }: { title: string; result: RunResult }) {
  const out = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n')
  const failed = result.code !== 0
  return (
    <div className="vr-raw-block">
      <div className="vr-raw-title">
        {title}
        {failed && <span className="vh-fail"> {result.code === null ? 'not run' : `exit ${result.code}`}</span>}
      </div>
      <pre className={failed ? 'vt-error' : undefined}>{out || '(no output)'}</pre>
    </div>
  )
}

/** `mnemo status` tiles, the review count (a click shows only problems), and the raw
 *  `status` / `doctor` text behind a button. */
function Strip({ cwd, review }: { cwd: string | undefined; review: number }) {
  const health = useVault((s) => s.health)
  const loading = useVault((s) => s.healthLoading)
  const [raw, setRaw] = useState(false)
  return (
    <>
      <div className="vr-strip">
        {health?.tiles.map((t) => (
          <div key={t.key} className={`vh-tile vh-${t.tone}`} title={t.detail}>
            <div className="vh-tile-value">{t.value}</div>
            <div className="vh-tile-label">{t.label}</div>
          </div>
        ))}
        {health && (
          <button
            className={`vh-tile vr-review ${review ? 'vh-warn' : 'vh-ok'}`}
            title="Verified without evidence, dormant activations, and stale rules in this repo: click to show only problems"
            onClick={() => vault.getState().setChips({ problems: true })}
          >
            <div className="vh-tile-value">{review}</div>
            <div className="vh-tile-label">needs review</div>
          </button>
        )}
        {!health && <div className="vt-empty">{loading ? 'running mnemo status, doctor, stale…' : ''}</div>}
        <div className="vr-strip-end">
          {health?.root && <span className="vt-count" title={health.root}>{short(health.root)}</span>}
          <button disabled={!health} className={raw ? 'vt-mode-on' : ''} title="mnemo status and mnemo doctor, as printed" onClick={() => setRaw(!raw)}>
            status / doctor
          </button>
          <button title="Re-run status, doctor and stale" disabled={loading} onClick={() => void vault.getState().loadHealth(cwd ?? '')}>
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>
      {health?.error && <pre className="vt-error">{health.error}</pre>}
      {raw && health && (
        <div className="vr-raw">
          <RawText title="mnemo status" result={health.status} />
          <RawText title="mnemo doctor" result={health.doctor} />
        </div>
      )}
    </>
  )
}

function Chip({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick(): void }) {
  return (
    <button className={`vr-chip${on ? ' vr-chip-on' : ''}`} onClick={onClick}>
      {label}
      {count !== undefined && <span className="vt-count"> {count}</span>}
    </button>
  )
}

function Row({ row, selected, cwd, armed, onDisable }: { row: RuleRow; selected: boolean; cwd: string | undefined; armed: boolean; onDisable(): void }) {
  const tone = confidenceTone(row.confidence)
  const select = () => void vault.getState().select(row.path)
  const lastFired = row.last_fired ? new Date(row.last_fired).toISOString().slice(0, 10) : 'never fired'
  return (
    <tr className={`vr-row${selected ? ' vr-selected' : ''}`} onClick={select} title={short(row.path)}>
      <td className="vr-heat" title={`heat ${row.heat.toFixed(2)} · ${row.fires} fires in total`}>
        <i style={{ width: `${Math.min(100, row.heat * 20)}%` }} />
        <span>{row.heat >= 0.05 ? row.heat.toFixed(1) : '0'}</span>
      </td>
      <td className="vr-name">
        <div className="vr-name-main">{row.name}</div>
        {row.description && <div className="vr-desc">{row.description}</div>}
      </td>
      <td className="vr-type">
        {row.type}
        <div className="vr-agent">{row.agent}</div>
      </td>
      <td className="vr-conf-cell">
        <span className={`vr-conf vr-tone-${tone}`}>
          <i className={`vg-dot gr-${tone}`} />
          {row.confidence ?? '—'}
        </span>
      </td>
      <td className="vr-last" title={lastFired}>
        {sinceText(row.last_fired)}
      </td>
      <td className="vr-badges">
        {row.badges.map((b) => (
          <span key={b} className={`vr-badge vr-badge-${b}`} title={b === 'review' || b === 'stale' ? row.reasons.join('\n') || BADGE_TITLE[b] : BADGE_TITLE[b]}>
            {BADGE_LABEL[b]}
          </span>
        ))}
      </td>
      <td className="vr-acts" onClick={(e) => e.stopPropagation()}>
        <button className={`vt-destructive${armed ? ' vt-armed' : ''}`} title={`mnemo disable-rule ${row.slug}`} onClick={onDisable}>
          {armed ? 'really?' : 'Disable'}
        </button>
        <button title="mnemo reverify (dry run)" onClick={() => (select(), void vault.getState().run('reverify', cwd ?? ''))}>
          Reverify
        </button>
        <button title={`Open ${short(row.path)} in the editor`} onClick={() => openInEditor(row.path)}>
          Edit
        </button>
      </td>
    </tr>
  )
}

/** The vault's main screen: rules by heat with their badges, filters, and the selected rule's
 *  page and neighbourhood beside them. `mnemo stale` runs in `cwd`. */
export function HealthTable({ cwd, current }: { cwd: string | undefined; current: string | undefined }) {
  const rules = useVault((s) => s.rules)
  const loaded = useVault((s) => s.rulesLoaded)
  const loading = useVault((s) => s.rulesLoading)
  const scope = useVault((s) => s.scope)
  const filter = useVault((s) => s.filter)
  const chips = useVault((s) => s.chips)
  const agents = useVault((s) => s.agents)
  const selected = useVault((s) => s.selected)
  const health = useVault((s) => s.health)
  const stale = useVault((s) => s.stale)
  const [limit, setLimit] = useState(PAGE_ROWS)
  const { armed, press } = useArm()

  useEffect(() => {
    if (!vault.getState().rulesLoaded) void vault.getState().loadRules()
    if (!vault.getState().health) void vault.getState().loadHealth(cwd ?? '')
  }, [cwd])

  // The mount reads at once (above); a filter change waits for typing to pause.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) return void (mounted.current = true)
    const t = window.setTimeout(() => void vault.getState().loadRules(), FILTER_MS)
    return () => window.clearTimeout(t)
  }, [filter])

  // Exit 0 with nothing printed is nothing stale, not a parse failure.
  const staleRows = useMemo(() => (!stale ? null : stale.code === 0 && !stale.stdout.trim() ? [] : parseStale(stale.stdout)), [stale])
  const badged = useMemo(() => withStale(rules, staleRows), [rules, staleRows])
  const shown = useMemo(() => applyChips(badged, chips), [badged, chips])
  const { types, topics } = useMemo(() => facets(badged), [badged])
  useEffect(() => setLimit(PAGE_ROWS), [shown])

  const disable = (r: RuleRow) => {
    if (!press(r.path)) return
    void vault.getState().select(r.path)
    void vault.getState().run('disable', cwd ?? '')
  }
  const move = (by: number) => {
    const i = shown.findIndex((r) => r.path === selected)
    const next = shown[Math.max(0, Math.min(shown.length - 1, i < 0 ? 0 : i + by))]
    if (next) void vault.getState().select(next.path)
  }
  const setChip = (key: 'type' | 'topic', value: string) => vault.getState().setChips({ [key]: chips[key] === value ? null : value })

  return (
    <div className="vr">
      <Strip cwd={cwd} review={reviewCount(health, staleRows)} />
      <div className="vr-bar">
        <input
          value={filter}
          placeholder="Filter name, description, topics, body"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => vault.getState().setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') vault.getState().setFilter('')
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), move(e.key === 'ArrowDown' ? 1 : -1))
          }}
        />
        <select value={scope} title="Whose rules" onChange={(e) => void vault.getState().setScope(e.target.value)}>
          <option value="">every agent</option>
          {scopeAgents(agents, current).map((a) => (
            <option key={a} value={`agent:${a}`}>
              {a}
            </option>
          ))}
        </select>
        <label className="vr-toggle" title={`Only rules with a badge: ${BADGES.map((b) => BADGE_LABEL[b]).join(', ')}`}>
          <input type="checkbox" checked={chips.problems} onChange={(e) => vault.getState().setChips({ problems: e.target.checked })} />
          only problems
        </label>
        <span className="vt-count">
          {loading && !loaded ? 'reading…' : shown.length === badged.length ? `${shown.length} rules` : `${shown.length} of ${badged.length} rules`}
        </span>
        <button title="Re-read the rules" disabled={loading} onClick={() => void vault.getState().loadRules()}>
          {loading ? '…' : '↻'}
        </button>
      </div>
      <div className="vr-chips">
        {types.map((t) => (
          <Chip key={`type:${t.name}`} on={chips.type === t.name} label={t.name} count={t.count} onClick={() => setChip('type', t.name)} />
        ))}
        <span className="vr-chips-sep" />
        {chips.topic && !topics.some((t) => t.name === chips.topic) && <Chip on label={`#${chips.topic}`} onClick={() => setChip('topic', chips.topic!)} />}
        {topics.map((t) => (
          <Chip key={`topic:${t.name}`} on={chips.topic === t.name} label={`#${t.name}`} count={t.count} onClick={() => setChip('topic', t.name)} />
        ))}
      </div>
      <div className={`vr-main${selected ? ' vr-with-side' : ''}`}>
        <div className="vr-table">
          {loaded && shown.length === 0 && (
            <div className="vt-empty">{rules.length === 0 && !filter && !scope ? 'No rules: `mnemo status` names no vault, or it holds no pages.' : 'No rule matches.'}</div>
          )}
          {shown.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th title="Fires with a 30-day half-life">heat</th>
                  <th>name</th>
                  <th>type</th>
                  <th>confidence</th>
                  <th>last fired</th>
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((r) => (
                  <Row key={r.path} row={r} selected={r.path === selected} cwd={cwd} armed={armed === r.path} onDisable={() => disable(r)} />
                ))}
              </tbody>
            </table>
          )}
          {shown.length > limit && (
            <button className="vr-more" onClick={() => setLimit(limit + PAGE_ROWS)}>
              show {Math.min(PAGE_ROWS, shown.length - limit)} more of {shown.length - limit}
            </button>
          )}
        </div>
        {/* The side panel only exists once a rule is selected: the table needs the width. */}
        {selected && (
          <aside className="vr-side">
            <PageView cwd={cwd} empty="Select a rule." />
            <EgoView path={selected} />
          </aside>
        )}
      </div>
    </div>
  )
}

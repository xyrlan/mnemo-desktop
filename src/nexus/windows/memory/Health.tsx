import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { useVault, vault } from '../../../vault/app-store'
import { actionById } from '../../../vault/actions'
import { applyChips, BADGE_LABEL, BADGES, BADGE_TITLE, confidenceTone, facets, reviewCount, scopeAgents, sinceText, withStale } from '../../../vault/rules'
import { parseStale } from '../../../vault/stale'
import { pollWhileShown } from '../../../shell/while-shown'
import type { RuleRow, RunResult, Tile } from '../../../vault/types'
import { Dot, ErrorText, Loading, Quiet, short } from './kit'
import { runAction, Selected } from './PageView'

/** Rows drawn before "show more": the vault has thousands. */
export const PAGE_ROWS = 200
/** Typing waits this long before the table is read again. */
export const FILTER_MS = 200

/** `12s`, `1m 05s`. */
export function elapsedText(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** The time since `since`, a tick a second, so a slow run shows it is still going; it waits
 *  while the window is hidden and catches up when it shows. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => pollWhileShown(() => setNow(Date.now()), 1000, { wait: true }), [])
  return <span>{elapsedText(now - since)}</span>
}

function RawText({ title, result }: { title: string; result: RunResult }) {
  const out = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n')
  const failed = result.code !== 0
  return (
    <div className="nx-mem-raw-block">
      <div className="nx-section">
        {title}
        {/* No code: it could not start, was stopped, or died on a signal; stderr says which. */}
        {failed && <span className="nx-mem-bad"> {result.code === null ? 'failed' : `exit ${result.code}`}</span>}
      </div>
      <pre className={failed ? 'nx-mem-out nx-mem-bad' : 'nx-mem-out'}>{out || '(no output)'}</pre>
    </div>
  )
}

function TileBody({ value, label, tone }: { value: ReactNode; label: string; tone: Tile['tone'] | 'warn' }) {
  return (
    <>
      <span className="nx-mem-tile-value">{value}</span>
      <span className="nx-mem-tile-label">
        {tone !== 'muted' && <Dot tone={tone} />}
        {label}
      </span>
    </>
  )
}

/** `mnemo status` as tiles, what needs review, the inbox, and the raw `status` and `doctor`. */
function Strip({ cwd, review, onInbox }: { cwd: string; review: number; onInbox(): void }) {
  const health = useVault((s) => s.health)
  const loading = useVault((s) => s.healthLoading)
  const doctor = useVault((s) => s.doctor)
  const doctorSince = useVault((s) => s.doctorSince)
  const [raw, setRaw] = useState(false)
  // `doctor` is slow (26s on a ~6k-page vault): read only while its panel is open.
  useEffect(() => {
    if (raw && health && !doctor) void vault.getState().loadDoctor()
  }, [raw, health, doctor])
  const [dismissed, setDismissed] = useState<typeof health>(null)
  return (
    <>
      <div className="nx-mem-strip">
        {health?.tiles.map((t) => (
          <div key={t.key} className="nx-mem-tile" data-tone={t.tone} title={t.detail}>
            <TileBody value={t.value} label={t.label} tone={t.tone} />
          </div>
        ))}
        {health && (
          <button
            type="button"
            className="nx-mem-tile"
            data-tile="review"
            title="Verified without evidence, dormant activations, and stale rules in this repo: show only problems"
            onClick={() => vault.getState().setChips({ problems: true })}
          >
            <TileBody value={review} label="needs review" tone={review ? 'warn' : 'ok'} />
          </button>
        )}
        {health && (
          <button type="button" className="nx-mem-tile" data-tile="inbox" title="Pages staged in shared/_inbox/: read, promote or drop them" onClick={onInbox}>
            <TileBody value={health.inbox} label="inbox" tone={health.inbox ? 'warn' : 'ok'} />
          </button>
        )}
        {!health && <Loading>running mnemo status, stale…</Loading>}
        <span className="nx-mem-end">
          <button type="button" className="nx-btn" aria-pressed={raw} disabled={!health} title="mnemo status and mnemo doctor, as printed" onClick={() => setRaw(!raw)}>
            status / doctor
          </button>
          <button type="button" className="nx-btn" disabled={loading} title="Re-run status and stale" onClick={() => void vault.getState().loadHealth(cwd)}>
            {loading ? '↻…' : '↻'}
          </button>
        </span>
      </div>
      {health?.error && dismissed !== health && <ErrorText text={health.error} onDismiss={() => setDismissed(health)} />}
      {raw && health && (
        <div className="nx-mem-raw">
          <RawText title="mnemo status" result={health.status} />
          {doctor ? (
            <RawText title="mnemo doctor" result={doctor} />
          ) : (
            <Loading>
              running mnemo doctor…{doctorSince !== null && <> <Elapsed since={doctorSince} /></>}
            </Loading>
          )}
        </div>
      )}
    </>
  )
}

function Chip({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick(): void }) {
  return (
    <button type="button" className="nx-mem-chip" aria-pressed={on} onClick={onClick}>
      {label}
      {count !== undefined && <span className="nx-muted"> {count}</span>}
    </button>
  )
}

function Row({ row, selected, narrow, cwd }: { row: RuleRow; selected: boolean; narrow: boolean; cwd: string }) {
  const tone = confidenceTone(row.confidence)
  const select = () => void vault.getState().select(row.path)
  const disable = actionById('disable')!
  return (
    <tr
      className="nx-mem-tr"
      data-rule={row.slug}
      aria-selected={selected}
      tabIndex={0}
      title={short(row.path)}
      onClick={select}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) (e.preventDefault(), select())
      }}
    >
      <td className="nx-mem-heat" title={`heat ${row.heat.toFixed(2)} · ${row.fires} fires in total`}>
        {row.heat >= 0.05 ? row.heat.toFixed(1) : '0'}
        <i aria-hidden style={{ width: `${Math.min(100, row.heat * 20)}%` }} />
      </td>
      <td>
        <div className="nx-mem-name">{row.name}</div>
        {row.description && <div className="nx-muted nx-mem-sub">{row.description}</div>}
      </td>
      {!narrow && (
        <td className="nx-mem-narrow">
          {row.type}
          <div className="nx-muted nx-mem-sub">{row.agent}</div>
        </td>
      )}
      <td title={row.confidence ?? undefined}>
        <Dot tone={tone} /> {row.confidence ?? '—'}
      </td>
      {!narrow && <td className="nx-muted nx-mem-narrow">{sinceText(row.last_fired)}</td>}
      <td className="nx-mem-badges-cell">
        <span className="nx-mem-badges">
          {row.badges.map((b) => (
            <span key={b} className="nx-mem-badge" data-badge={b} title={b === 'review' || b === 'stale' ? row.reasons.join('\n') || BADGE_TITLE[b] : BADGE_TITLE[b]}>
              {BADGE_LABEL[b]}
            </span>
          ))}
        </span>
        <span className="nx-mem-row-acts" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="nx-btn" data-tone="danger" title={`mnemo disable-rule ${row.slug}`} onClick={() => void vault.getState().select(row.path).then(() => runAction(disable, cwd, row.slug))}>
            Disable
          </button>
          <button type="button" className="nx-btn" title="mnemo reverify (dry run)" onClick={() => (select(), void vault.getState().run('reverify', cwd))}>
            Reverify
          </button>
        </span>
      </td>
    </tr>
  )
}

/** Rules by heat with their badges and filters, and the selected rule beside them. `mnemo stale`
 *  runs in `cwd`; `current` is the repo's agent. */
export function Health({ cwd, current, onInbox }: { cwd: string; current: string | undefined; onInbox(): void }): JSX.Element {
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

  useEffect(() => {
    if (!vault.getState().rulesLoaded) void vault.getState().loadRules()
  }, [])
  // Health and stale belong to the repo: another repo reads them again.
  useEffect(() => {
    void vault.getState().loadHealth(cwd)
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

  const move = (by: number) => {
    const i = shown.findIndex((r) => r.path === selected)
    const next = shown[Math.max(0, Math.min(shown.length - 1, i < 0 ? 0 : i + by))]
    if (next) void vault.getState().select(next.path)
  }
  const setChip = (key: 'type' | 'topic', value: string) => vault.getState().setChips({ [key]: chips[key] === value ? null : value })
  // ↑↓ walk the table from anywhere in it that is not a text field.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <div className="nx-mem-health" onKeyDown={onKeyDown}>
      <Strip cwd={cwd} review={reviewCount(health, staleRows)} onInbox={onInbox} />
      <div className="nx-mem-bar">
        <input
          className="nx-input nx-mem-grow"
          aria-label="Filter rules"
          value={filter}
          placeholder="Filter name, description, topics, body"
          spellCheck={false}
          onChange={(e) => vault.getState().setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), move(e.key === 'ArrowDown' ? 1 : -1))
          }}
        />
        <select className="nx-input nx-mem-select" aria-label="Whose rules" value={scope} onChange={(e) => void vault.getState().setScope(e.target.value)}>
          <option value="">every agent</option>
          {scopeAgents(agents, current).map((a) => (
            <option key={a} value={`agent:${a}`}>
              {a}
            </option>
          ))}
        </select>
        <label className="nx-mem-check" title={`Only rules with a badge: ${BADGES.map((b) => BADGE_LABEL[b]).join(', ')}`}>
          <input type="checkbox" checked={chips.problems} onChange={(e) => vault.getState().setChips({ problems: e.target.checked })} />
          only problems
        </label>
        <span className="nx-muted">{loading && !loaded ? 'reading…' : shown.length === badged.length ? `${shown.length} rules` : `${shown.length} of ${badged.length} rules`}</span>
        <button type="button" className="nx-btn" disabled={loading} title="Re-read the rules" onClick={() => void vault.getState().loadRules()}>
          ↻
        </button>
      </div>
      {(types.length > 0 || topics.length > 0 || chips.topic) && (
        <div className="nx-mem-chips">
          {types.map((t) => (
            <Chip key={`type:${t.name}`} on={chips.type === t.name} label={t.name} count={t.count} onClick={() => setChip('type', t.name)} />
          ))}
          {chips.topic && !topics.some((t) => t.name === chips.topic) && <Chip on label={`#${chips.topic}`} onClick={() => setChip('topic', chips.topic!)} />}
          {topics.map((t) => (
            <Chip key={`topic:${t.name}`} on={chips.topic === t.name} label={`#${t.name}`} count={t.count} onClick={() => setChip('topic', t.name)} />
          ))}
        </div>
      )}
      <div className="nx-mem-split">
        <div className="nx-mem-list">
          {loaded && shown.length === 0 && <Quiet>{rules.length === 0 && !filter && !scope ? 'No rules: `mnemo status` names no vault, or it holds no pages.' : 'No rule matches.'}</Quiet>}
          {shown.length > 0 && (
            <table className="nx-mem-table">
              <thead>
                <tr>
                  <th className="nx-mem-w-heat" title="Fires with a 30-day half-life">
                    heat
                  </th>
                  <th>name</th>
                  {!selected && <th className="nx-mem-narrow">type</th>}
                  <th className="nx-mem-w-conf">confidence</th>
                  {!selected && <th className="nx-mem-narrow">last fired</th>}
                  <th className="nx-mem-w-badges" />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((r) => (
                  <Row key={r.path} row={r} selected={r.path === selected} narrow={!!selected} cwd={cwd} />
                ))}
              </tbody>
            </table>
          )}
          {shown.length > limit && (
            <button type="button" className="nx-btn nx-mem-more" onClick={() => setLimit(limit + PAGE_ROWS)}>
              show {Math.min(PAGE_ROWS, shown.length - limit)} more of {shown.length - limit}
            </button>
          )}
        </div>
        {selected && <Selected cwd={cwd} path={selected} />}
      </div>
    </div>
  )
}

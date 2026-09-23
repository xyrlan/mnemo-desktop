import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { listKey } from '../actions/keys'
import { useVault, vault } from './app-store'
import { EgoView } from './EgoView'
import { PageView, openInEditor, short } from './PageView'
import { applyChips, BADGE_LABEL, BADGES, BADGE_TITLE, confidenceTone, facets, reviewCount, scopeAgents, sinceText, withStale } from './rules'
import { parseStale } from './stale'
import { useArm } from './useArm'
import type { RunResult, RuleRow } from './types'

/** Closes the side panel. */
const deselect = () => vault.getState().deselect()

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
  const doctor = useVault((s) => s.doctor)
  const [raw, setRaw] = useState(false)
  // Dismissing hides this read's error; the next read (↻) shows its own.
  const [dismissed, setDismissed] = useState<typeof health>(null)
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
        {health && (
          <button
            className={`vh-tile ${health.inbox ? 'vh-warn' : 'vh-ok'}`}
            title="Pages staged in shared/_inbox/: click to read, promote or drop them"
            onClick={() => vault.getState().setMode('inbox')}
          >
            <div className="vh-tile-value">{health.inbox}</div>
            <div className="vh-tile-label">inbox</div>
          </button>
        )}
        {/* No health is always a read in flight: the mount starts one before the first paint. */}
        {!health && (
          <div className="vt-empty vt-loading" role="status">
            running mnemo status, stale…
          </div>
        )}
        <div className="vr-strip-end">
          {health?.root && <span className="vt-count" title={health.root}>{short(health.root)}</span>}
          <button
            disabled={!health}
            className={raw ? 'vt-mode-on' : ''}
            title="mnemo status and mnemo doctor, as printed"
            // `doctor` is the slow one, so it is read here rather than with the rest of the
            // health screen: opening this panel is the only thing that ever shows it.
            onClick={() => (setRaw(!raw), raw ? undefined : void vault.getState().loadDoctor())}
          >
            status / doctor
          </button>
          <button title="Re-run status and stale" disabled={loading} onClick={() => void vault.getState().loadHealth(cwd ?? '')}>
            {loading ? '…' : '↻'}
          </button>
        </div>
      </div>
      {health?.error && dismissed !== health && (
        <div className="vt-error-line">
          <pre className="vt-error">{health.error}</pre>
          <button className="vt-x" title="Dismiss" aria-label="Dismiss" onClick={() => setDismissed(health)}>
            ×
          </button>
        </div>
      )}
      {raw && health && (
        <div className="vr-raw">
          <RawText title="mnemo status" result={health.status} />
          {doctor ? <RawText title="mnemo doctor" result={doctor} /> : <div className="vt-empty vt-loading" role="status">running mnemo doctor…</div>}
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
    <tr
      className={`vr-row${selected ? ' vr-selected' : ''}`}
      onClick={select}
      title={short(row.path)}
      // Reachable by Tab, and by Enter once there. The root's handler owns ↑↓, so a focused
      // row lets them through rather than swallowing them.
      tabIndex={0}
      aria-selected={selected}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), select())
      }}
    >
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

type Tab = 'page' | 'neighbourhood'

/** The selected rule, beside the table: its page, or its neighbourhood graph. Page is the
 *  default, and the graph is only mounted while its tab is open, so `vault_ego` runs when
 *  asked for rather than on every row click. The tab outlives a change of selection (a
 *  neighbour's click keeps you in the graph) and resets when the panel closes. */
function SidePanel({ cwd, selected }: { cwd: string | undefined; selected: string }) {
  const [tab, setTab] = useState<Tab>('page')
  const tabs: [Tab, string][] = [
    ['page', 'Page'],
    ['neighbourhood', 'Neighbourhood'],
  ]
  return (
    <aside className="vr-side" aria-label="Selected rule">
      <div className="vr-side-bar">
        <div className="vr-tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={`vr-tab${tab === key ? ' vr-tab-on' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="vt-x vr-side-close" title="Close (Esc)" aria-label="Close the side panel" onClick={deselect}>
          ×
        </button>
      </div>
      <div className="vr-side-body" role="tabpanel">
        {tab === 'page' ? <PageView cwd={cwd} empty="Select a rule." /> : <EgoView path={selected} />}
      </div>
    </aside>
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

  // The table is a list: ↑↓ walk it, Enter opens the row, Esc closes the side panel — all
  // from anywhere in it that is not a text field. The root takes focus on a click inside it
  // (tabIndex -1), so a row click leaves the keys reachable.
  const onKeyDown = (e: KeyboardEvent) => {
    const k = listKey(e)
    // `open` belongs to the focused row, which handles Enter itself; `reply` and `attach`
    // are the cockpit's. Anything this handler does not act on is left alone.
    if (k !== 'up' && k !== 'down' && k !== 'close') return
    if (k === 'close' && !selected) return
    e.preventDefault()
    e.stopPropagation()
    if (k === 'close') deselect()
    else if (k === 'up') move(-1)
    else if (k === 'down') move(1)
  }

  return (
    <div className="vr" tabIndex={-1} onKeyDown={onKeyDown}>
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
        {selected && <SidePanel cwd={cwd} selected={selected} />}
      </div>
    </div>
  )
}

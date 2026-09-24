import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Ban, Filter, ShieldCheck, SquarePen, Terminal } from 'lucide-react'
import { Badge, Button } from '@/ui'
import { cn } from '@/ui/cn'
import { listKey } from '../actions/keys'
import { useVault, vault } from './app-store'
import { EgoView } from './EgoView'
import { ERROR_TEXT, ErrorLine, MONO_TEXT } from './ErrorLine'
import { PageView, openInEditor, short } from './PageView'
import { applyChips, BADGE_LABEL, BADGES, BADGE_TITLE, confidenceTone, facets, reviewCount, scopeAgents, sinceText, withStale } from './rules'
import { parseStale } from './stale'
import { useArm } from './useArm'
import { Dismiss, Dot, EMPTY, Loading, Refresh, ROW_ACTIONS, ROW_TOOLBAR, RowAction, SearchInput, SELECT, TH, Toggle, TR, TR_SELECTED } from './ui'
import type { Badge as BadgeKind, RunResult, RuleRow, Tile } from './types'

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
    <div className="vr-raw-block min-w-0 flex-1">
      <div className="vr-raw-title pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {failed && <span className="vh-fail normal-case tracking-normal text-destructive"> {result.code === null ? 'not run' : `exit ${result.code}`}</span>}
      </div>
      <pre className={failed ? ERROR_TEXT : cn(MONO_TEXT, 'text-foreground')}>{out || '(no output)'}</pre>
    </div>
  )
}

/** A tone's dot on a tile: only a state that asks for something is coloured. */
const TILE_TONE: Record<Tile['tone'] | 'warn', 'ok' | 'bad' | 'warn' | null> = { ok: 'ok', bad: 'bad', warn: 'warn', muted: null }

/** One number of the strip: Orca's stat card, its label under it, a dot when it is a state. */
function TileBody({ value, label, tone }: { value: ReactNode; label: string; tone: Tile['tone'] | 'warn' }) {
  const dot = TILE_TONE[tone]
  return (
    <>
      <div className="vh-tile-value truncate text-[16px] leading-tight font-semibold text-foreground tabular-nums">{value}</div>
      <div className="vh-tile-label flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {dot && <Dot tone={dot} />}
        {label}
      </div>
    </>
  )
}

const TILE = 'vh-tile flex min-w-[104px] flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-left'

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
      <div className="vr-strip flex flex-wrap items-stretch gap-2 px-3 pt-3 pb-2">
        {health?.tiles.map((t) => (
          <div key={t.key} className={cn(TILE, `vh-${t.tone}`)} title={t.detail}>
            <TileBody value={t.value} label={t.label} tone={t.tone} />
          </div>
        ))}
        {health && (
          <button
            type="button"
            className={cn(TILE, 'vr-review transition-colors hover:border-muted-foreground/35 hover:bg-accent/40', review ? 'vh-warn' : 'vh-ok')}
            title="Verified without evidence, dormant activations, and stale rules in this repo: click to show only problems"
            onClick={() => vault.getState().setChips({ problems: true })}
          >
            <TileBody value={review} label="needs review" tone={review ? 'warn' : 'ok'} />
          </button>
        )}
        {health && (
          <button
            type="button"
            className={cn(TILE, 'transition-colors hover:border-muted-foreground/35 hover:bg-accent/40', health.inbox ? 'vh-warn' : 'vh-ok')}
            title="Pages staged in shared/_inbox/: click to read, promote or drop them"
            onClick={() => vault.getState().setMode('inbox')}
          >
            <TileBody value={health.inbox} label="inbox" tone={health.inbox ? 'warn' : 'ok'} />
          </button>
        )}
        {/* No health is always a read in flight: the mount starts one before the first paint. */}
        {!health && <Loading>running mnemo status, stale…</Loading>}
        <div className="vr-strip-end ml-auto flex items-center gap-1 self-start">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={!health}
            className={cn('text-[11px] font-normal text-muted-foreground hover:text-foreground', raw && 'vt-mode-on bg-accent text-foreground')}
            aria-pressed={raw}
            title="mnemo status and mnemo doctor, as printed"
            // `doctor` is the slow one, so it is read here rather than with the rest of the
            // health screen: opening this panel is the only thing that ever shows it.
            onClick={() => (setRaw(!raw), raw ? undefined : void vault.getState().loadDoctor())}
          >
            <Terminal />
            status / doctor
          </Button>
          <Refresh title="Re-run status and stale" busy={loading} onClick={() => void vault.getState().loadHealth(cwd ?? '')} />
        </div>
      </div>
      {health?.error && dismissed !== health && <ErrorLine text={health.error} onDismiss={() => setDismissed(health)} className="mx-3 mb-2" />}
      {raw && health && (
        <div className="vr-raw mx-3 mb-2 flex max-h-[40%] min-h-0 gap-4 overflow-auto rounded-lg border border-border bg-card px-3 py-2">
          <RawText title="mnemo status" result={health.status} />
          {doctor ? <RawText title="mnemo doctor" result={doctor} /> : <Loading className="flex-1 py-0">running mnemo doctor…</Loading>}
        </div>
      )}
    </>
  )
}

function Chip({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cn(
        'vr-chip inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] whitespace-nowrap transition-colors',
        on ? 'vr-chip-on border-brand/50 bg-brand/15 text-foreground' : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      onClick={onClick}
    >
      {label}
      {count !== undefined && <span className="vt-count text-muted-foreground/70 tabular-nums"> {count}</span>}
    </button>
  )
}

/** A badge's colour: `review` asks for you (Orca's orange), `stale` warns, `inbox` is mnemo's own. */
const BADGE_TONE: Record<BadgeKind, string> = {
  never: 'text-muted-foreground',
  stale: 'border-status-warning-border text-status-warning',
  review: 'border-agent-question/40 text-agent-question-text',
  inbox: 'border-brand/40 text-brand',
}

function Row({ row, selected, narrow, cwd, armed, onDisable }: { row: RuleRow; selected: boolean; narrow: boolean; cwd: string | undefined; armed: boolean; onDisable(): void }) {
  const tone = confidenceTone(row.confidence)
  const select = () => void vault.getState().select(row.path)
  const lastFired = row.last_fired ? new Date(row.last_fired).toISOString().slice(0, 10) : 'never fired'
  return (
    <tr
      className={cn('vr-row group cursor-pointer outline-none focus-visible:bg-accent/40', TR, selected && cn('vr-selected', TR_SELECTED))}
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
      <td className="vr-heat py-1.5 pr-2 pl-3 align-top" title={`heat ${row.heat.toFixed(2)} · ${row.fires} fires in total`}>
        <span className="flex h-5 items-center gap-1.5">
          <span className="w-6 text-right text-[11px] text-foreground/80 tabular-nums">{row.heat >= 0.05 ? row.heat.toFixed(1) : '0'}</span>
          <span aria-hidden className="relative h-1 w-5 overflow-hidden rounded-full bg-muted">
            <i className="absolute inset-y-0 left-0 rounded-full bg-brand/70" style={{ width: `${Math.min(100, row.heat * 20)}%` }} />
          </span>
        </span>
      </td>
      <td className="vr-name min-w-0 px-2 py-1.5 align-top">
        <div className="vr-name-main truncate text-[13px] leading-5 text-foreground">{row.name}</div>
        {row.description && <div className="vr-desc truncate text-[11px] text-muted-foreground">{row.description}</div>}
      </td>
      {!narrow && (
        <td className="vr-type px-2 py-1.5 align-top text-[12px] whitespace-nowrap text-foreground">
          {row.type}
          <div className="vr-agent truncate text-[11px] text-muted-foreground">{row.agent}</div>
        </td>
      )}
      <td className="vr-conf-cell px-2 py-1.5 align-top">
        <span className={cn('vr-conf flex min-w-0 items-center gap-1.5 text-[12px] text-foreground', `vr-tone-${tone}`)} title={row.confidence ?? undefined}>
          <Dot tone={tone} />
          <span className="truncate">{row.confidence ?? '—'}</span>
        </span>
      </td>
      {!narrow && (
        <td className="vr-last px-2 py-1.5 align-top text-[12px] whitespace-nowrap text-muted-foreground tabular-nums" title={lastFired}>
          {sinceText(row.last_fired)}
        </td>
      )}
      <td className="vr-badges relative px-2 py-1.5 align-top">
        <span className="flex flex-wrap gap-1">
          {row.badges.map((b) => (
            <Badge
              key={b}
              variant="outline"
              className={cn('vr-badge h-4 rounded px-1.5 text-[10px] font-normal', `vr-badge-${b}`, BADGE_TONE[b])}
              title={b === 'review' || b === 'stale' ? row.reasons.join('\n') || BADGE_TITLE[b] : BADGE_TITLE[b]}
            >
              {BADGE_LABEL[b]}
            </Badge>
          ))}
        </span>
        <span className={cn('vr-acts', ROW_TOOLBAR, !selected && !armed && ROW_ACTIONS)} onClick={(e) => e.stopPropagation()}>
          <RowAction icon={<Ban />} label={armed ? 'really?' : 'Disable'} title={`mnemo disable-rule ${row.slug}`} armed={armed} destructive onClick={onDisable} />
          <RowAction icon={<ShieldCheck />} label="Reverify" title="mnemo reverify (dry run)" onClick={() => (select(), void vault.getState().run('reverify', cwd ?? ''))} />
          <RowAction icon={<SquarePen />} label="Edit" title={`Open ${short(row.path)} in the editor`} onClick={() => openInEditor(row.path)} />
        </span>
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
    <aside className="vr-side flex max-w-[560px] min-w-[300px] basis-[40%] flex-col border-l border-border" aria-label="Selected rule">
      <div className="vr-side-bar flex h-8 shrink-0 items-stretch gap-1 border-b border-border pr-1 pl-2">
        <div className="vr-tabs flex flex-1 items-stretch gap-1" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={cn(
                'vr-tab relative px-2 text-[12px] transition-colors',
                'after:absolute after:inset-x-1 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity',
                tab === key ? 'vr-tab-on text-foreground after:opacity-100' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <Dismiss title="Close (Esc)" label="Close the side panel" onClick={deselect} className="vt-x vr-side-close self-center" />
      </div>
      <div className="vr-side-body flex min-h-0 flex-1 flex-col" role="tabpanel">
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

  const narrow = !!selected
  return (
    <div className="vr flex min-h-0 flex-1 flex-col outline-none" tabIndex={-1} onKeyDown={onKeyDown}>
      <Strip cwd={cwd} review={reviewCount(health, staleRows)} />
      <div className="vr-bar flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2">
        <SearchInput
          className="min-w-[180px] flex-1"
          value={filter}
          placeholder="Filter name, description, topics, body"
          onChange={(v) => vault.getState().setFilter(v)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') vault.getState().setFilter('')
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') (e.preventDefault(), move(e.key === 'ArrowDown' ? 1 : -1))
          }}
        />
        <select className={SELECT} value={scope} title="Whose rules" onChange={(e) => void vault.getState().setScope(e.target.value)}>
          <option value="">every agent</option>
          {scopeAgents(agents, current).map((a) => (
            <option key={a} value={`agent:${a}`}>
              {a}
            </option>
          ))}
        </select>
        <Toggle className="vr-toggle" title={`Only rules with a badge: ${BADGES.map((b) => BADGE_LABEL[b]).join(', ')}`} checked={chips.problems} onChange={(on) => vault.getState().setChips({ problems: on })}>
          <Filter aria-hidden className="size-3" />
          only problems
        </Toggle>
        <span className="vt-count text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
          {loading && !loaded ? 'reading…' : shown.length === badged.length ? `${shown.length} rules` : `${shown.length} of ${badged.length} rules`}
        </span>
        <Refresh title="Re-read the rules" busy={loading} onClick={() => void vault.getState().loadRules()} />
      </div>
      {(types.length > 0 || topics.length > 0 || chips.topic) && (
        <div className="vr-chips flex flex-wrap items-center gap-1 px-3 pb-2">
          {types.map((t) => (
            <Chip key={`type:${t.name}`} on={chips.type === t.name} label={t.name} count={t.count} onClick={() => setChip('type', t.name)} />
          ))}
          <span className="vr-chips-sep mx-1 h-3 w-px bg-border" />
          {chips.topic && !topics.some((t) => t.name === chips.topic) && <Chip on label={`#${chips.topic}`} onClick={() => setChip('topic', chips.topic!)} />}
          {topics.map((t) => (
            <Chip key={`topic:${t.name}`} on={chips.topic === t.name} label={`#${t.name}`} count={t.count} onClick={() => setChip('topic', t.name)} />
          ))}
        </div>
      )}
      <div className={cn('vr-main flex min-h-0 flex-1 border-t border-border', selected && 'vr-with-side')}>
        <div className="vr-table min-w-0 flex-1 overflow-auto">
          {loaded && shown.length === 0 && (
            <div className={cn('vt-empty', EMPTY, 'px-3')}>{rules.length === 0 && !filter && !scope ? 'No rules: `mnemo status` names no vault, or it holds no pages.' : 'No rule matches.'}</div>
          )}
          {shown.length > 0 && (
            <table className="w-full table-fixed border-collapse">
              {/* Fixed layout takes column widths from the header: the name column has none and
                  takes whatever is left. With the side panel open, type and last-fired go. */}
              <thead>
                <tr>
                  <th className={cn(TH, 'w-[68px] pl-3')} title="Fires with a 30-day half-life">
                    heat
                  </th>
                  <th className={TH}>name</th>
                  {!narrow && <th className={cn(TH, 'w-[104px]')}>type</th>}
                  <th className={cn(TH, narrow ? 'w-[108px]' : 'w-[124px]')}>confidence</th>
                  {!narrow && <th className={cn(TH, 'w-[84px]')}>last fired</th>}
                  <th className={cn(TH, 'w-[136px]')} />
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, limit).map((r) => (
                  <Row key={r.path} row={r} selected={r.path === selected} narrow={narrow} cwd={cwd} armed={armed === r.path} onDisable={() => disable(r)} />
                ))}
              </tbody>
            </table>
          )}
          {shown.length > limit && (
            <Button type="button" variant="ghost" size="xs" className="vr-more mx-2 my-2 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setLimit(limit + PAGE_ROWS)}>
              show {Math.min(PAGE_ROWS, shown.length - limit)} more of {shown.length - limit}
            </Button>
          )}
        </div>
        {/* The side panel only exists once a rule is selected: the table needs the width. */}
        {selected && <SidePanel cwd={cwd} selected={selected} />}
      </div>
    </div>
  )
}

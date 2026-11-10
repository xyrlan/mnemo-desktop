// The rules by project: the vault's health in numbers, every project with how many rules it
// holds and how many want a look, the rules of the picked one by heat, and the selected rule
// beside them.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { pollWhileShown } from '../../shell/while-shown'
import { useVault, vault } from '../../vault/app-store'
import { applyChips, BADGE_LABEL, confidenceTone, facets, reviewCount, sinceText, withStale } from '../../vault/rules'
import type { RuleRow, RunResult, Tile } from '../../vault/types'
import { Btn, Field, Loading, Notice, Out, Quiet, ToneMark, typedElsewhere } from './kit'
import { elapsedText, ended, inProject, printed, projectsOf, staleRows, step, type Project } from './model'
import { Selected } from './PageView'
import { chooseProject, memoryPanel, showTab } from './state'

/** Rows drawn before "show more": a vault holds thousands. */
export const PAGE_ROWS = 200
/** Typing waits this long before the table is read again. */
export const FILTER_MS = 200

/** The time since `since`, a tick a second while the window shows, so a slow run shows it is
 *  still going. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => pollWhileShown(() => setNow(Date.now()), 1000, { wait: true }), [])
  return <span className="mn-num">{elapsedText(now - since)}</span>
}

function Raw({ title, result }: { title: string; result: RunResult }) {
  const failed = result.code !== 0
  return (
    <div className="memory-raw-block">
      <div className="sp-row">
        <span className="mn-label">{title}</span>
        {failed && (
          <span className="sp-tag" data-tone="bad">
            {result.code === null ? 'failed' : ended(result)}
          </span>
        )}
      </div>
      <Out tone={failed ? 'bad' : undefined}>{printed(result) || '(no output)'}</Out>
    </div>
  )
}

function TileBody({ value, label, detail }: { value: ReactNode; label: string; detail?: string }) {
  return (
    <>
      <span className="memory-tile-value mn-num">{value}</span>
      <span className="mn-label">{label}</span>
      {detail && <span className="memory-tile-detail">{detail}</span>}
    </>
  )
}

const TILE_TONE: Record<Tile['tone'], string | undefined> = { ok: undefined, bad: 'bad', muted: 'muted' }

/** `mnemo status` in numbers, what wants review, what waits in the inbox, and the raw `status`
 *  and `doctor` behind a button. */
function Strip({ cwd, review }: { cwd: string; review: number }) {
  const health = useVault((s) => s.health)
  const loading = useVault((s) => s.healthLoading)
  const doctor = useVault((s) => s.doctor)
  const doctorSince = useVault((s) => s.doctorSince)
  const problems = useVault((s) => s.chips.problems)
  const [raw, setRaw] = useState(false)
  const [dismissed, setDismissed] = useState<typeof health>(null)
  // `doctor` is slow (half a minute on a large vault): read only while its panel is open.
  useEffect(() => {
    if (raw && health && !doctor) void vault.getState().loadDoctor()
  }, [raw, health, doctor])
  return (
    <>
      <div className="memory-strip">
        {health?.tiles.map((t) => (
          <div key={t.key} className="memory-tile" data-tile={t.key} data-tone={TILE_TONE[t.tone]}>
            <TileBody value={t.value} label={t.label} detail={t.detail} />
          </div>
        ))}
        {health && (
          <button type="button" className="memory-tile" data-tile="review" data-tone={review ? 'need' : undefined} aria-pressed={problems} onClick={() => vault.getState().setChips({ problems: !problems })}>
            <TileBody value={review} label="want review" detail={problems ? 'showing only these' : 'show only these'} />
          </button>
        )}
        {health && (
          <button type="button" className="memory-tile" data-tile="inbox" data-tone={health.inbox ? 'need' : undefined} onClick={() => showTab('inbox')}>
            <TileBody value={health.inbox} label="in the inbox" detail="read, keep or drop" />
          </button>
        )}
        {!health && <Loading>running mnemo status and stale…</Loading>}
        <span className="sp-end memory-strip-acts">
          <Btn small aria-pressed={raw} disabled={!health} onClick={() => setRaw(!raw)}>
            {raw ? 'Hide status' : 'Status · doctor'}
          </Btn>
          <Btn small disabled={loading} onClick={() => void vault.getState().loadHealth(cwd)}>
            {loading ? 'Reading…' : 'Read again'}
          </Btn>
        </span>
      </div>
      {health?.error && dismissed !== health && <Notice tone="bad" text={health.error} onDismiss={() => setDismissed(health)} />}
      {raw && health && (
        <div className="memory-raw">
          <Raw title="mnemo status" result={health.status} />
          {doctor ? (
            <Raw title="mnemo doctor" result={doctor} />
          ) : (
            <Loading>
              running mnemo doctor… {doctorSince !== null && <Elapsed since={doctorSince} />}
            </Loading>
          )}
        </div>
      )}
    </>
  )
}

function ProjectRail({ projects, total, picked }: { projects: Project[]; total: number; picked: string | null }) {
  const top = Math.max(1, ...projects.map((p) => p.heat))
  return (
    <nav className="memory-rail" aria-label="Projects">
      <button type="button" className="memory-project" aria-current={picked === null || undefined} onClick={() => chooseProject(null)}>
        <span className="sp-name sp-grow">Every project</span>
        <span className="mn-num">{total}</span>
      </button>
      {projects.map((p) => (
        <button key={p.name} type="button" className="memory-project" data-project={p.name} data-here={p.current || undefined} aria-current={picked === p.name || undefined} onClick={() => chooseProject(picked === p.name ? null : p.name)}>
          <span className="sp-grow">
            <span className="sp-name sp-clip">{p.name}</span>
            <span className="memory-project-sub">
              {p.current && <span className="memory-here">this repo</span>}
              {p.problems > 0 && <span className="memory-problems">{p.problems} flagged</span>}
            </span>
          </span>
          <span className="mn-num">{p.rules}</span>
          <i className="memory-project-heat" aria-hidden="true" style={{ transform: `scaleX(${p.heat / top})` }} />
        </button>
      ))}
    </nav>
  )
}

function Chip({ on, label, count, onClick }: { on: boolean; label: string; count?: number; onClick(): void }) {
  return (
    <button type="button" className="memory-chip" aria-pressed={on} onClick={onClick}>
      {label}
      {count !== undefined && <span className="mn-num">{count}</span>}
    </button>
  )
}

function Row({ row, selected, narrow, all }: { row: RuleRow; selected: boolean; narrow: boolean; all: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  return (
    <button ref={ref} type="button" className="memory-rule" data-rule={row.slug} data-narrow={narrow || undefined} aria-current={selected || undefined} onClick={() => void vault.getState().select(row.path)}>
      <span className="memory-heat">
        <span className="mn-num">{row.heat >= 0.05 ? row.heat.toFixed(1) : '0'}</span>
        <i aria-hidden="true" style={{ transform: `scaleX(${Math.min(1, row.heat / 5)})` }} />
      </span>
      <span className="memory-rule-name">
        <span className="sp-name">{row.name}</span>
        {row.description && <span className="sp-dim memory-sub">{row.description}</span>}
      </span>
      {!narrow && (
        <span className="memory-rule-type">
          {row.type}
          {all && <span className="sp-dim memory-sub">{row.agent}</span>}
        </span>
      )}
      <span className="memory-rule-conf">
        <ToneMark tone={confidenceTone(row.confidence)} /> {row.confidence ?? 'none'}
      </span>
      {!narrow && (
        <span className="sp-dim mn-num memory-rule-since">
          {row.fires ? `${row.fires}× · ${sinceText(row.last_fired)}` : 'never'}
        </span>
      )}
      <span className="memory-badges">
        {row.badges.map((b) => (
          <span key={b} className="sp-tag" data-tone="need" data-badge={b}>
            {BADGE_LABEL[b]}
          </span>
        ))}
      </span>
    </button>
  )
}

/** `mnemo stale` runs in `cwd`; `current` is the agent of the repo the panel is on. */
export function Rules({ cwd, current }: { cwd: string; current: string | undefined }) {
  const rules = useVault((s) => s.rules)
  const loaded = useVault((s) => s.rulesLoaded)
  const loading = useVault((s) => s.rulesLoading)
  const filter = useVault((s) => s.filter)
  const chips = useVault((s) => s.chips)
  const selected = useVault((s) => s.selected)
  const health = useVault((s) => s.health)
  const stale = useVault((s) => s.stale)
  const project = useStore(memoryPanel, (s) => s.project)
  const [limit, setLimit] = useState(PAGE_ROWS)

  // Every project's rules in one read: the rail counts them, and narrows them here. A scope the
  // ship's window left set is cleared, or the rail would count one project only.
  useEffect(() => {
    const s = vault.getState()
    if (s.scope) void s.setScope('')
    else if (!s.rulesLoaded) void s.loadRules()
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

  const stales = useMemo(() => staleRows(stale), [stale])
  const badged = useMemo(() => withStale(rules, stales), [rules, stales])
  const projects = useMemo(() => projectsOf(badged, current), [badged, current])
  const mine = useMemo(() => inProject(badged, project), [badged, project])
  const shown = useMemo(() => applyChips(mine, chips), [mine, chips])
  const { types, topics } = useMemo(() => facets(mine), [mine])
  useEffect(() => setLimit(PAGE_ROWS), [shown])
  const narrowed = project !== null && mine !== badged

  const move = (by: number) => {
    const next = step(shown, selected, by)
    if (next) void vault.getState().select(next.path)
  }
  const setChip = (key: 'type' | 'topic', value: string) => vault.getState().setChips({ [key]: chips[key] === value ? null : value })
  // ↑↓ walk the rules from anywhere in the tab, the filter included (it has one line); never
  // from another field or a terminal.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    const inFilter = e.target instanceof HTMLInputElement && e.target.dataset.filter !== undefined
    if (!inFilter && typedElsewhere(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    move(e.key === 'ArrowDown' ? 1 : -1)
  }

  return (
    <div className="memory-rules" onKeyDown={onKeyDown}>
      <Strip cwd={cwd} review={reviewCount(health, stales)} />
      <div className="sp-row memory-bar">
        <Field className="sp-grow" type="text" data-filter="" aria-label="Filter rules" value={filter} placeholder="Filter by name, description, topic or body" onChange={(e) => vault.getState().setFilter(e.target.value)} />
        <span className="sp-dim mn-num memory-count">{loading && !loaded ? 'reading…' : shown.length === mine.length ? `${shown.length} rules` : `${shown.length} of ${mine.length} rules`}</span>
        <Btn small disabled={loading} onClick={() => void vault.getState().loadRules()}>
          Read again
        </Btn>
      </div>
      {(types.length > 0 || topics.length > 0 || chips.topic) && (
        <div className="memory-chips">
          {types.map((t) => (
            <Chip key={`type:${t.name}`} on={chips.type === t.name} label={t.name} count={t.count} onClick={() => setChip('type', t.name)} />
          ))}
          {chips.topic && !topics.some((t) => t.name === chips.topic) && <Chip on label={`#${chips.topic}`} onClick={() => setChip('topic', chips.topic!)} />}
          {topics.map((t) => (
            <Chip key={`topic:${t.name}`} on={chips.topic === t.name} label={`#${t.name}`} count={t.count} onClick={() => setChip('topic', t.name)} />
          ))}
        </div>
      )}
      <div className="memory-split" data-selected={selected ? '' : undefined}>
        <ProjectRail projects={projects} total={badged.length} picked={narrowed ? project : null} />
        <div className="memory-list" role="group" aria-label="Rules">
          {loaded && shown.length === 0 && <Quiet>{rules.length === 0 && !filter ? 'No rules: `mnemo status` names no vault, or it holds no pages.' : 'No rule matches.'}</Quiet>}
          {shown.slice(0, limit).map((r) => (
            <Row key={r.path} row={r} selected={r.path === selected} narrow={!!selected} all={!narrowed} />
          ))}
          {shown.length > limit && (
            <Btn className="memory-more" onClick={() => setLimit(limit + PAGE_ROWS)}>
              Show {Math.min(PAGE_ROWS, shown.length - limit)} more of {shown.length - limit}
            </Btn>
          )}
        </div>
        {selected && <Selected cwd={cwd} path={selected} />}
      </div>
    </div>
  )
}

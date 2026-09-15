import { useEffect, useMemo, useRef, useState } from 'react'
import { useMission } from '../mission/app-store'
import { store as appStore, useApp } from '../layout/app-store'
import { childWord, delta, needKind, pruneSnapshot, type Mission } from '../mission/types'
import { focusedCwd, focusedFirst, repoOfCwd } from '../mission/scope'
import { paneForSession } from '../layout/tabs'
import { fmtTokens } from '../mission/tokens'
import { attachChild, openContract, openMissionPane, openPr, ReplyBox } from '../mission/rows'
import { githubStore, useGithub } from '../github/app-store'
import { tauriChrome } from '../chrome/client'
import { listKey } from '../actions/keys'
import { pruneGone } from './needs'
import { buildInbox, rowChild, type Inbox, type Row } from './inbox'
import type { RepoGroup } from '../mission/types'
import { landMission, mergePr, openJob, stopChild, useArm } from './actions'
import { answerPane, answerPrompt, detachAnswer, useAnswer, type Choice } from './approve'
import MissionMap from './MissionMap'
import { lastCwd } from './where'
import './cockpit.css'

/** Branch checked out in `cwd`, re-asked every few seconds while the cockpit is open. */
function useBranch(cwd: string | undefined): string | null {
  const [git, setGit] = useState<{ cwd?: string; branch: string | null }>({ branch: null })
  useEffect(() => {
    if (!cwd) return
    let live = true
    const ask = () =>
      void tauriChrome
        .branch(cwd)
        .catch(() => null)
        .then((b) => live && setGit({ cwd, branch: typeof b === 'string' && b ? b : null }))
    ask()
    const t = setInterval(ask, 5000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [cwd])
  return git.cwd === cwd ? git.branch : null
}

/** Enter on a row: the one thing that row is there for. Merge, land and stop ask twice. */
const PRIMARY: Record<Row['kind'], string> = { blocked: 'open', ci: 'abrir job', ready: 'merge', land: 'land', working: 'open', done: 'open' }
const armKey = (r: Row) => `${r.kind === 'ready' ? 'merge' : r.kind === 'land' ? 'land' : 'stop'}:${r.key}`

/** A blocked row whose child is parked on a permission prompt: Aprovar / Negar, not a reply. */
const isPermission = (r: Row | undefined) => r?.kind === 'blocked' && needKind(r.child) === 'permission'

/** `y` / `n` (⇧Y: and do not ask again) on the selected row. Never with ⌘/⌃/⌥ or while typing. */
export function answerKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>): Choice | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null
  const tag = t?.tagName?.toUpperCase() ?? ''
  if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || t?.isContentEditable) return null
  const k = e.key.toLowerCase()
  return k === 'y' ? (e.shiftKey ? 'always' : 'yes') : k === 'n' && !e.shiftKey ? 'no' : null
}

/** The pane of this window the row's child runs in, if it is open here. */
function rowPane(r: Row): number | null {
  const c = rowChild(r)
  return c ? paneForSession(appStore.getState(), c) : null
}

/** Each list grouped by repo in `repos` order (the focused repo first), urgency kept inside a repo. */
function byRepo(inbox: Inbox, repos: RepoGroup[]): Inbox {
  const at = new Map(repos.map((r, i) => [r.root, i]))
  const sort = <T extends Row>(list: T[]) => list.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => (at.get(a.repo.root) ?? 0) - (at.get(b.repo.root) ?? 0) || i - j).map(([r]) => r)
  return { needs: sort(inbox.needs), working: sort(inbox.working), done: sort(inbox.done) }
}

function runPrimary(r: Row, fire: (key: string) => boolean) {
  const here = rowPane(r)
  if (here !== null && (r.kind === 'blocked' || r.kind === 'working' || r.kind === 'done')) appStore.getState().goToPane(here)
  else if (r.kind === 'ci') openJob(r.pr)
  else if (r.kind === 'ready') fire(armKey(r)) && mergePr(r.repo.root, r.pr)
  else if (r.kind === 'land') fire(armKey(r)) && landMission(r.repo.root, r.mission)
  else openMissionPane(r.child)
}

/** A click on the row itself opens what it is about, never anything that cannot be undone. */
function openRow(r: Row) {
  const here = rowPane(r)
  if (here !== null) appStore.getState().goToPane(here)
  else if (r.kind === 'ci' || r.kind === 'ready') openPr(r.pr)
  else if (r.kind === 'land') openContract(r.mission)
  else openMissionPane(r.child)
}

function InboxRow({ row, selected, showRepo, narrow, armed, fire, onSelect, onMap }: {
  row: Row
  selected: boolean
  showRepo: boolean
  /** The map is open beside the list: the row is its title, the map button just `⤢`. */
  narrow: boolean
  armed: string | null
  fire: (key: string) => boolean
  onSelect: () => void
  onMap: (m: Mission) => void
}) {
  const looked = useMission((s) => s.looked)
  const lastSent = useMission((s) => (row.kind === 'blocked' ? s.sent[row.child.id]?.at(-1)?.at : undefined))
  const replied = row.kind === 'blocked' && Date.now() - (lastSent ?? 0) < 60_000
  const child = rowChild(row)
  // Open in this window: the row is a link to its tab.
  const here = useApp((s) => (child ? paneForSession(s, child) : null))
  const d = child ? delta(child, looked) : 0
  const isArmed = armed === armKey(row)
  // The attach an Aprovar / Negar opened, while its pane is still open here.
  const answer = useAnswer(child?.id ?? '')
  const answered = useApp(() => (child && answer ? answerPane(child.id) : null))

  const [word, label, detail] =
    row.kind === 'blocked' ? [replied ? 'replied' : 'BLOCKED', row.label, '']
    : row.kind === 'ci' ? ['CI ✗', `${row.piece} · PR #${row.pr.number}`, row.pr.head]
    : row.kind === 'ready' ? ['ready', `${row.piece} · PR #${row.pr.number}`, 'CI ✓ · open']
    : row.kind === 'land' ? ['land', row.mission.feature, `${row.mission.pieces.length} PRs green`]
    : [childWord(row.child), row.label, row.child.detail]

  const btn = (text: string, run: () => void, cls = '', title?: string) => (
    <button
      className={`ck-act${cls ? ` ${cls}` : ''}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
        run()
      }}
    >
      {text}
    </button>
  )

  return (
    <div className={`ck-row ck-${row.kind}${replied ? ' ck-replied' : ''}${selected ? ' sel' : ''}${here !== null ? ' ck-here' : ''}`} data-key={row.key}>
      <div
        className="ck-row-head"
        onClick={() => {
          onSelect()
          openRow(row)
        }}
        title={here !== null ? `Go to its tab · ${child?.cwd}` : (child?.cwd ?? row.repo.root)}
      >
        <span className="nd-word">{word}</span>
        <span className="ck-label">{label}</span>
        {here !== null && <span className="ck-tab-link">↗ tab</span>}
        {detail && <span className="ck-detail">{detail}</span>}
        <span className="ck-spacer" />
        {showRepo && <span className="nd-repo">{row.repo.name}</span>}
        {d > 0 && <span className="m-delta">+{d}</span>}
        {child && child.tokens > 0 && <span className="ck-tokens">{fmtTokens(child.tokens)}</span>}
        {row.mission && btn(narrow ? '⤢' : `⤢ ${row.mission.feature}`, () => onMap(row.mission!), 'ck-mission', `Open the mission map of ${row.mission.feature}`)}
        {row.kind === 'ci' && btn('abrir job', () => openJob(row.pr), 'ck-primary', 'The PR checks page')}
        {row.kind === 'ready' && btn(isArmed ? 'confirm merge?' : 'merge', () => runPrimary(row, fire), `ck-primary${isArmed ? ' ck-armed' : ''}`, `gh pr merge ${row.pr.number} --squash`)}
        {row.kind === 'land' && btn(isArmed ? 'confirm land?' : 'land', () => runPrimary(row, fire), `ck-primary${isArmed ? ' ck-armed' : ''}`, `mnemo land ${row.mission.contract_path} --merge`)}
        {row.kind === 'land' && btn('contract', () => openContract(row.mission))}
        {child && answered !== null && btn('detach', () => detachAnswer(child.id), '', 'Leave the attach this answer opened (the child keeps running)')}
        {child && answered === null && (row.kind === 'blocked' || child.live) && btn('attach', () => attachChild(child.id), '', `claude attach ${child.id}`)}
        {row.kind === 'blocked' &&
          btn(isArmed ? 'really stop?' : 'stop', () => fire(armKey(row)) && stopChild(row.child.id), isArmed ? 'ck-armed' : '', `claude stop ${row.child.id}`)}
      </div>
      {row.kind === 'blocked' && <ReplyBox c={row.child} />}
    </div>
  )
}

/** What needs you in every repo, grouped by repo with the focused one first: blocked children
 *  with their reply, red CI, PRs ready to merge, contracts ready to land; then who is still
 *  working and who finished today, collapsed. A row whose session runs in a tab of this window
 *  jumps to that tab. A row's mission opens as a map beside the list. Reads the snapshot the
 *  sidebar polls; it never polls it itself. */
export default function Cockpit() {
  const raw = useMission((s) => s.snapshot)
  const err = useMission((s) => s.lastError)
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const logged = useGithub((s) => s.auth?.logged)
  // A tab with nothing that has a cwd (the cockpit alone, a browser) is still about the last repo you were in.
  const cwd = focusedCwd({ tabs, activeTab, panes }, raw) ?? lastCwd()
  // Resolve against the unpruned snapshot: a finished child's worktree still names its repo.
  const focused = repoOfCwd(raw, cwd)
  const branch = useBranch(cwd)

  const { snap, repos, inbox } = useMemo(() => {
    const snap = pruneGone(pruneSnapshot(raw))
    const repos = focusedFirst(snap, focused?.root)
    return { snap, repos, inbox: byRepo(buildInbox({ ...snap, repos }), repos) }
  }, [raw, focused?.root])

  const [open, setOpen] = useState<{ working?: boolean; done?: boolean }>({})
  // Nothing pending: who is working is the whole story, so it starts open.
  const workingOpen = open.working ?? inbox.needs.length === 0
  const doneOpen = open.done ?? false
  const rows: Row[] = [...inbox.needs, ...(workingOpen ? inbox.working : []), ...(doneOpen ? inbox.done : [])]

  const [selKey, setSelKey] = useState<string | null>(null)
  const sel = Math.max(0, rows.findIndex((r) => r.key === selKey))
  const { armed, fire } = useArm()
  const body = useRef<HTMLDivElement>(null)

  const [mapAt, setMapAt] = useState<{ root: string; path: string } | null>(null)
  const mapRepo = mapAt && snap.repos.find((r) => r.root === mapAt.root)
  const mapMission = mapRepo?.missions.find((m) => m.contract_path === mapAt?.path)

  useEffect(() => {
    void githubStore.getState().loadAuth()
  }, [])
  // Issues feed the map's issue cards; only the mapped repo's, re-read every minute.
  const mapRoot = mapAt?.root
  useEffect(() => {
    if (!logged || !mapRoot) return
    const load = () => void githubStore.getState().loadIssues(mapRoot)
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [logged, mapRoot])

  const at = raw.at && Number.isFinite(Date.parse(raw.at)) ? new Date(raw.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
  const showRepo = repos.length > 1

  const rowEl = (key: string) => [...(body.current?.querySelectorAll<HTMLElement>('.ck-row') ?? [])].find((el) => el.dataset.key === key)
  const select = (i: number) => {
    const r = rows[Math.min(rows.length - 1, Math.max(0, i))]
    if (!r) return
    setSelKey(r.key)
    rowEl(r.key)?.scrollIntoView?.({ block: 'nearest' })
  }

  /** Runs a list key; false when it does nothing here, so the key goes on. */
  const onListKey = (k: NonNullable<ReturnType<typeof listKey>>): boolean => {
    const r = rows[sel]
    switch (k) {
      case 'up':
        select(sel - 1)
        return true
      case 'down':
        select(sel + 1)
        return true
      case 'close':
        if (!mapAt) return false
        setMapAt(null)
        return true
      case 'open':
        if (!r) return false
        runPrimary(r, fire)
        return true
      case 'reply': {
        const box = r?.kind === 'blocked' ? rowEl(r.key)?.querySelector('textarea') : null
        box?.focus()
        return !!box
      }
      case 'attach': {
        const c = r && rowChild(r)
        if (c) attachChild(c.id)
        return !!c
      }
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const choice = answerKey(e.nativeEvent)
    const r = rows[sel]
    if (choice && r?.kind === 'blocked' && isPermission(r)) {
      e.preventDefault()
      e.stopPropagation()
      void answerPrompt(r.child, choice)
      return
    }
    const k = listKey(e.nativeEvent)
    if (!k || !onListKey(k)) return
    e.preventDefault()
    e.stopPropagation()
  }

  const renderRows = (list: Row[]) =>
    list.map((r) => (
      <InboxRow
        key={r.key}
        row={r}
        selected={rows[sel]?.key === r.key}
        showRepo={showRepo}
        narrow={!!mapAt}
        armed={armed}
        fire={fire}
        onSelect={() => setSelKey(r.key)}
        onMap={(m) => setMapAt({ root: r.repo.root, path: m.contract_path })}
      />
    ))

  const count = `${repos.length} ${repos.length === 1 ? 'repo' : 'repos'}`
  const where = focused ? [focused.name, branch, repos.length > 1 ? count : ''].filter(Boolean).join(' · ') : count

  return (
    <div className="pane-body cockpit" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="ck-head">
        <span className="ck-title">cockpit</span>
        <span className="ck-where" title={focused?.root}>
          {where}
        </span>
        {at && <span>updated {at}</span>}
      </div>
      {(err || snap.errors.length > 0) && (
        <div className="ck-errors">
          {err && <div className="m-error">{err}</div>}
          {snap.errors.map((e, i) => (
            <div key={i} className="m-error">
              {e}
            </div>
          ))}
        </div>
      )}
      <div className={`ck-body${mapAt ? ' ck-mapped' : ''}`}>
        <div className="ck-inbox" ref={body}>
          {inbox.needs.length > 0 ? (
            <div className="ck-needs">{renderRows(inbox.needs)}</div>
          ) : (
            !err && <div className="ck-empty">nada pendente</div>
          )}
          {inbox.working.length > 0 && (
            <div className="ck-section">
              <button className="ck-fold" aria-expanded={workingOpen} onClick={() => setOpen((o) => ({ ...o, working: !workingOpen }))}>
                {workingOpen ? '▾' : '▸'} andando: {inbox.working.length}
              </button>
              {workingOpen && renderRows(inbox.working)}
            </div>
          )}
          {inbox.done.length > 0 && (
            <div className="ck-section">
              <button className="ck-fold" aria-expanded={doneOpen} onClick={() => setOpen((o) => ({ ...o, done: !doneOpen }))}>
                {doneOpen ? '▾' : '▸'} feito hoje: {inbox.done.length}
              </button>
              {doneOpen && renderRows(inbox.done)}
            </div>
          )}
        </div>
        {mapAt && (
          <div className="ck-map">
            {mapRepo && mapMission ? (
              <MissionMap repo={mapRepo} mission={mapMission} onClose={() => setMapAt(null)} />
            ) : (
              <div className="ck-empty">
                this mission has no recent sessions or PRs{' '}
                <button className="ck-close" onClick={() => setMapAt(null)}>
                  ×
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="ck-hint">↑↓ move · ↩ {rows[sel] ? PRIMARY[rows[sel].kind] : 'action'} · {isPermission(rows[sel]) ? 'y aprovar · n negar' : 'r reply'} · a attach · ⤢ mission map{mapAt ? ' · esc close map' : ''}</div>
    </div>
  )
}

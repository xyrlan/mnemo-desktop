import { useMission } from '../mission/app-store'
import { store as appStore, useApp } from '../layout/app-store'
import { delta, needKind, type Mission } from '../mission/types'
import { paneForSession } from '../layout/tabs'
import { fmtTokens } from '../mission/tokens'
import { attachChild, openContract, openMissionPane, openPr, ReplyBox } from '../mission/rows'
import { rowChild, type Row } from './inbox'
import { landArgv, landMission, mergeArgv, mergePr, openJob, stopChild } from './actions'
import { cockpitStore, useCockpit } from './app-store'
import { jobState, type Job } from './store'
import { answerPane, detachAnswer, useAnswer } from './approve'
import ChildMark, { MARK_SIZE } from './ChildMark'

/** What the child runs on. Both fields are genuinely absent on a child dispatched without them: say so. */
export const costLine = (c: { model?: string | null; effort?: string | null }) => `${c.model || 'default model'} · ${c.effort || 'default'} effort`
import './cockpit.css'

/** One cockpit row, as the pane and the sidebar's cockpit body both render it. */

/** The pill of a row whose merge or land ran headless: how it is going, in place of `ready`. */
export function jobWord(kind: 'ready' | 'land', j: Job): string {
  const s = jobState(j)
  return s === 'running' ? (kind === 'ready' ? 'merging…' : 'landing…') : s === 'ok' ? (kind === 'ready' ? 'merged ✓' : 'landed ✓') : 'failed ✗'
}

/** Enter on a row: the one thing that row is there for. Merge, land and stop ask twice. */
export const PRIMARY: Record<Row['kind'], string> = { blocked: 'open', ci: 'open job', ready: 'merge', land: 'land', working: 'open', done: 'open' }
const armKey = (r: Row) => `${r.kind === 'ready' ? 'merge' : r.kind === 'land' ? 'land' : 'stop'}:${r.key}`

/** A blocked row whose child is parked on a permission prompt: Approve / Deny, not a reply. */
export const isPermission = (r: Row | undefined) => r?.kind === 'blocked' && needKind(r.child) === 'permission'

/** The pane of this window the row's child runs in, if it is open here. */
function rowPane(r: Row): number | null {
  const c = rowChild(r)
  return c ? paneForSession(appStore.getState(), c) : null
}

/** The row's merge or land is running or went through: Enter shows its log, never a second run. */
const ranOk = (r: Row) => {
  const j = cockpitStore.getState().jobs[r.key]
  return !!j && jobState(j) !== 'failed'
}

export function runPrimary(r: Row, fire: (key: string) => boolean) {
  const here = rowPane(r)
  if (here !== null && (r.kind === 'blocked' || r.kind === 'working' || r.kind === 'done')) appStore.getState().goToPane(here)
  else if (r.kind === 'ci') openJob(r.pr)
  else if ((r.kind === 'ready' || r.kind === 'land') && ranOk(r)) cockpitStore.getState().openDrawer(r.key)
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

export default function InboxRow({ row, selected, showRepo, narrow, armed, fire, onSelect, onMap, onChat, chatting = false }: {
  row: Row
  selected: boolean
  showRepo: boolean
  /** The map is open beside the list: the row is its title, the map button just `⤢`. */
  narrow: boolean
  armed: string | null
  fire: (key: string) => boolean
  onSelect: () => void
  /** Opens the row's mission map beside the list. Without it (the sidebar) there is no map button. */
  onMap?: (m: Mission) => void
  /** Opens (or closes) the chat drawer of the row's child, on a surface that has a board for it
   *  to slide in beside. Without it (the sidebar) there is no chat button. */
  onChat?: () => void
  /** This row's child is the one the drawer is talking to. */
  chatting?: boolean
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
  // The merge or land this row ran, if it has; the job, one reference (never a derived list).
  const job = useCockpit((s) => (row.kind === 'ready' || row.kind === 'land' ? s.jobs[row.key] : undefined))
  const logOpen = useCockpit((s) => s.drawer === row.key)
  // While it runs there is nothing to confirm; once it merged there is nothing left to merge.
  const canRun = !job || jobState(job) === 'failed'

  // `word` is the pill for rows that are not a child's state; `null` means the child's avatar.
  const [word, label, detail] =
    row.kind === 'blocked' ? [replied ? 'replied' : null, row.label, '']
    : row.kind === 'ci' ? ['CI ✗', `${row.piece} · PR #${row.pr.number}`, row.pr.head]
    : row.kind === 'ready' ? [job ? jobWord('ready', job) : 'ready', `${row.piece} · PR #${row.pr.number}`, 'CI ✓ · open']
    : row.kind === 'land' ? [job ? jobWord('land', job) : 'land', row.mission.feature, `${row.mission.pieces.length} PRs green`]
    : [null, row.label, row.child.detail]

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
    <div className={`ck-row ck-${row.kind}${replied ? ' ck-replied' : ''}${selected ? ' sel' : ''}${here !== null ? ' ck-here' : ''}${job ? ` ck-job-${jobState(job)}` : ''}`} data-key={row.key}>
      <div
        className="ck-row-head"
        onClick={() => {
          onSelect()
          openRow(row)
        }}
        title={here !== null ? `Go to its tab · ${child?.cwd}` : (child?.cwd ?? row.repo.root)}
      >
        {/* One visual marker per fact: a child's state is its animated avatar *instead of* the
            word pill, not beside it — the word survives only as screen-reader text and the hover
            title (ChildMark). `replied` is not the child's state but what you did, so it keeps
            its pill, as do the PR and mission rows, which have no child. */}
        {word === null && child ? <ChildMark child={child} /> : <span className="nd-word">{word}</span>}
        <span className="ck-label">{label}</span>
        {here !== null && <span className="ck-tab-link">↗ tab</span>}
        {detail && <span className="ck-detail">{detail}</span>}
        <span className="ck-spacer" />
        {showRepo && <span className="nd-repo">{row.repo.name}</span>}
        {d > 0 && <span className="m-delta">+{d}</span>}
        {child && child.tokens > 0 && <span className="ck-tokens">{fmtTokens(child.tokens)}</span>}
        {row.mission && onMap && btn(narrow ? '⤢' : `⤢ ${row.mission.feature}`, () => onMap(row.mission!), 'ck-mission', `Open the mission map of ${row.mission.feature}`)}
        {row.kind === 'ci' && btn('open job', () => openJob(row.pr), 'ck-primary', 'The PR checks page')}
        {row.kind === 'ready' && canRun && btn(isArmed ? 'confirm merge?' : 'merge', () => runPrimary(row, fire), `ck-primary${isArmed ? ' ck-armed' : ''}`, mergeArgv(row.pr).join(' '))}
        {row.kind === 'land' && canRun && btn(isArmed ? 'confirm land?' : 'land', () => runPrimary(row, fire), `ck-primary${isArmed ? ' ck-armed' : ''}`, landArgv(row.mission).join(' '))}
        {job && btn('log', () => cockpitStore.getState().toggleDrawer(row.key), logOpen ? 'ck-log-open' : '', logOpen ? 'Close the log' : 'What it printed')}
        {row.kind === 'land' && btn('contract', () => openContract(row.mission))}
        {child && answered !== null && btn('step back', () => detachAnswer(child.id), '', 'Leave the attach this answer opened (the child keeps running)')}
        {child && child.live && onChat && btn('chat', onChat, chatting ? 'ck-chatting' : '', `Send ${child.id} a message without opening its terminal`)}
        {child && answered === null && (row.kind === 'blocked' || child.live) && btn('take over', () => attachChild(child.id), '', `claude attach ${child.id}`)}
        {row.kind === 'blocked' &&
          btn(isArmed ? 'really stop?' : 'stop', () => fire(armKey(row)) && stopChild(row.child.id), isArmed ? 'ck-armed' : '', `claude stop ${row.child.id}`)}
      </div>
      {/* What the child spends, not what it is doing: a reply swaps the avatar for a pill for a
          minute (`replied`), and the model and effort behind it are the same either way. */}
      {child && <div className="ck-cost" style={{ paddingLeft: MARK_SIZE + 6 }}>{costLine(child)}</div>}
      {row.kind === 'blocked' && <ReplyBox c={row.child} />}
    </div>
  )
}

import { useMission } from '../mission/app-store'
import { store as appStore, useApp } from '../layout/app-store'
import { delta, needKind, type Mission } from '../mission/types'
import { paneForSession } from '../layout/tabs'
import { fmtTokens } from '../mission/tokens'
import { attachChild, openContract, openMissionPane, openPr, ReplyBox } from '../mission/rows'
import { rowChild, type Row } from './inbox'
import { landMission, mergePr, openJob, stopChild } from './actions'
import { answerPane, detachAnswer, useAnswer } from './approve'
import ChildMark from './ChildMark'
import './cockpit.css'

/** One cockpit row, as the pane and the sidebar's cockpit body both render it. */

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

export function runPrimary(r: Row, fire: (key: string) => boolean) {
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

export default function InboxRow({ row, selected, showRepo, narrow, armed, fire, onSelect, onMap }: {
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

  // `word` is the pill for rows that are not a child's state; `null` means the child's avatar.
  const [word, label, detail] =
    row.kind === 'blocked' ? [replied ? 'replied' : null, row.label, '']
    : row.kind === 'ci' ? ['CI ✗', `${row.piece} · PR #${row.pr.number}`, row.pr.head]
    : row.kind === 'ready' ? ['ready', `${row.piece} · PR #${row.pr.number}`, 'CI ✓ · open']
    : row.kind === 'land' ? ['land', row.mission.feature, `${row.mission.pieces.length} PRs green`]
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
    <div className={`ck-row ck-${row.kind}${replied ? ' ck-replied' : ''}${selected ? ' sel' : ''}${here !== null ? ' ck-here' : ''}`} data-key={row.key}>
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
        {row.kind === 'ready' && btn(isArmed ? 'confirm merge?' : 'merge', () => runPrimary(row, fire), `ck-primary${isArmed ? ' ck-armed' : ''}`, `gh pr merge ${row.pr.number} --squash`)}
        {row.kind === 'land' && btn(isArmed ? 'confirm land?' : 'land', () => runPrimary(row, fire), `ck-primary${isArmed ? ' ck-armed' : ''}`, `mnemo land ${row.mission.contract_path} --merge`)}
        {row.kind === 'land' && btn('contract', () => openContract(row.mission))}
        {child && answered !== null && btn('step back', () => detachAnswer(child.id), '', 'Leave the attach this answer opened (the child keeps running)')}
        {child && answered === null && (row.kind === 'blocked' || child.live) && btn('take over', () => attachChild(child.id), '', `claude attach ${child.id}`)}
        {row.kind === 'blocked' &&
          btn(isArmed ? 'really stop?' : 'stop', () => fire(armKey(row)) && stopChild(row.child.id), isArmed ? 'ck-armed' : '', `claude stop ${row.child.id}`)}
      </div>
      {row.kind === 'blocked' && <ReplyBox c={row.child} />}
    </div>
  )
}

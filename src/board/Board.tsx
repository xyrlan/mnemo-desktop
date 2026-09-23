import { useEffect, useState } from 'react'
import type { PaneViewProps } from '../panes/registry'
import { store as appStore } from '../layout/app-store'
import { missionStore, useMission } from '../mission/app-store'
import { homeStore, useHome } from '../home/app-store'
import { useSettings } from '../settings/app-store'
import { githubStore, selectionStore, useGithub, useSelection } from '../github/app-store'
import { dispatchContract, dispatchIssue, dispatchIssues, ghLogin, installGh, openIssue, openUrl, refreshScope, resumeChildren } from '../github/actions'
import { filterByLabels, labelsOf, linkIssues, linkWord, NEEDS_SCOPE, SCOPE_FIX, type BoardItem, type Issue, type IssueLink } from '../github/types'
import type { Pr } from '../mission/types'
import LabelPicker from '../github/LabelPicker'
import { JobDrawer } from '../cockpit/JobLog'
import { boardRoot, knownRoots } from './root'
import './board.css'

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const CI: Record<Pr['ci'], string> = { pass: 'CI ✓', fail: 'CI ✗', pending: 'CI …', none: '' }

function Chip({ text }: { text: string | null }) {
  if (!text) return null
  const tone = /BLOCKED|✗/.test(text) ? 'bad' : /active|…/.test(text) ? 'accent' : /✓|done/.test(text) ? 'ok' : 'muted'
  return <span className={`bd-chip bd-${tone}`}>{text}</span>
}

function Dispatch({ root, n }: { root: string; n: number }) {
  return (
    <button
      className="bd-dispatch"
      title={`mnemo dispatch ${n} in a terminal tab`}
      onClick={(e) => {
        e.stopPropagation()
        dispatchIssue(root, n)
      }}
    >
      dispatch
    </button>
  )
}

/** Picks `n` for batch dispatch: click selects just it, shift-click extends the range from the
 *  last pick within `order`, cmd/ctrl-click toggles it without disturbing the rest. */
function SelectBox({ root, order, n }: { root: string; order: number[]; n: number }) {
  const on = useSelection((s) => s.root === root && s.ns.includes(n))
  return (
    <button
      type="button"
      className={`bd-select${on ? ' on' : ''}`}
      aria-pressed={on}
      title="select for batch dispatch (shift: range, ⌘: toggle)"
      onClick={(e) => {
        e.stopPropagation()
        selectionStore.getState().pick(root, order, n, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey })
      }}
    >
      {on ? '☑' : '☐'}
    </button>
  )
}

function Card({ item, root, order, link, pr }: { item: BoardItem; root: string; order: number[]; link?: IssueLink; pr?: Pr }) {
  const issue = item.kind === 'Issue' && item.number !== null
  const chip = issue ? linkWord(link) : pr ? [`PR ${pr.state.toLowerCase()}`, CI[pr.ci]].filter(Boolean).join(' · ') : null
  return (
    <div className={`bd-card${item.url ? '' : ' bd-draft'}`} onClick={() => item.url && openUrl(item.url, item.number ? `#${item.number}` : item.title)} title={item.url ?? 'draft'}>
      <div className="bd-card-title">
        {item.number !== null && <span className="bd-num">{item.kind === 'PullRequest' ? 'PR ' : ''}#{item.number}</span>}
        {item.title}
      </div>
      <div className="bd-card-foot">
        {item.kind === 'DraftIssue' && <span className="bd-chip bd-muted">draft</span>}
        <Chip text={chip} />
        {issue && !link && (
          <>
            <SelectBox root={root} order={order} n={item.number!} />
            <Dispatch root={root} n={item.number!} />
          </>
        )}
      </div>
    </div>
  )
}

function IssueRow({ issue, root, order, link }: { issue: Issue; root: string; order: number[]; link?: IssueLink }) {
  return (
    <div className="bd-row" onClick={() => openIssue(issue)} title={issue.url}>
      <span className="bd-num">#{issue.number}</span>
      <span className="bd-row-title">{issue.title}</span>
      {issue.labels.map((l) => (
        <span key={l} className="bd-label">
          {l}
        </span>
      ))}
      {issue.assignees.length > 0 && <span className="bd-quiet">{issue.assignees.map((a) => `@${a}`).join(' ')}</span>}
      <Chip text={linkWord(link)} />
      {!link && (
        <>
          <SelectBox root={root} order={order} n={issue.number} />
          <Dispatch root={root} n={issue.number} />
        </>
      )}
    </div>
  )
}

/** The values `mnemo dispatch` accepts for each flag; empty means the flag is left off.
 *  Closed sets, not free text: these words are joined into a command typed into a shell. */
const MODELS = ['', 'haiku', 'sonnet', 'opus']
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']
const MAY = ['', 'pr', 'push', 'none']

/** The selected-issues confirm sheet: shows what will be dispatched and offers `--model`,
 *  `--effort` and `--may` before spending anything. */
function DispatchSheet({ root, ns, onClose }: { root: string; ns: number[]; onClose: () => void }) {
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [may, setMay] = useState('')
  const sorted = [...ns].sort((a, b) => a - b)
  const go = () => {
    dispatchIssues(
      root,
      sorted,
      { model: model.trim() || undefined, effort: effort.trim() || undefined, may: may.trim() || undefined },
    )
    selectionStore.getState().clearSelection()
    onClose()
  }
  return (
    <div className="bd-sheet-backdrop" onClick={onClose}>
      <div className="bd-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>
          dispatch {sorted.length} issue{sorted.length === 1 ? '' : 's'}
        </h3>
        <div className="bd-sheet-issues">{sorted.map((n) => `#${n}`).join(', ')}</div>
        <label>
          model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m || 'default'}
              </option>
            ))}
          </select>
        </label>
        <label>
          effort
          <select value={effort} onChange={(e) => setEffort(e.target.value)}>
            {EFFORTS.map((m) => (
              <option key={m} value={m}>
                {m || 'default'}
              </option>
            ))}
          </select>
        </label>
        <label>
          may
          <select value={may} onChange={(e) => setMay(e.target.value)}>
            {MAY.map((m) => (
              <option key={m} value={m}>
                {m || 'default'}
              </option>
            ))}
          </select>
        </label>
        <div className="bd-sheet-actions">
          <button onClick={onClose}>cancel</button>
          <button className="bd-primary" onClick={go}>
            dispatch
          </button>
        </div>
      </div>
    </div>
  )
}

/** The confirm sheet for a contract dispatch: unlike issue numbers, a contract's path is not a
 *  closed set, so it is the one free-text field the board offers — everything else it sends
 *  (`--model`, `--effort`, `--may`) stays a closed select like the issue sheet's. */
function ContractSheet({ root, onClose }: { root: string; onClose: () => void }) {
  const [path, setPath] = useState('')
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState('')
  const [may, setMay] = useState('')
  const go = () => {
    const p = path.trim()
    if (!p) return
    dispatchContract(root, p, { model: model.trim() || undefined, effort: effort.trim() || undefined, may: may.trim() || undefined })
    onClose()
  }
  return (
    <div className="bd-sheet-backdrop" onClick={onClose}>
      <div className="bd-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>dispatch a contract</h3>
        <label>
          contract path
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="docs/contracts/round18.md" />
        </label>
        <label>
          model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => (
              <option key={m} value={m}>
                {m || 'default'}
              </option>
            ))}
          </select>
        </label>
        <label>
          effort
          <select value={effort} onChange={(e) => setEffort(e.target.value)}>
            {EFFORTS.map((m) => (
              <option key={m} value={m}>
                {m || 'default'}
              </option>
            ))}
          </select>
        </label>
        <label>
          may
          <select value={may} onChange={(e) => setMay(e.target.value)}>
            {MAY.map((m) => (
              <option key={m} value={m}>
                {m || 'default'}
              </option>
            ))}
          </select>
        </label>
        <div className="bd-sheet-actions">
          <button onClick={onClose}>cancel</button>
          <button className="bd-primary" onClick={go} disabled={!path.trim()}>
            dispatch
          </button>
        </div>
      </div>
    </div>
  )
}

/** The GitHub Project linked to a repo as a kanban of its Status field; without a Project (or
 *  without the `project` scope) the repo's open issues as a list, with the cockpit's label
 *  filter. Cards carry what the mission snapshot knows: the linked child or PR. */
export default function Board(_: PaneViewProps) {
  const snap = useMission((s) => s.snapshot)
  const homeRepos = useHome((s) => s.snapshot.repos)
  const homeSelected = useHome((s) => s.selected)
  const auth = useGithub((s) => s.auth)
  const slot = useGithub((s) => s.boards)
  const issueSlots = useGithub((s) => s.issues)
  const issueLabels = useSettings((s) => s.issueLabels)
  const resolve = () => boardRoot(appStore.getState(), missionStore.getState().snapshot, { repos: homeStore.getState().snapshot.repos, selected: homeStore.getState().selected })
  const [root, setRoot] = useState<string | undefined>(resolve)

  // Opened before the snapshot arrived: adopt a repo as soon as one is known.
  useEffect(() => {
    if (!root) setRoot(resolve())
  }, [root, snap, homeRepos, homeSelected])
  useEffect(() => {
    void githubStore.getState().loadAuth()
  }, [])
  useEffect(() => {
    if (!root || !auth?.logged) return
    const load = () => {
      void githubStore.getState().loadBoard(root)
      void githubStore.getState().loadIssues(root)
    }
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [root, auth?.logged])

  const repo = snap.repos.find((r) => r.root === root)
  const issues = (root && issueSlots[root]?.list) || []
  const links = repo ? linkIssues(repo, issues) : new Map<number, IssueLink>()
  const prs = new Map<number, Pr>()
  for (const m of repo?.missions ?? []) for (const p of m.pieces) if (p.pr) prs.set(p.pr.number, p.pr)
  const b = root ? slot[root] : undefined
  const labels = (root && issueLabels[root]) || []
  const roots = knownRoots(snap, { repos: homeRepos, selected: homeSelected }, root)
  const shown = filterByLabels(issues, labels)

  // The dispatchable issue numbers in the order they're shown, for shift-click's range and for
  // the picker itself: only an issue with no child, piece or PR linked can be batch-dispatched.
  const order = b?.board
    ? b.board.columns.flatMap((c) => c.items.filter((it) => it.kind === 'Issue' && it.number !== null && !links.get(it.number!)).map((it) => it.number!))
    : shown.filter((i) => !links.get(i.number)).map((i) => i.number)
  const selRoot = useSelection((s) => s.root)
  const selNs = useSelection((s) => s.ns)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [contractOpen, setContractOpen] = useState(false)
  const selected = root && selRoot === root ? selNs : []

  useEffect(() => {
    setSheetOpen(false)
    setContractOpen(false)
  }, [root])

  let body
  if (!root) body = <div className="bd-empty">open a terminal in a repository, or pick one on Home</div>
  else if (!auth) body = <div className="bd-empty">checking gh…</div>
  else if (!auth.installed)
    body = (
      <div className="bd-empty">
        gh is not installed. <button onClick={installGh}>brew install gh</button>
      </div>
    )
  else if (!auth.logged)
    body = (
      <div className="bd-empty">
        not logged in to GitHub. <button onClick={ghLogin}>Log in to GitHub</button>
      </div>
    )
  else if (!b || (b.loading && !b.board && !b.error)) body = <div className="bd-empty">loading…</div>
  else if (b.board)
    body = (
      <div className="bd-columns">
        {b.board.columns.map((c) => (
          <section key={c.name} className="bd-column">
            <header>
              {c.name} <span className="bd-quiet">{c.items.length}</span>
            </header>
            {c.items.map((it) => (
              <Card
                key={it.id}
                item={it}
                root={root}
                order={order}
                link={it.kind === 'Issue' && it.number !== null ? links.get(it.number) : undefined}
                pr={it.kind === 'PullRequest' && it.number !== null ? prs.get(it.number) : undefined}
              />
            ))}
          </section>
        ))}
      </div>
    )
  else {
    body = (
      <>
        {b.error === NEEDS_SCOPE ? (
          <div className="bd-notice">
            The Project board needs the <code>project</code> scope: run <code>{SCOPE_FIX}</code>
            <button onClick={refreshScope}>run</button>
          </div>
        ) : b.error ? (
          <div className="bd-notice bd-error">{b.error}</div>
        ) : (
          <div className="bd-quiet bd-pad">no GitHub Project linked to this repo · open issues</div>
        )}
        {root && issueSlots[root]?.error && <div className="bd-notice bd-error">{issueSlots[root].error}</div>}
        <div className="bd-list">
          {shown.map((i) => (
            <IssueRow key={i.number} issue={i} root={root} order={order} link={links.get(i.number)} />
          ))}
          {issueSlots[root] && shown.length === 0 && <div className="bd-quiet bd-pad">{labels.length ? 'no open issue with these labels' : 'no open issues'}</div>}
        </div>
      </>
    )
  }

  return (
    <div className="pane-body board">
      <div className="bd-head">
        <span className="bd-title">board</span>
        {roots.length > 1 ? (
          <select value={root} onChange={(e) => setRoot(e.target.value)} title={root}>
            {roots.map((r) => (
              <option key={r} value={r}>
                {base(r)}
              </option>
            ))}
          </select>
        ) : (
          root && <span title={root}>{base(root)}</span>
        )}
        {b?.board && (
          <button className="bd-link" onClick={() => openUrl(b.board!.url, b.board!.title)} title={b.board.url}>
            {b.board.title}
          </button>
        )}
        <span className="bd-spacer" />
        {root && selected.length > 0 && (
          <span className="bd-batch">
            <span className="bd-quiet">{selected.length} selected</span>
            <button onClick={() => setSheetOpen(true)}>dispatch selected</button>
            <button className="bd-link" onClick={() => selectionStore.getState().clearSelection()}>
              clear
            </button>
          </span>
        )}
        {root && (
          <button className="bd-link" onClick={() => setContractOpen(true)} title="mnemo dispatch --contract <path>: dispatch every piece of a decomposition contract">
            dispatch contract
          </button>
        )}
        {root && (
          <button className="bd-link" onClick={() => resumeChildren(root)} title="mnemo resume: wake this repo's children the account's rate limit stopped">
            resume
          </button>
        )}
        {root && b && !b.board && auth?.logged && <LabelPicker root={root} labels={labelsOf(issues)} selected={labels} />}
      </div>
      <div className="bd-body">
        <div className="bd-body-inner">{body}</div>
        <JobDrawer />
      </div>
      {sheetOpen && root && selected.length > 0 && <DispatchSheet root={root} ns={selected} onClose={() => setSheetOpen(false)} />}
      {contractOpen && root && <ContractSheet root={root} onClose={() => setContractOpen(false)} />}
    </div>
  )
}

import { useEffect, useState, type JSX, type MouseEvent, type ReactNode } from 'react'
import { useCockpit } from '../../../cockpit/app-store'
import { contractDispatchKey, dispatchContract, dispatchIssues, dispatchKey } from '../../../github/actions'
import { linkIssues, linkWord, type Issue, type IssueLink } from '../../../github/types'
import { homeStore, useHome } from '../../../home/app-store'
import { otherErrors, relTime, type HomeRepo, type Pr } from '../../../home/types'
import { useMission } from '../../../mission/app-store'
import type { Mission } from '../../../mission/types'
import { samePath } from '../../../path/path'
import { checksOf, dispatchable, EFFORTS, MAY, MODELS, taskRepos, type TaskRepo } from '../../../tasks/model'
import { confirm } from '../../ui/confirm'
import { listContracts, openInBrowser, openRobot } from './live'
import { contractFiles, contractPathError, initialRepo, jobLine, missionOf, pick, robotOf, shortPath, type ContractFile } from './model'
import './missions.css'

/** `--model`, `--effort` and `--may` for a dispatch; empty leaves the flag off. */
type Flags = { model: string; effort: string; may: string }
const NO_FLAGS: Flags = { model: '', effort: '', may: '' }
const optsOf = (f: Flags) => ({ model: f.model || undefined, effort: f.effort || undefined, may: f.may || undefined })

/** What a row does outside the window, the window's own (`MissionsWindow` gives the live ones). */
type Acts = {
  /** Opens a page in the system browser. */
  browse(url: string): void
  /** Opens a robot as a click on it does; says so when the ship does not draw it. */
  robot(id: string, label: string): void
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function FlagSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange(v: string): void }) {
  return (
    <label className="nx-mis-flag">
      <span className="nx-muted">{label}</span>
      <select className="nx-input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o || 'default'}
          </option>
        ))}
      </select>
    </label>
  )
}

function FlagRow({ flags, onChange }: { flags: Flags; onChange(f: Flags): void }) {
  return (
    <span className="nx-mis-flags">
      <FlagSelect label="Model" value={flags.model} options={MODELS} onChange={(model) => onChange({ ...flags, model })} />
      <FlagSelect label="Effort" value={flags.effort} options={EFFORTS} onChange={(effort) => onChange({ ...flags, effort })} />
      <FlagSelect label="May" value={flags.may} options={MAY} onChange={(may) => onChange({ ...flags, may })} />
    </span>
  )
}

/** What already works on an issue in flight, in one word (`linkWord`), and its robot one click away
 *  when it has one. */
function InFlight({ link, acts }: { link: IssueLink; acts: Acts }) {
  const word = linkWord(link) ?? 'in flight'
  const robot = robotOf(link)
  const tone = /BLOCKED|✗/.test(word) ? 'need' : /active/.test(word) ? 'work' : /✓|done/.test(word) ? 'ok' : 'idle'
  return (
    <span className="nx-mis-flight" data-tone={tone}>
      <span className="nx-mis-dot" aria-hidden />
      {word}
      {robot && (
        <button type="button" className="nx-mis-link" title={`open its robot, ${robot.id}, as a click on it does`} onClick={() => acts.robot(robot.id, robot.id)}>
          robot {robot.id} →
        </button>
      )}
    </span>
  )
}

function IssueRow({ issue, link, picked, onPick, onDispatch, acts }: { issue: Issue; link?: IssueLink; picked: boolean; onPick(e: MouseEvent): void; onDispatch(): void; acts: Acts }) {
  return (
    <div className="nx-row nx-mis-row" data-issue={issue.number} data-picked={picked ? '' : undefined}>
      {link ? (
        <span className="nx-mis-box" aria-hidden />
      ) : (
        <button type="button" role="checkbox" aria-checked={picked} aria-label={`pick #${issue.number} to dispatch`} title="pick to dispatch (shift: a range)" className="nx-mis-box" onClick={onPick}>
          {picked ? '■' : ''}
        </button>
      )}
      <button type="button" className="nx-mis-title" title={`open #${issue.number} in the browser`} onClick={() => acts.browse(issue.url)}>
        <span className="nx-mis-num">#{issue.number}</span>
        <span className="nx-mis-text">{issue.title}</span>
      </button>
      {issue.labels.slice(0, 3).map((l) => (
        <span key={l} className="nx-mis-tag">
          {l}
        </span>
      ))}
      {link ? (
        <InFlight link={link} acts={acts} />
      ) : (
        <button type="button" className="nx-btn nx-mis-act" title={`dispatch #${issue.number}: choose its model, effort and may below`} onClick={onDispatch}>
          Dispatch
        </button>
      )}
    </div>
  )
}

function Checks({ pr }: { pr: Pr }) {
  const c = checksOf(pr)
  if (!c) return <span className="nx-mis-checks nx-muted">no checks</span>
  return (
    <span className="nx-mis-checks" data-tone={c.tone} role="img" aria-label={c.label} title={c.label}>
      {c.tone === 'pass' ? '✓' : c.tone === 'fail' ? '✗' : '●'} {c.label}
    </span>
  )
}

function PrRow({ pr, acts }: { pr: Pr; acts: Acts }) {
  return (
    <div className="nx-row nx-mis-row" data-pr={pr.number}>
      <span className="nx-mis-box" aria-hidden />
      <button type="button" className="nx-mis-title" title={`open PR #${pr.number} in the browser`} onClick={() => acts.browse(pr.url)}>
        <span className="nx-mis-num">#{pr.number}</span>
        <span className="nx-mis-text">{pr.title}</span>
      </button>
      {pr.state === 'draft' && <span className="nx-mis-tag">draft</span>}
      <Checks pr={pr} />
      {pr.child && (
        <button type="button" className="nx-mis-link" title={`opened by robot ${pr.child}: open it`} onClick={() => acts.robot(pr.child!, pr.child!)}>
          robot {pr.child} →
        </button>
      )}
      <button type="button" className="nx-btn nx-mis-act" aria-label={`Open PR #${pr.number} in the browser`} title="open in the browser" onClick={() => acts.browse(pr.url)}>
        ↗
      </button>
    </div>
  )
}

/** Dispatching a decomposition contract in the repo: one found in its contract folders, or a path
 *  typed, with the flags; one already dispatched asks first. */
function ContractPanel({ root, missions, flags, onFlags, busy, onGo }: { root: string; missions: Mission[]; flags: Flags; onFlags(f: Flags): void; busy(path: string): boolean; onGo(path: string): void }) {
  const [files, setFiles] = useState<ContractFile[] | null>(null)
  const [path, setPath] = useState('')
  useEffect(() => {
    let live = true
    void listContracts(root).then((found) => {
      if (!live) return
      const fs = contractFiles(root, found, missions)
      setFiles(fs)
      setPath((p) => p || (fs.find((f) => !f.mission)?.path ?? ''))
    })
    return () => {
      live = false
    }
    // The folders are read once as the panel opens; the missions only mark them.
  }, [root])
  const error = contractPathError(path)
  const running = !error && busy(path.trim())
  return (
    <div className="nx-mis-contract" data-contract-panel="">
      <div className="nx-section">Dispatch a contract</div>
      {files === null ? (
        <div className="nx-muted">Looking for contracts…</div>
      ) : files.length === 0 ? (
        <div className="nx-muted">No contract in docs/superpowers/contracts or docs/contracts. Type its path below.</div>
      ) : (
        <div className="nx-mis-files" role="radiogroup" aria-label="contracts in the repo">
          {files.map((f) => (
            <button key={f.path} type="button" role="radio" aria-checked={path.trim() === f.path} className="nx-mis-file" onClick={() => setPath(f.path)}>
              <span className="nx-mis-box" aria-hidden>
                {path.trim() === f.path ? '■' : ''}
              </span>
              <span className="nx-mis-text">{f.path}</span>
              {f.mission && <span className="nx-mis-tag">dispatched · {plural(f.mission.pieces.length, 'piece')}</span>}
            </button>
          ))}
        </div>
      )}
      <label className="nx-mis-path">
        <span className="nx-muted">Path in the repo</span>
        <input className="nx-input" aria-label="contract path in the repo" placeholder="docs/superpowers/contracts/…" value={path} onChange={(e) => setPath(e.target.value)} />
      </label>
      <div className="nx-mis-go">
        <FlagRow flags={flags} onChange={onFlags} />
        <button type="button" className="nx-btn" data-tone="go" disabled={!!error || running} title={error ?? (running ? 'this contract is already being dispatched' : `mnemo dispatch --contract ${path.trim()}`)} onClick={() => onGo(path.trim())}>
          Dispatch contract
        </button>
      </div>
      {path.trim() && error && <div className="nx-mis-why">{error}</div>}
    </div>
  )
}

function RepoSection({ group, links, picked, onPick, onDispatchOne, contractOpen, onContract, children, acts }: {
  group: TaskRepo
  links: Map<number, IssueLink>
  picked: number[]
  onPick(order: number[], n: number, shift: boolean): void
  onDispatchOne(n: number): void
  contractOpen: boolean
  onContract(): void
  children?: ReactNode
  acts: Acts
}) {
  const { repo, issues, prs, error } = group
  const order = dispatchable(issues, links)
  return (
    <section className="nx-mis-repo" data-root={repo.root}>
      <header className="nx-mis-head">
        <span className="nx-mis-name">{repo.name}</span>
        <span className="nx-muted nx-mis-text" title={repo.root}>
          {shortPath(repo.root)}
        </span>
        <span className="nx-muted">
          {plural(issues.length, 'issue')} · {plural(prs.length, 'PR')}
        </span>
        <button type="button" className="nx-btn" aria-expanded={contractOpen} onClick={onContract}>
          Dispatch contract…
        </button>
      </header>
      {children}
      {error && <div className="nx-mis-why">GitHub could not read this repo: {error}</div>}
      {issues.length > 0 && (
        <>
          <div className="nx-mis-sub">Issues</div>
          {issues.map((i) => (
            <IssueRow
              key={i.number}
              issue={i}
              link={links.get(i.number)}
              picked={picked.includes(i.number)}
              onPick={(e) => onPick(order, i.number, e.shiftKey)}
              onDispatch={() => onDispatchOne(i.number)}
              acts={acts}
            />
          ))}
        </>
      )}
      {prs.length > 0 && (
        <>
          <div className="nx-mis-sub">Pull requests</div>
          {prs.map((p) => (
            <PrRow key={p.number} pr={p} acts={acts} />
          ))}
        </>
      )}
    </section>
  )
}

/** The issues picked in one repo, at the window's foot while there are any: the flags, then
 *  Dispatch. */
function BatchBar({ repo, ns, flags, onFlags, running, onGo, onClear }: { repo: HomeRepo; ns: number[]; flags: Flags; onFlags(f: Flags): void; running: boolean; onGo(): void; onClear(): void }) {
  return (
    <div className="nx-mis-batch" role="toolbar" aria-label="dispatch the picked issues">
      <span className="nx-mis-text">
        {ns.map((n) => `#${n}`).join(', ')} <span className="nx-muted">in {repo.name}, one robot each</span>
      </span>
      <FlagRow flags={flags} onChange={onFlags} />
      <button type="button" className="nx-btn" data-tone="go" disabled={running} title={running ? 'the same dispatch is already running' : `mnemo dispatch ${ns.join(' ')}`} onClick={onGo}>
        Dispatch {ns.length}
      </button>
      <button type="button" className="nx-btn" onClick={onClear}>
        Clear
      </button>
    </div>
  )
}

export type MissionsWindowProps = { root?: string; close: () => void }

/** The MISSIONS window (spec `2026-10-15-nexus-app-design.md`, Q5): each repo's open issues and
 *  PRs as Home's last GitHub read has them (the Tasks view's data). Issues are picked and
 *  dispatched with their model, effort and may; one already in flight says so and links to its
 *  robot. A repo's contract is dispatched from its header. A PR shows its checks and opens in the
 *  system browser. `root` opens it on that repo. */
export function MissionsWindow({ root, close }: MissionsWindowProps): JSX.Element {
  const snap = useHome((s) => s.snapshot)
  const github = useHome((s) => s.github)
  const loading = useHome((s) => s.loading)
  const githubAt = useHome((s) => s.githubAt)
  const mission = useMission((s) => s.snapshot)
  const jobs = useCockpit((s) => s.jobs)
  // Until a repo is chosen here, the window follows `root` as Home's repos arrive.
  const [chosen, setChosen] = useState<string | null | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<{ root: string; ns: number[] } | null>(null)
  const [flags, setFlags] = useState<Flags>(NO_FLAGS)
  const [contractFor, setContractFor] = useState<string | null>(null)
  const [launched, setLaunched] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  // Opening reads as the Tasks view does: sessions first, GitHub after.
  useEffect(() => {
    const h = homeStore.getState()
    void h.load().then(() => h.refreshGithub())
  }, [])

  const acts: Acts = {
    browse: (url) => void openInBrowser(url).catch((e: unknown) => setNotice(`The browser did not open: ${String(e)}`)),
    robot: (id, label) => {
      if (!openRobot(id, close)) setNotice(`Robot ${label} is not on the ship now.`)
    },
  }

  const listable = snap.repos.filter((r) => !r.hidden && !r.unresolved)
  const repo = chosen !== undefined ? chosen : initialRepo(listable, root)
  const groups = taskRepos(snap, query).filter((g) => !repo || samePath(g.repo.root, repo))
  const missionsOf = (r: string) => mission.repos.find((g) => samePath(g.root, r))?.missions ?? []
  const linksOf = (r: string) => {
    const g = mission.repos.find((x) => samePath(x.root, r))
    return g ? linkIssues(g, snap.repos.find((x) => x.root === r)?.issues ?? []) : new Map<number, IssueLink>()
  }
  const running = (key: string) => jobs[key]?.running === true
  const launch = (key: string) => setLaunched((ks) => [key, ...ks.filter((k) => k !== key)].slice(0, 4))

  const batch = picked && picked.ns.length > 0 ? groups.find((g) => g.repo.root === picked.root) : undefined
  const sorted = picked ? [...picked.ns].sort((a, b) => a - b) : []
  const goBatch = () => {
    if (!batch) return
    dispatchIssues(batch.repo.root, sorted, optsOf(flags))
    launch(dispatchKey(batch.repo.root, sorted))
    setPicked(null)
  }
  const goContract = async (r: string, path: string) => {
    const m = missionOf(r, path, missionsOf(r))
    if (m && !(await confirm({ title: 'Dispatch again?', body: `${path} was already dispatched as "${m.feature}" (${plural(m.pieces.length, 'piece')}). Dispatching it again starts every piece over, beside the ones there.`, confirm: 'Dispatch again', danger: true }))) return
    dispatchContract(r, path, optsOf(flags))
    launch(contractDispatchKey(r, path))
    setContractFor(null)
  }

  let body: ReactNode
  if (snap.repos.length === 0 && loading) body = <div className="nx-mis-empty">Reading your projects…</div>
  else if (snap.repos.length === 0) body = <div className="nx-mis-empty">No projects yet. Add one from PROJECTS, and its issues and pull requests show here.</div>
  else if (groups.length === 0 && query.trim()) body = <div className="nx-mis-empty">Nothing matches “{query.trim()}”.</div>
  else if (groups.length === 0 && github !== 'ready') body = <div className="nx-mis-empty">Reading issues and pull requests from GitHub…</div>
  else if (groups.length === 0) body = <div className="nx-mis-empty">No open issues or pull requests{repo ? ` in ${listable.find((r) => r.root === repo)?.name ?? shortPath(repo)}` : ''}.</div>
  else
    body = groups.map((g) => (
      <RepoSection
        key={g.repo.root}
        group={g}
        links={linksOf(g.repo.root)}
        picked={picked?.root === g.repo.root ? picked.ns : []}
        // A batch belongs to one repo: a pick in another starts a fresh one.
        onPick={(order, n, shift) => setPicked((p) => ({ root: g.repo.root, ns: pick(p?.root === g.repo.root ? p.ns : [], order, n, shift) }))}
        onDispatchOne={(n) => setPicked({ root: g.repo.root, ns: [n] })}
        contractOpen={contractFor === g.repo.root}
        onContract={() => setContractFor((c) => (c === g.repo.root ? null : g.repo.root))}
        acts={acts}
      >
        {contractFor === g.repo.root && (
          <ContractPanel root={g.repo.root} missions={missionsOf(g.repo.root)} flags={flags} onFlags={setFlags} busy={(path) => running(contractDispatchKey(g.repo.root, path))} onGo={(path) => void goContract(g.repo.root, path)} />
        )}
      </RepoSection>
    ))

  return (
    <div className="nx-mis" data-missions="">
      <div className="nx-mis-bar">
        <select className="nx-input" aria-label="repo" value={repo ?? ''} onChange={(e) => setChosen(e.target.value || null)}>
          <option value="">Every repo</option>
          {listable.map((r) => (
            <option key={r.root} value={r.root}>
              {r.name} ({(r.issues?.length ?? 0) + (r.prs?.length ?? 0)})
            </option>
          ))}
        </select>
        <input className="nx-input nx-mis-filter" aria-label="filter issues and PRs" placeholder="filter: #12, a word, a label" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button
          type="button"
          className="nx-btn"
          disabled={github === 'loading'}
          title={githubAt ? `read ${relTime(githubAt)} ago` : 'not read yet'}
          onClick={() => void homeStore.getState().refreshGithub()}
        >
          {github === 'loading' ? 'Reading…' : 'Read again'}
        </button>
      </div>
      {otherErrors(snap.errors).map((e) => (
        <div key={e} className="nx-mis-why">
          {e}
        </div>
      ))}
      {notice && (
        <div className="nx-mis-notice" role="status">
          {notice}
          <button type="button" className="nx-mis-link" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
      {launched.length > 0 && (
        <div className="nx-mis-jobs" aria-label="dispatches started here">
          {launched.map((k) => {
            const j = jobs[k]
            const l = jobLine(j)
            return (
              <div key={k} className="nx-mis-job" data-tone={l.tone} data-job={k}>
                <span className="nx-mis-dot" aria-hidden />
                <span className="nx-mis-jobname">{j?.title ?? k}</span>
                <span className="nx-mis-text">{l.text}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="nx-mis-list">{body}</div>
      {batch && picked && (
        <BatchBar repo={batch.repo} ns={sorted} flags={flags} onFlags={setFlags} running={running(dispatchKey(batch.repo.root, sorted))} onGo={goBatch} onClear={() => setPicked(null)} />
      )}
    </div>
  )
}

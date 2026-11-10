// The Missions panel: each repo's open issues and pull requests as Home's last GitHub read has
// them, and the missions dispatched from its contracts. The flags the next dispatch carries
// (model, effort, may, advisor) are always on screen, so dispatching is: pick, Enter. What was
// launched from here stays listed while the app runs, each with how it is going. A mission
// whose pieces are all in lands from its row.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useCockpit } from '../../cockpit/app-store'
import { contractDispatchKey, dispatchKey } from '../../github/actions'
import { Kbd, Label, StateMark } from '../../ds'
import { homeStore, useHome } from '../../home/app-store'
import { otherErrors, relTime, type Pr } from '../../home/types'
import { missionStore, useMission } from '../../mission/app-store'
import type { Mission } from '../../mission/types'
import { listContracts } from '../../nexus/windows/missions/live'
import { contractFiles, contractPathError, missionOf, pick, type ContractFile } from '../../nexus/windows/missions/model'
import { samePath } from '../../path/path'
import { pollWhileShown } from '../../shell/while-shown'
import { checksOf, dispatchable, EFFORTS, MAY, MODELS } from '../../tasks/model'
import { actions } from '../../world/actions'
import { openOnStage } from '../../world/route'
import { sessionOf, worldStore } from '../../world/store'
import { cursorOf, moved, plural, shortPath } from '../projects/model'
import { actOf, flagWords, flightStanding, launchTitle, missionStanding, nextOf, pieceStanding, progressOf, rowsOf, sectionsOf, sessionOfLink, type Section, type Standing } from './model'
import { launchStore, optionsOf, type Flags, type Launch } from './store'
import './missions.css'

/** How often the mission snapshot is read again while the panel is open and the window shows. */
export const MISSIONS_MS = 15_000

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/** The values each flag takes, the closed sets `mnemo dispatch` accepts. An advisor is a model. */
const FLAGS: { flag: keyof Flags; name: string; key: string; options: string[]; off: string }[] = [
  { flag: 'model', name: 'Model', key: 'M', options: MODELS, off: 'default' },
  { flag: 'effort', name: 'Effort', key: 'E', options: EFFORTS, off: 'default' },
  { flag: 'may', name: 'May', key: 'Y', options: MAY, off: 'default' },
  { flag: 'advisor', name: 'Advisor', key: 'V', options: MODELS, off: 'none' },
]

/** Puts a session on stage by whatever names it here: its id, or a child's short id, which the
 *  world knows the whole id of. */
const stage = (id: string) => openOnStage(sessionOf(worldStore.getState().world, id)?.id ?? id)

type Picked = { root: string; ns: number[] }
type Landing = { root: string; feature: string }

export function MissionsPanel() {
  const snap = useHome((s) => s.snapshot)
  const github = useHome((s) => s.github)
  const loading = useHome((s) => s.loading)
  const githubAt = useHome((s) => s.githubAt)
  const mission = useMission((s) => s.snapshot)
  const jobs = useCockpit((s) => s.jobs)
  const launches = useStore(launchStore, (s) => s.launches)
  const flags = useStore(launchStore, (s) => s.flags)
  const [only, setOnly] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [landing, setLanding] = useState<Landing | null>(null)
  const [contractFor, setContractFor] = useState<string | null>(null)
  const [at, setAt] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const filterField = useRef<HTMLInputElement>(null)

  // Opening reads as the ship's window did: sessions first, GitHub after. The mission snapshot
  // is read again while the panel is open, so a launch's progress moves.
  useEffect(() => {
    const h = homeStore.getState()
    void h
      .load()
      .then(() => h.refreshGithub())
      .catch(() => {})
    root.current?.focus({ preventScroll: true })
    return pollWhileShown(() => missionStore.getState().refresh(undefined, true), MISSIONS_MS)
  }, [])

  const listable = useMemo(() => snap.repos.filter((r) => !r.hidden && !r.unresolved), [snap.repos])
  const sections = useMemo(() => sectionsOf(snap, mission, query, only), [snap, mission, query, only])
  const rows = useMemo(() => rowsOf(sections), [sections])
  const keys = useMemo(() => rows.map((r) => r.key), [rows])
  const cursor = cursorOf(keys, at)
  const here = rows.find((r) => r.key === cursor)

  useEffect(() => {
    if (cursor === null) return
    const el = [...(root.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].find((x) => x.dataset.row === cursor)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor])

  const nameOf = (r: string) => snap.repos.find((x) => x.root === r)?.name ?? shortPath(r)
  const sectionOf = (r: string) => sections.find((s) => s.repo.root === r)
  const batch = picked && picked.ns.length > 0 && sectionOf(picked.root) ? picked : null
  const sorted = batch ? [...batch.ns].sort((a, b) => a - b) : []
  const running = (key: string) => jobs[key]?.running === true

  const toList = () => root.current?.focus({ preventScroll: true })
  const setFlags = (f: Flags) => launchStore.getState().setFlags(f)

  function external(url: string) {
    void actions()
      .external(url)
      .then((out) => {
        if (!out.ok) setNotice(`The browser did not open: ${out.why}`)
      })
  }

  /** A click or Space on an issue's box. A batch belongs to one repo: a pick in another starts
   *  a fresh one. */
  function pickIssue(s: Section, n: number, range: boolean) {
    setLanding(null)
    setPicked((p) => ({ root: s.repo.root, ns: pick(p?.root === s.repo.root ? p.ns : [], dispatchable(s.issues, s.links), n, range) }))
  }

  function dispatchBatch() {
    if (!batch) return
    const options = optionsOf(flags)
    setPicked(null)
    void launchStore.getState().launch({ kind: 'issues', root: batch.root, repo: nameOf(batch.root), issues: sorted, path: null, feature: null, options }, () => actions().dispatch(batch.root, sorted, options))
  }

  function dispatchContract(r: string, path: string) {
    const options = optionsOf(flags)
    setContractFor(null)
    toList()
    void launchStore.getState().launch({ kind: 'contract', root: r, repo: nameOf(r), issues: [], path, feature: null, options }, () => actions().dispatchContract(r, path, options))
  }

  function land() {
    if (!landing) return
    const { root: r, feature } = landing
    setLanding(null)
    void launchStore.getState().launch({ kind: 'land', root: r, repo: nameOf(r), issues: [], path: null, feature, options: {} }, () => actions().land(r, feature))
  }

  const armLand = (r: string, m: Mission) => {
    setPicked(null)
    setLanding({ root: r, feature: m.feature })
  }

  function onKeyDown(e: KeyboardEvent) {
    if (typing(e.target)) return
    if (e.key === 'Escape') {
      // Esc backs out of what is armed before it closes the panel.
      if (!batch && !landing && !contractFor) return
      e.preventDefault()
      setPicked(null)
      setLanding(null)
      setContractFor(null)
      return
    }
    const act = actOf(e)
    if (!act) return
    e.preventDefault()
    e.stopPropagation()
    switch (act.kind) {
      case 'move':
        return setAt(moved(keys, cursor, act.by))
      case 'filter':
        return filterField.current?.focus()
      case 'read':
        return void homeStore.getState().refreshGithub()
      case 'flag': {
        const f = FLAGS.find((x) => x.flag === act.flag)!
        return setFlags({ ...flags, [act.flag]: nextOf(f.options, flags[act.flag]) })
      }
      case 'confirm':
        return landing ? land() : dispatchBatch()
      case 'contract': {
        const r = here?.root ?? only ?? sections[0]?.repo.root
        if (r) setContractFor((c) => (c === r ? null : r))
        return
      }
      case 'pick':
      case 'only': {
        if (here?.kind !== 'issue' || here.link) return
        const s = sectionOf(here.root)
        if (!s) return
        if (act.kind === 'only') {
          setLanding(null)
          return setPicked({ root: here.root, ns: [here.issue.number] })
        }
        return pickIssue(s, here.issue.number, act.range)
      }
      case 'land': {
        const m = here?.kind === 'mission' ? here.mission : sectionOf(here?.root ?? '')?.missions.find((x) => x.landable)
        if (m?.landable && here) armLand(here.root, m)
        else setNotice('No mission here is ready to land.')
        return
      }
      case 'open': {
        const url = here?.kind === 'issue' ? here.issue.url : here?.kind === 'pr' ? here.pr.url : null
        if (url) external(url)
        return
      }
    }
  }

  let body: ReactNode
  if (snap.repos.length === 0 && loading) body = <p className="mn-missions-empty">Reading your projects…</p>
  else if (snap.repos.length === 0) body = <p className="mn-missions-empty">No projects yet. Add one in Projects, and its issues and pull requests show here.</p>
  else if (sections.length === 0 && query.trim()) body = <p className="mn-missions-empty">Nothing matches “{query.trim()}”.</p>
  else if (sections.length === 0 && github !== 'ready') body = <p className="mn-missions-empty">Reading issues and pull requests from GitHub…</p>
  else if (sections.length === 0) body = <p className="mn-missions-empty">No open issue, pull request or mission{only ? ` in ${nameOf(only)}` : ''}.</p>
  else
    body = sections.map((s) => (
      <section key={s.repo.root} className="mn-missions-repo" data-root={s.repo.root}>
        <header className="mn-missions-head">
          <span className="mn-missions-name">{s.repo.name}</span>
          <span className="mn-missions-path mn-mono" title={s.repo.root}>
            {shortPath(s.repo.root)}
          </span>
          <Label>
            {plural(s.issues.length, 'issue')} · {plural(s.prs.length, 'PR')}
          </Label>
          <button type="button" className="mn-missions-btn" aria-expanded={contractFor === s.repo.root} onClick={() => setContractFor((c) => (c === s.repo.root ? null : s.repo.root))}>
            {here?.root === s.repo.root && <Kbd>P</Kbd>} Contract
          </button>
        </header>
        {contractFor === s.repo.root && (
          <ContractPicker
            root={s.repo.root}
            missions={mission.repos.find((g) => samePath(g.root, s.repo.root))?.missions ?? []}
            flags={flags}
            busy={(path) => running(contractDispatchKey(s.repo.root, path))}
            onGo={(path) => dispatchContract(s.repo.root, path)}
            onClose={() => {
              setContractFor(null)
              toList()
            }}
          />
        )}
        {s.error && <p className="mn-missions-why">GitHub could not read this repo: {s.error}</p>}
        {s.missions.length > 0 && <Label className="mn-missions-sub">Missions</Label>}
        {s.missions.map((m) => (
          <MissionRow key={m.feature} mission={m} on={cursor === `mission:${s.repo.root}#${m.feature}`} rowKey={`mission:${s.repo.root}#${m.feature}`} onAt={setAt} onLand={() => armLand(s.repo.root, m)} />
        ))}
        {s.issues.length > 0 && <Label className="mn-missions-sub">Issues</Label>}
        {s.issues.map((i) => {
          const key = `issue:${s.repo.root}#${i.number}`
          const link = s.links.get(i.number)
          const isPicked = picked?.root === s.repo.root && picked.ns.includes(i.number)
          const session = sessionOfLink(link)
          return (
            <div key={key} className="mn-missions-row" data-row={key} data-on={cursor === key || undefined} data-picked={isPicked || undefined} onMouseDown={() => setAt(key)}>
              {link ? (
                <span className="mn-missions-box" aria-hidden />
              ) : (
                <button type="button" role="checkbox" aria-checked={isPicked} aria-label={`Pick #${i.number} to dispatch`} title="Pick to dispatch (shift: a range)" className="mn-missions-box" onClick={(e: MouseEvent) => pickIssue(s, i.number, e.shiftKey)}>
                  {isPicked ? '■' : ''}
                </button>
              )}
              <button type="button" className="mn-missions-title" title={`Open #${i.number} in the browser`} onClick={() => external(i.url)}>
                <span className="mn-missions-num mn-num">#{i.number}</span>
                <span className="mn-missions-text">{i.title}</span>
              </button>
              {i.labels.slice(0, 2).map((l) => (
                <span key={l} className="mn-missions-tag">
                  {l}
                </span>
              ))}
              {link && <Flight standing={flightStanding(link)} session={session} />}
            </div>
          )
        })}
        {s.prs.length > 0 && <Label className="mn-missions-sub">Pull requests</Label>}
        {s.prs.map((p) => {
          const key = `pr:${s.repo.root}#${p.number}`
          return (
            <div key={key} className="mn-missions-row" data-row={key} data-on={cursor === key || undefined} onMouseDown={() => setAt(key)}>
              <span className="mn-missions-box" aria-hidden />
              <button type="button" className="mn-missions-title" title={`Open PR #${p.number} in the browser`} onClick={() => external(p.url)}>
                <span className="mn-missions-num mn-num">#{p.number}</span>
                <span className="mn-missions-text">{p.title}</span>
              </button>
              {p.state === 'draft' && <span className="mn-missions-tag">draft</span>}
              <Checks pr={p} />
              {p.child && (
                <button type="button" className="mn-missions-link" title="The session that opened it: open it on stage" onClick={() => stage(p.child!)}>
                  {p.child} →
                </button>
              )}
            </div>
          )
        })}
      </section>
    ))

  return (
    <div ref={root} className="mn-missions" data-missions="" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="mn-missions-bar">
        <label className="mn-missions-field">
          <Kbd>/</Kbd>
          <input
            ref={filterField}
            aria-label="Filter issues and pull requests"
            placeholder="Filter: #12, a word, a label"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                setQuery('')
                toList()
              } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault()
                toList()
              }
            }}
          />
        </label>
        <button type="button" className="mn-missions-btn" disabled={github === 'loading'} title={githubAt ? `GitHub was read ${relTime(githubAt)} ago` : 'GitHub has not been read yet'} onClick={() => void homeStore.getState().refreshGithub()}>
          <Kbd>U</Kbd> {github === 'loading' ? 'Reading…' : 'Read again'}
        </button>
      </div>
      {listable.length > 1 && (
        <div className="mn-missions-repos" role="radiogroup" aria-label="Repo">
          <button type="button" role="radio" aria-checked={only === null} className="mn-missions-chip" onClick={() => setOnly(null)}>
            Every repo
          </button>
          {listable.map((r) => (
            <button key={r.root} type="button" role="radio" aria-checked={only === r.root} className="mn-missions-chip" onClick={() => setOnly(r.root)}>
              {r.name} <span className="mn-num">{(r.issues?.length ?? 0) + (r.prs?.length ?? 0)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mn-missions-flags" aria-label="What the next dispatch carries">
        {FLAGS.map((f) => (
          <div key={f.flag} className="mn-missions-flag" role="radiogroup" aria-label={f.name}>
            <span className="mn-missions-flagname">
              <Kbd>{f.key}</Kbd> <Label>{f.name}</Label>
            </span>
            {f.options.map((o) => (
              <button key={o} type="button" role="radio" aria-checked={flags[f.flag] === o} className="mn-missions-opt" onClick={() => setFlags({ ...flags, [f.flag]: o })}>
                {o || f.off}
              </button>
            ))}
          </div>
        ))}
      </div>
      {otherErrors(snap.errors).map((e) => (
        <p key={e} className="mn-missions-why">
          {e}
        </p>
      ))}
      {notice && (
        <p className="mn-missions-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </p>
      )}
      {launches.length > 0 && (
        <section className="mn-missions-launched" aria-label="Launched from here">
          <Label className="mn-missions-sub">
            Launched <span className="mn-num">{launches.length}</span>
          </Label>
          {launches.map((l) => (
            <LaunchRow key={l.id} launch={l} progress={progressOf(l, jobs, mission, snap)} />
          ))}
        </section>
      )}
      <div className="mn-missions-list">{body}</div>
      {batch && (
        <div className="mn-missions-foot" role="toolbar" aria-label="Dispatch the picked issues" data-armed="dispatch">
          <span className="mn-missions-what">
            <strong>{sorted.map((n) => `#${n}`).join(', ')}</strong> in {nameOf(batch.root)}, one child each
            <span className="mn-missions-with">{flagWords(optionsOf(flags)) || 'default model, effort and may'}</span>
          </span>
          <button type="button" className="mn-missions-btn" data-tone="go" disabled={running(dispatchKey(batch.root, sorted))} title={running(dispatchKey(batch.root, sorted)) ? 'The same dispatch is already running' : undefined} onClick={dispatchBatch}>
            <Kbd>Enter</Kbd> Dispatch {sorted.length}
          </button>
          <button type="button" className="mn-missions-btn" onClick={() => setPicked(null)}>
            <Kbd>Esc</Kbd> Clear
          </button>
        </div>
      )}
      {landing && (
        <div className="mn-missions-foot" role="toolbar" aria-label="Land the mission" data-armed="land">
          <span className="mn-missions-what">
            Land <strong>{landing.feature}</strong> in {nameOf(landing.root)}
            <span className="mn-missions-with">its pull requests are rehearsed in order, then merged</span>
          </span>
          <button type="button" className="mn-missions-btn" data-tone="go" onClick={land}>
            <Kbd>Enter</Kbd> Land
          </button>
          <button type="button" className="mn-missions-btn" onClick={() => setLanding(null)}>
            <Kbd>Esc</Kbd> Cancel
          </button>
        </div>
      )}
    </div>
  )
}

/** What already works on an issue, and its session one click away. */
function Flight({ standing, session }: { standing: Standing; session: string | null }) {
  const inner = (
    <>
      <StateMark state={standing.state} /> <span className="mn-missions-word">{standing.word}</span>
    </>
  )
  return session ? (
    <button type="button" className="mn-missions-flight" data-state={standing.state} title="Open its session on stage" onClick={() => stage(session)}>
      {inner} →
    </button>
  ) : (
    <span className="mn-missions-flight" data-state={standing.state}>
      {inner}
    </span>
  )
}

function Checks({ pr }: { pr: Pr }) {
  const c = checksOf(pr)
  if (!c) return <span className="mn-missions-checks">no checks</span>
  const state = c.tone === 'pass' ? 'ready' : c.tone === 'fail' ? 'stalled' : 'working'
  return (
    <span className="mn-missions-checks" data-state={state}>
      <StateMark state={state} /> <span className="mn-missions-word">{c.label}</span>
    </span>
  )
}

/** A mission dispatched from a contract: how it stands, each piece, and Land when every piece
 *  is in. */
function MissionRow({ mission, on, rowKey, onAt, onLand }: { mission: Mission; on: boolean; rowKey: string; onAt(key: string): void; onLand(): void }) {
  const standing = missionStanding(mission)
  return (
    <div className="mn-missions-row mn-missions-mission" data-row={rowKey} data-on={on || undefined} data-landable={mission.landable || undefined} onMouseDown={() => onAt(rowKey)}>
      <div className="mn-missions-mhead">
        <StateMark state={standing.state} />
        <span className="mn-missions-feature">{mission.feature}</span>
        <span className="mn-missions-word">{standing.word}</span>
        {mission.landable && (
          <button type="button" className="mn-missions-btn" data-tone="go" onClick={onLand}>
            {on && <Kbd>L</Kbd>} Land
          </button>
        )}
      </div>
      <div className="mn-missions-pieces">
        {mission.pieces.map((p) => {
          const s = pieceStanding(p)
          const id = p.child ? (p.child.session_id ?? p.child.id) : null
          const inner = (
            <>
              <StateMark state={s.state} /> <span className="mn-missions-piece-name">{p.name}</span> <span className="mn-missions-word">{s.word}</span>
            </>
          )
          return id ? (
            <button key={p.name} type="button" className="mn-missions-piece" title="Open its session on stage" onClick={() => stage(id)}>
              {inner}
            </button>
          ) : (
            <span key={p.name} className="mn-missions-piece">
              {inner}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** One thing launched from the panel and how it is going. */
function LaunchRow({ launch, progress }: { launch: Launch; progress: ReturnType<typeof progressOf> }) {
  const flags = flagWords(launch.options)
  return (
    <div className="mn-missions-launch" data-launch={launch.id} data-kind={launch.kind} data-state={progress.state}>
      <StateMark state={progress.state} />
      <span className="mn-missions-ltitle">
        <strong>{launchTitle(launch)}</strong> <span className="mn-missions-lrepo">{launch.repo}</span>
        {flags && <span className="mn-missions-with">{flags}</span>}
      </span>
      <span className="mn-missions-age mn-num">{relTime(launch.at) || 'now'}</span>
      {progress.open ? (
        <button type="button" className="mn-missions-lword" title="Open its session on stage" onClick={() => stage(progress.open!)}>
          {progress.word} →
        </button>
      ) : (
        <span className="mn-missions-lword">{progress.word}</span>
      )}
      <button type="button" className="mn-missions-x" aria-label={`Forget ${launchTitle(launch)}`} title="Take it off this list; the work goes on" onClick={() => launchStore.getState().forget(launch.id)}>
        ×
      </button>
    </div>
  )
}

/** Dispatching a decomposition contract of the repo: one found in its contract folders, or a
 *  path typed. One already dispatched asks again before it starts every piece over. */
function ContractPicker({ root, missions, flags, busy, onGo, onClose }: { root: string; missions: Mission[]; flags: Flags; busy(path: string): boolean; onGo(path: string): void; onClose(): void }) {
  const [files, setFiles] = useState<ContractFile[] | null>(null)
  const [path, setPath] = useState('')
  const [again, setAgain] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let live = true
    void listContracts(root)
      .catch(() => [])
      .then((found) => {
        if (!live) return
        const fs = contractFiles(root, found, missions)
        setFiles(fs)
        setPath((p) => p || (fs.find((f) => !f.mission)?.path ?? ''))
      })
    field.current?.focus()
    return () => {
      live = false
    }
    // The folders are read once as the picker opens; the missions only mark them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])
  const p = path.trim()
  const error = contractPathError(path)
  const running = !error && busy(p)
  const before = error ? null : missionOf(root, p, missions)
  const go = () => {
    if (error || running) return
    if (before && again !== p) return setAgain(p)
    onGo(p)
  }
  const with_ = flagWords(optionsOf(flags))
  return (
    <form
      className="mn-missions-contract"
      data-contract-picker=""
      onSubmit={(e) => {
        e.preventDefault()
        go()
      }}
      onKeyDown={(e) => {
        // Enter dispatches from anywhere in the picker, a file's row included.
        if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          go()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {files === null ? (
        <p className="mn-missions-quiet">Looking for contracts…</p>
      ) : files.length === 0 ? (
        <p className="mn-missions-quiet">No contract in docs/superpowers/contracts or docs/contracts. Type its path.</p>
      ) : (
        <div className="mn-missions-files" role="radiogroup" aria-label="Contracts in the repo">
          {files.map((f) => (
            <button key={f.path} type="button" role="radio" aria-checked={p === f.path} className="mn-missions-file" onClick={() => setPath(f.path)}>
              <span className="mn-missions-box" aria-hidden>
                {p === f.path ? '■' : ''}
              </span>
              <span className="mn-missions-text mn-mono">{f.path}</span>
              {f.mission && <span className="mn-missions-tag">dispatched · {plural(f.mission.pieces.length, 'piece')}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mn-missions-go">
        <input ref={field} className="mn-mono" aria-label="Contract path in the repo" placeholder="docs/superpowers/contracts/…" value={path} onChange={(e) => setPath(e.target.value)} />
        <button type="submit" className="mn-missions-btn" data-tone="go" disabled={!!error || running} title={error ?? (running ? 'This contract is already being dispatched' : undefined)}>
          <Kbd>Enter</Kbd> {before && again === p ? 'Dispatch again' : 'Dispatch contract'}
        </button>
      </div>
      {p && error && <p className="mn-missions-why">{error}</p>}
      {before && again === p ? (
        <p className="mn-missions-why" role="alert">
          {p} was already dispatched as “{before.feature}” ({plural(before.pieces.length, 'piece')}). Dispatching it again starts every piece over, beside the ones there. Enter again to do it.
        </p>
      ) : (
        <p className="mn-missions-quiet">Every piece gets a child{with_ ? `: ${with_}` : ', with each piece’s own model and effort'}.</p>
      )}
    </form>
  )
}

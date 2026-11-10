// What mnemo learned: the pages it recovered from one repo's Claude Code history, decided once.
// It asks before anything reaches a model, shows the run as it goes (the run lives in the
// store, so closing the panel does not stop it), then lists every page kept, grouped by type.

import { useEffect, useRef } from 'react'
import { learned, useLearned } from '../../learned/app-store'
import { settled, type Count, type Phase } from '../../learned/store'
import { day, firstExpiry, groupPages, type Group, type LearnedPage } from '../../learned/types'
import { ArmBtn, Btn, count, Loading, Notice, openPanel, Out, Progress, Quiet, RepoPicker } from '../memory/kit'
import { chooseRepo, showTab, useRepo } from '../memory/state'
import './learned.css'

function Bar({ label, done }: { label: string; done: Count | null }) {
  return (
    <div className="learned-bar">
      <div className="sp-row">
        <span className="learned-bar-n mn-num">
          {done ? done.done : '–'}
          <i>{done ? ` of ${done.of}` : ' waiting'}</i>
        </span>
        <span className="sp-end mn-label">{label}</span>
      </div>
      <Progress label={label} value={done && done.of > 0 ? done.done / done.of : 0} tone="memory" />
    </div>
  )
}

function Row({ page, checked, open }: { page: LearnedPage; checked: boolean; open: boolean }) {
  return (
    <li className="learned-row" data-key={page.key} data-dropped={checked ? undefined : ''}>
      <label className="sp-check learned-keep">
        <input type="checkbox" checked={checked} aria-label={`keep ${page.name}`} onChange={() => learned.getState().toggle(page.key)} />
      </label>
      <button type="button" className="learned-pick" aria-expanded={open} onClick={() => learned.getState().expand(page.key)}>
        <span className="sp-name">{page.name}</span>
        {page.description && <span className="sp-dim learned-sub">{page.description}</span>}
      </button>
      <span className="learned-fate">{checked ? 'kept' : 'dropped'}</span>
      {open && <Out>{page.excerpt || '(no excerpt)'}</Out>}
    </li>
  )
}

function GroupList({ group }: { group: Group }) {
  const checked = useLearned((s) => s.checked)
  const expanded = useLearned((s) => s.expanded)
  const kept = group.pages.filter((p) => checked[p.key]).length
  const all = kept === group.pages.length
  return (
    <section className="learned-group" data-type={group.type}>
      <header className="sp-row learned-group-head">
        <span className="mn-label">{group.label}</span>
        <span className="sp-dim mn-num">
          {kept} of {group.pages.length} kept
        </span>
        <Btn small className="sp-end" onClick={() => learned.getState().setType(group.type, !all)}>
          {all ? 'Keep none' : 'Keep all'}
        </Btn>
      </header>
      <ul className="learned-rows">
        {group.pages.map((p) => (
          <Row key={p.key} page={p} checked={!!checked[p.key]} open={!!expanded[p.key]} />
        ))}
      </ul>
    </section>
  )
}

function Review() {
  const pages = useLearned((s) => s.pages)
  const checked = useLearned((s) => s.checked)
  const kept = pages.filter((p) => checked[p.key]).length
  const dropped = pages.length - kept
  const expires = firstExpiry(pages)
  const keep = () => void learned.getState().keep()
  return (
    <>
      <p className="learned-lead">
        mnemo learned <b className="mn-num">{count(pages.length, 'page')}</b> from your history. Everything starts kept: uncheck what is wrong, or was only true for a while.
      </p>
      {groupPages(pages).map((g) => (
        <GroupList key={g.type} group={g} />
      ))}
      <footer className="learned-foot">
        <div className="sp-wrap">
          {/* What is unchecked is dropped: a decision that drops is asked twice. */}
          {dropped > 0 ? (
            <ArmBtn tone="go" data-decide="" sure={`Drop ${count(dropped, 'page')} for good? Press again`} onConfirm={keep}>
              {kept ? `Keep ${kept}, drop ${dropped}` : `Drop all ${dropped}`}
            </ArmBtn>
          ) : (
            <Btn tone="go" data-decide="" onClick={keep}>
              Keep all {kept}
            </Btn>
          )}
          <Btn onClick={() => void learned.getState().later()}>Decide later</Btn>
        </div>
        <span className="sp-dim">
          mnemo reaches the kept pages from your next prompt on
          {expires && (
            <>
              ; undecided pages expire on <span className="sp-nowrap">{day(expires)}</span>
            </>
          )}
        </span>
      </footer>
    </>
  )
}

function Done({ phase }: { phase: Extract<Phase, { kind: 'done' }> }) {
  if (phase.skipped) {
    return (
      <p className="learned-lead">
        Nothing decided. The pages stay staged{phase.expiresAt ? ` until ${day(phase.expiresAt)}` : ''}, then expire; Memory's inbox lists them until then.
      </p>
    )
  }
  return (
    <>
      <div className="learned-figures">
        <div className="learned-figure" data-tone="memory">
          <span className="learned-figure-value mn-num">{phase.kept.length}</span>
          <span className="mn-label">kept</span>
        </div>
        <div className="learned-figure">
          <span className="learned-figure-value mn-num">{phase.dropped.length}</span>
          <span className="mn-label">dropped</span>
        </div>
      </div>
      <p className="learned-lead">mnemo reaches the kept pages from your next prompt on.</p>
      {phase.failed.length > 0 && (
        <Notice
          tone="bad"
          text={
            <span data-failed-list="">
              {phase.failed.length === 1 ? '1 page was not decided and stays' : `${phase.failed.length} pages were not decided and stay`}
              {phase.expiresAt ? ` staged until ${day(phase.expiresAt)}` : ' staged'}:
              {phase.failed.map((f) => (
                <span key={f.key} className="learned-failed" data-failed={f.key}>
                  <code>{f.key}</code> {f.error}
                </span>
              ))}
            </span>
          }
        />
      )}
    </>
  )
}

function Body({ phase }: { phase: Phase }) {
  const target = useLearned((s) => s.target)
  const project = target?.project ?? 'this repo'
  switch (phase.kind) {
    case 'idle':
    case 'checking':
      return <Loading>looking at what mnemo has for {project}…</Loading>
    case 'consent': {
      const { sessions, callsEstimate } = phase.dry
      return (
        <div className="learned-consent">
          <div className="learned-figures">
            <div className="learned-figure" data-tone="memory">
              <span className="learned-figure-value mn-num">{sessions}</span>
              <span className="mn-label">{sessions === 1 ? 'session to read' : 'sessions to read'}</span>
            </div>
            <div className="learned-figure">
              <span className="learned-figure-value mn-num">≈{callsEstimate}</span>
              <span className="mn-label">model {callsEstimate === 1 ? 'call' : 'calls'} on your plan</span>
            </div>
          </div>
          <p className="learned-lead">
            mnemo can read your last {count(sessions, 'session')} in <b>{project}</b> and learn from them.
          </p>
          <p className="learned-lead sp-dim">Nothing is sent to a model until you say yes. You review every page before it goes live.</p>
          <div className="sp-wrap">
            <Btn tone="go" onClick={() => void learned.getState().consent()}>
              Read my history
            </Btn>
            <Btn onClick={() => void learned.getState().notNow()}>Not now</Btn>
          </div>
        </div>
      )
    }
    case 'running':
      return (
        <>
          <p className="learned-lead">Reading your history in {project}.</p>
          <Bar label="reading sessions" done={phase.harvest} />
          <Bar label="learning from them" done={phase.extract} />
          <Quiet>You can close this panel: the run keeps going, and the review waits here.</Quiet>
          {phase.err.length > 0 && <Out tone="bad">{phase.err.join('\n')}</Out>}
        </>
      )
    case 'review':
      return <Review />
    case 'deciding':
      return <Loading>deciding…</Loading>
    case 'done':
      return <Done phase={phase} />
    case 'declined':
      return <p className="learned-lead">Nothing was read. Open this panel whenever you want mnemo to ask again.</p>
    case 'nothing':
      return <p className="learned-lead">Nothing to review in {project}: no session left to read, and nothing learned from your history is waiting.</p>
    case 'no-repo':
      return <p className="learned-lead">No repo here yet: mnemo learns from the Claude Code sessions of one project at a time. Add one in Projects.</p>
    case 'error':
      return (
        <Notice tone="bad" text={phase.message}>
          {target && (
            <Btn small onClick={() => void learned.getState().open(target)}>
              Try again
            </Btn>
          )}
        </Notice>
      )
  }
}

/** Every staged page, in Memory's inbox. */
const openInbox = () => {
  showTab('inbox')
  openPanel('memory')
}

export function LearnedPanel() {
  const phase = useLearned((s) => s.phase)
  const { repos, repo } = useRepo()
  const root = repo?.root
  // Opening looks again at the picked repo, unless a question, a checklist or a run is on
  // screen; picking another repo looks at it (a run or a decision under way keeps the screen).
  const opened = useRef(false)
  useEffect(() => {
    const first = !opened.current
    opened.current = true
    if (first && !settled(learned.getState().phase)) return
    void learned.getState().openCwd(root)
  }, [root])
  return (
    <div className="learned sp-root" tabIndex={-1} data-learned-panel="" data-phase={phase.kind}>
      <div className="sp-wrap learned-head">
        <RepoPicker repos={repos} repo={repo} onPick={chooseRepo} />
        <Btn small className="sp-end" onClick={openInbox}>
          Memory's inbox
        </Btn>
      </div>
      <Body phase={phase} />
    </div>
  )
}

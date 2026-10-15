import { useEffect, useRef, type JSX } from 'react'
import { learned, useLearned } from '../../../learned/app-store'
import { settled, type Count, type Phase } from '../../../learned/store'
import { day, firstExpiry, groupPages, type Group, type LearnedPage } from '../../../learned/types'
import { confirm } from '../../ui/confirm'
import { openWindow } from '../../ui/windows'
import { ErrorText, Loading, RepoPicker } from '../memory/kit'
import { memoryTab } from '../memory/MemoryWindow'
import { useRepo } from '../memory/repo'
import '../memory/memory.css'
import './learned.css'

function Bar({ label, count }: { label: string; count: Count | null }) {
  const pct = count && count.of > 0 ? Math.min(100, Math.round((count.done / count.of) * 100)) : 0
  return (
    <div className="nx-ln-bar">
      <span>
        {label} <span className="nx-muted">{count ? `${count.done} of ${count.of}` : 'waiting'}</span>
      </span>
      <div className="nx-ln-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="nx-ln-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Row({ page, checked, open }: { page: LearnedPage; checked: boolean; open: boolean }) {
  return (
    <li className="nx-ln-row" data-key={page.key} data-unchecked={checked ? undefined : ''}>
      <div className="nx-ln-row-head">
        <input type="checkbox" checked={checked} aria-label={`keep ${page.name}`} onChange={() => learned.getState().toggle(page.key)} />
        <button type="button" className="nx-ln-pick" aria-expanded={open} title={page.key} onClick={() => learned.getState().expand(page.key)}>
          <span aria-hidden className="nx-muted">
            {open ? '▾' : '▸'}
          </span>
          <span className="nx-ln-name">{page.name}</span>
          {page.description && <span className="nx-muted nx-mem-sub">{page.description}</span>}
        </button>
      </div>
      {open && <pre className="nx-ln-excerpt">{page.excerpt || '(no excerpt)'}</pre>}
    </li>
  )
}

function GroupList({ group }: { group: Group }) {
  const checked = useLearned((s) => s.checked)
  const expanded = useLearned((s) => s.expanded)
  const kept = group.pages.filter((p) => checked[p.key]).length
  const all = kept === group.pages.length
  return (
    <section data-type={group.type}>
      <header className="nx-ln-group-head">
        <span className="nx-section">{group.label}</span>
        <span className="nx-muted">
          {kept} of {group.pages.length} kept
        </span>
        <button type="button" className="nx-btn nx-mem-end" onClick={() => learned.getState().setType(group.type, !all)}>
          {all ? 'Keep none' : 'Keep all'}
        </button>
      </header>
      <ul className="nx-ln-rows">
        {group.pages.map((p) => (
          <Row key={p.key} page={p} checked={!!checked[p.key]} open={!!expanded[p.key]} />
        ))}
      </ul>
    </section>
  )
}

/** [Keep selected]: what is unchecked is dropped, so a decision that drops asks first. */
export async function keepSelected(): Promise<void> {
  const { pages, checked } = learned.getState()
  const dropped = pages.filter((p) => !checked[p.key]).length
  if (dropped > 0) {
    const kept = pages.length - dropped
    const ok = await confirm({
      title: `Keep ${kept}, drop ${dropped}?`,
      body: `The ${dropped === 1 ? 'unchecked page is' : `${dropped} unchecked pages are`} dropped; mnemo reaches the kept ones from your next prompt on.`,
      confirm: kept ? 'Keep selected' : 'Drop all',
      danger: true,
    })
    if (!ok) return
  }
  await learned.getState().keep()
}

function Review() {
  const pages = useLearned((s) => s.pages)
  const checked = useLearned((s) => s.checked)
  const kept = pages.filter((p) => checked[p.key]).length
  const expires = firstExpiry(pages)
  return (
    <>
      <p className="nx-ln-lead">
        mnemo learned {pages.length} {pages.length === 1 ? 'page' : 'pages'} from your history. Everything starts kept: uncheck what is wrong or was only true for a while.
      </p>
      {groupPages(pages).map((g) => (
        <GroupList key={g.type} group={g} />
      ))}
      <footer className="nx-ln-actions">
        <button type="button" className="nx-btn" data-tone="go" onClick={() => void keepSelected()}>
          Keep selected ({kept})
        </button>
        <button type="button" className="nx-btn" onClick={() => void learned.getState().later()}>
          Decide later
        </button>
        <span className="nx-muted">
          {pages.length - kept} unchecked {pages.length - kept === 1 ? 'is' : 'are'} dropped
          {expires && <>; undecided pages expire on {day(expires)}</>}
        </span>
      </footer>
    </>
  )
}

function Done({ phase }: { phase: Extract<Phase, { kind: 'done' }> }) {
  if (phase.skipped)
    return (
      <p className="nx-ln-lead">
        Nothing decided. The pages stay staged{phase.expiresAt ? ` until ${day(phase.expiresAt)}` : ''}, then expire; Memory's inbox still lists them until then.
      </p>
    )
  return (
    <>
      <p className="nx-ln-lead nx-mem-good">
        Kept {phase.kept.length}, dropped {phase.dropped.length}. mnemo reaches the kept pages from your next prompt on.
      </p>
      {phase.failed.length > 0 && (
        <div className="nx-ln-box" data-failed-list="">
          <span className="nx-mem-bad">
            {phase.failed.length === 1 ? '1 page was not decided and stays' : `${phase.failed.length} pages were not decided and stay`}
            {phase.expiresAt ? ` staged until ${day(phase.expiresAt)}` : ' staged'}:
          </span>
          {phase.failed.map((f) => (
            <div key={f.key} data-failed={f.key}>
              <code>{f.key}</code> <span className="nx-muted">{f.error}</span>
            </div>
          ))}
        </div>
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
        <div className="nx-ln-box">
          <p className="nx-ln-lead">
            mnemo can read your last {sessions} {sessions === 1 ? 'session' : 'sessions'} in <b>{project}</b> and learn from them. About {callsEstimate} model{' '}
            {callsEstimate === 1 ? 'call' : 'calls'} on your Claude plan.
          </p>
          <p className="nx-ln-lead nx-muted">Nothing is sent to a model until you say yes. You review every page before it goes live.</p>
          <div className="nx-ln-actions">
            <button type="button" className="nx-btn" data-tone="go" onClick={() => void learned.getState().consent()}>
              Read my history
            </button>
            <button type="button" className="nx-btn" onClick={() => void learned.getState().notNow()}>
              Not now
            </button>
          </div>
        </div>
      )
    }
    case 'running':
      return (
        <>
          <p className="nx-ln-lead">Reading your history in {project}.</p>
          <Bar label="reading sessions" count={phase.harvest} />
          <Bar label="learning from them" count={phase.extract} />
          <p className="nx-ln-lead nx-muted">You can close this window: the run keeps going, and the review waits here.</p>
          {phase.err.length > 0 && <pre className="nx-mem-out nx-mem-bad">{phase.err.join('\n')}</pre>}
        </>
      )
    case 'review':
      return <Review />
    case 'deciding':
      return <Loading>deciding…</Loading>
    case 'done':
      return <Done phase={phase} />
    case 'declined':
      return <p className="nx-ln-lead">Nothing was read. SYSTEMS › What mnemo learned asks again whenever you want.</p>
    case 'nothing':
      return <p className="nx-ln-lead">Nothing to review in {project}: no session left to read, and nothing learned from your history is waiting.</p>
    case 'no-repo':
      return <p className="nx-ln-lead">Pick a repo first: mnemo learns from the Claude Code sessions of one project at a time.</p>
    case 'error':
      return (
        <>
          <ErrorText text={phase.message} />
          {target && (
            <div className="nx-ln-actions">
              <button type="button" className="nx-btn" onClick={() => void learned.getState().open(target)}>
                Try again
              </button>
            </div>
          )}
        </>
      )
  }
}

const openInbox = () => {
  memoryTab.setState({ tab: 'inbox' })
  openWindow('memory')
}

/** The SYSTEMS menu's What mnemo learned (spec Q8): the pages mnemo recovered from the picked
 *  repo's Claude Code history, decided once. It asks before anything reaches a model, shows the
 *  run as it goes (the run lives in the store, so closing the window does not stop it), then
 *  lists every page checked, grouped by type. */
export function LearnedWindow(_: { close: () => void }): JSX.Element {
  const phase = useLearned((s) => s.phase)
  const { repos, repo } = useRepo()
  const root = repo?.root
  // Opening looks again at the picked repo, unless a question, a checklist or a run is on screen;
  // picking another repo looks at it (a run or a decision under way keeps the screen).
  const opened = useRef(false)
  useEffect(() => {
    const first = !opened.current
    opened.current = true
    if (first && !settled(learned.getState().phase)) return
    void learned.getState().openCwd(root)
  }, [root])
  return (
    <div className="nx-ln" data-learned-window="">
      <div className="nx-mem-head">
        <span className="nx-muted">from your Claude Code history, decided once</span>
        <span className="nx-mem-end">
          <RepoPicker repos={repos} repo={repo} />
          <button type="button" className="nx-btn" title="Every staged page, in Memory's inbox" onClick={openInbox}>
            Inbox
          </button>
        </span>
      </div>
      <Body phase={phase} />
    </div>
  )
}

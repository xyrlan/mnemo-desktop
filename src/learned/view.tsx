/** "What mnemo learned" (#180, D1 of mnemo's install-review spec): the one screen where the user
 *  decides which pages mnemo recovered from their Claude Code history go live. It asks before
 *  anything reaches a model, shows the run as it goes (the run lives in the core, so leaving
 *  the screen does not stop it), then lists every page checked, grouped by type. Opens by itself
 *  once per project after setup; the vault's inbox opens it by hand. */
import { useEffect } from 'react'
import { store } from '../layout/app-store'
import { homeStore } from '../home/app-store'
import { cwdForNewShell } from '../layout/cwd'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { setup } from '../setup/app-store'
import { afterRestore } from '../setup/launch'
import { needsSetup } from '../setup/tools'
import { learned, learnedClient, useLearned } from './app-store'
import { showLearned, watchForReview } from './launch'
import { reviewWhatWasLearned } from './open'
import { settled, type Count, type Phase } from './store'
import { day, groupPages, firstExpiry, type Group, type LearnedPage } from './types'
import './learned.css'

function Bar({ label, count }: { label: string; count: Count | null }) {
  const pct = count && count.of > 0 ? Math.min(100, Math.round((count.done / count.of) * 100)) : 0
  return (
    <div className="ln-progress">
      <div className="ln-progress-label">
        {label}
        <span className="ln-muted">{count ? ` ${count.done} of ${count.of}` : ' waiting'}</span>
      </div>
      <div className="ln-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="ln-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Row({ page, checked, open }: { page: LearnedPage; checked: boolean; open: boolean }) {
  return (
    <li className={`ln-row${checked ? '' : ' ln-unchecked'}`} data-key={page.key}>
      <div className="ln-row-head">
        <input type="checkbox" checked={checked} aria-label={`keep ${page.name}`} onChange={() => learned.getState().toggle(page.key)} />
        <button className="ln-row-name" aria-expanded={open} onClick={() => learned.getState().expand(page.key)} title={page.key}>
          <span className="ln-caret">{open ? '▾' : '▸'}</span>
          <span className="ln-name">{page.name}</span>
          {page.description && <span className="ln-desc">{page.description}</span>}
        </button>
      </div>
      {open && <pre className="ln-excerpt">{page.excerpt || '(no excerpt)'}</pre>}
    </li>
  )
}

function GroupList({ group }: { group: Group }) {
  const checked = useLearned((s) => s.checked)
  const expanded = useLearned((s) => s.expanded)
  const kept = group.pages.filter((p) => checked[p.key]).length
  const all = kept === group.pages.length
  return (
    <section className="ln-group" data-type={group.type}>
      <header className="ln-group-head">
        <span className="ln-group-label">{group.label}</span>
        <span className="ln-muted">
          {kept} of {group.pages.length} kept
        </span>
        <button className="ln-group-toggle" onClick={() => learned.getState().setType(group.type, !all)}>
          {all ? 'keep none' : 'keep all'}
        </button>
      </header>
      <ul className="ln-rows">
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
  const expires = firstExpiry(pages)
  return (
    <>
      <div className="ln-lead">
        mnemo learned {pages.length} {pages.length === 1 ? 'page' : 'pages'} from your history. Everything starts kept: uncheck
        what is wrong or was only true for a while.
      </div>
      {groupPages(pages).map((g) => (
        <GroupList key={g.type} group={g} />
      ))}
      <footer className="ln-actions">
        <button className="ln-primary" onClick={() => void learned.getState().keep()}>
          Keep selected ({kept})
        </button>
        <button onClick={() => void learned.getState().later()}>Decide later</button>
        <span className="ln-muted">
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
      <div className="ln-lead">
        Nothing decided. The pages stay staged{phase.expiresAt ? ` until ${day(phase.expiresAt)}` : ''}, then expire; the vault's
        inbox still lists them until then.
      </div>
    )
  return (
    <>
      <div className="ln-lead ln-ok">
        Kept {phase.kept.length}, dropped {phase.dropped.length}. mnemo reaches the kept pages from your next prompt on.
      </div>
      {phase.failed.length > 0 && (
        <div className="ln-failed">
          <div className="ln-error">
            {phase.failed.length === 1 ? '1 page was not decided and stays' : `${phase.failed.length} pages were not decided and stay`}
            {phase.expiresAt ? ` staged until ${day(phase.expiresAt)}` : ' staged'}:
          </div>
          <ul>
            {phase.failed.map((f) => (
              <li key={f.key} data-failed={f.key}>
                <code>{f.key}</code> <span className="ln-muted">{f.error}</span>
              </li>
            ))}
          </ul>
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
      return <div className="ln-muted">looking at what mnemo has for {project}…</div>
    case 'consent': {
      const { sessions, callsEstimate } = phase.dry
      return (
        <>
          <div className="ln-lead">
            mnemo can read your last {sessions} {sessions === 1 ? 'session' : 'sessions'} in <b>{project}</b> and learn from them.
            About {callsEstimate} model {callsEstimate === 1 ? 'call' : 'calls'} on your Claude plan.
          </div>
          <div className="ln-muted">Nothing is sent to a model until you say yes. You review every page before it goes live.</div>
          <div className="ln-actions">
            <button className="ln-primary" onClick={() => void learned.getState().consent()}>
              Read my history
            </button>
            <button onClick={() => void learned.getState().notNow()}>Not now</button>
          </div>
        </>
      )
    }
    case 'running':
      return (
        <>
          <div className="ln-lead">Reading your history in {project}.</div>
          <Bar label="reading sessions" count={phase.harvest} />
          <Bar label="learning from them" count={phase.extract} />
          <div className="ln-muted">You can leave this screen: the run keeps going, and the review waits here.</div>
          {phase.err.length > 0 && <pre className="ln-log">{phase.err.join('\n')}</pre>}
        </>
      )
    case 'review':
      return <Review />
    case 'deciding':
      return <div className="ln-muted">deciding…</div>
    case 'done':
      return <Done phase={phase} />
    case 'declined':
      return <div className="ln-lead">Nothing was read. The vault's inbox opens this again whenever you want.</div>
    case 'nothing':
      return <div className="ln-lead">Nothing to review in {project}: no session left to read, and nothing learned from your history is waiting.</div>
    case 'no-repo':
      return <div className="ln-lead">Open a repo first: mnemo learns from the Claude Code sessions of one project at a time.</div>
    case 'error':
      return (
        <>
          <pre className="ln-error ln-log">{phase.message}</pre>
          {target && (
            <div className="ln-actions">
              <button onClick={() => void learned.getState().open(target)}>Try again</button>
            </div>
          )}
        </>
      )
  }
}

function LearnedPane(_: PaneViewProps) {
  const phase = useLearned((s) => s.phase)
  // A pane restored with the workspace comes back to an empty store: look again for the open repo.
  useEffect(() => {
    if (learned.getState().phase.kind === 'idle') void learned.getState().openCwd(cwdForNewShell())
  }, [])
  return (
    <div className="pane-body learned">
      <header className="ln-head">
        <span className="ln-title">What mnemo learned</span>
        <span className="ln-sub">from your Claude Code history, decided once</span>
      </header>
      <Body phase={phase} />
    </div>
  )
}

registerPaneView('learned', LearnedPane)

register({ id: 'learned.open', title: 'Review what mnemo learned from your history', run: () => reviewWhatWasLearned(cwdForNewShell()) })

/** Settles once `claude` and `mnemo` are both found: at launch, or when setup installs them. */
function setupDone(): Promise<void> {
  return new Promise((resolve) => {
    const ok = () => {
      const rows = setup.getState().rows
      return !!rows && !needsSetup(rows)
    }
    if (ok()) return resolve()
    const stop = setup.subscribe(() => {
      if (!ok()) return
      stop()
      resolve()
    })
  })
}

// Once per app run, not once per hot reload.
const hot = import.meta.hot?.data as { learnedWatch?: boolean } | undefined
if (!hot?.learnedWatch) {
  if (hot) hot.learnedWatch = true
  watchForReview({
    client: learnedClient,
    ready: Promise.all([afterRestore(store), setupDone()]),
    cwd: () => cwdForNewShell(),
    // Home's selected repo is the open one while Home is in front.
    subscribe: (fn) => {
      const stops = [store.subscribe(fn), homeStore.subscribe(fn)]
      return () => stops.forEach((s) => s())
    },
    show: (target, dry) => {
      if (!settled(learned.getState().phase)) return
      learned.getState().ask(target, dry)
      showLearned(store)
    },
  })
}

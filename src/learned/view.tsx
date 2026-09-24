/** "What mnemo learned" (#180, D1 of mnemo's install-review spec): the one screen where the user
 *  decides which pages mnemo recovered from their Claude Code history go live. It asks before
 *  anything reaches a model, shows the run as it goes (the run lives in the core, so leaving
 *  the screen does not stop it), then lists every page checked, grouped by type. Once per
 *  project after setup it is offered by itself, as onboarding's second step
 *  (`src/onboarding/`); ⌘K and the vault's inbox open this pane by hand. */
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/ui'
import { cn } from '@/ui/cn'
import { store } from '../layout/app-store'
import { homeStore } from '../home/app-store'
import { cwdForNewShell } from '../layout/cwd'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { setup } from '../setup/app-store'
import { afterRestore } from '../setup/launch'
import { needsSetup } from '../setup/tools'
import { learned, learnedClient, useLearned } from './app-store'
import { onboarding } from '../onboarding/app-store'
import { watchForReview } from './launch'
import { reviewWhatWasLearned } from './open'
import { settled, type Count, type Phase } from './store'
import { day, groupPages, firstExpiry, type Group, type LearnedPage } from './types'

function Bar({ label, count }: { label: string; count: Count | null }) {
  const pct = count && count.of > 0 ? Math.min(100, Math.round((count.done / count.of) * 100)) : 0
  return (
    <div className="ln-progress flex max-w-md flex-col gap-1.5">
      <div className="ln-progress-label flex justify-between text-xs">
        {label}
        <span className="ln-muted text-sm text-muted-foreground">{count ? ` ${count.done} of ${count.of}` : ' waiting'}</span>
      </div>
      <div className="ln-bar h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="ln-bar-fill h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Row({ page, checked, open }: { page: LearnedPage; checked: boolean; open: boolean }) {
  return (
    <li className={cn('ln-row rounded-md px-2 py-1', !checked && 'ln-unchecked opacity-55')} data-key={page.key}>
      <div className="ln-row-head flex items-center gap-2">
        <input type="checkbox" className="size-3.5 shrink-0 accent-brand" checked={checked} aria-label={`keep ${page.name}`} onChange={() => learned.getState().toggle(page.key)} />
        <button className="ln-row-name flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm" aria-expanded={open} onClick={() => learned.getState().expand(page.key)} title={page.key}>
          {open ? <ChevronDown className="ln-caret size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="ln-caret size-3.5 shrink-0 text-muted-foreground" />}
          <span className={cn('ln-name shrink-0 font-medium', !checked && 'line-through')}>{page.name}</span>
          {page.description && <span className="ln-desc truncate text-xs text-muted-foreground">{page.description}</span>}
        </button>
      </div>
      {open && <pre className="ln-excerpt mt-1 ml-6 max-h-40 overflow-y-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">{page.excerpt || '(no excerpt)'}</pre>}
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
      <header className="ln-group-head sticky top-0 z-10 flex items-center gap-2 bg-background px-2 py-1.5 text-xs">
        <span className="ln-group-label font-medium tracking-wide uppercase">{group.label}</span>
        <span className="ln-muted text-sm text-muted-foreground">
          {kept} of {group.pages.length} kept
        </span>
        <Button size="xs" variant="ghost" className="ln-group-toggle ml-auto" onClick={() => learned.getState().setType(group.type, !all)}>
          {all ? 'keep none' : 'keep all'}
        </Button>
      </header>
      <ul className="ln-rows flex flex-col">
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
      <div className="ln-lead text-sm leading-relaxed">
        mnemo learned {pages.length} {pages.length === 1 ? 'page' : 'pages'} from your history. Everything starts kept: uncheck
        what is wrong or was only true for a while.
      </div>
      {groupPages(pages).map((g) => (
        <GroupList key={g.type} group={g} />
      ))}
      <footer className="ln-actions flex flex-wrap items-center gap-2">
        <Button onClick={() => void learned.getState().keep()}>Keep selected ({kept})</Button>
        <Button variant="outline" onClick={() => void learned.getState().later()}>
          Decide later
        </Button>
        <span className="ln-muted text-sm text-muted-foreground">
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
      <div className="ln-lead text-sm leading-relaxed">
        Nothing decided. The pages stay staged{phase.expiresAt ? ` until ${day(phase.expiresAt)}` : ''}, then expire; the vault's
        inbox still lists them until then.
      </div>
    )
  return (
    <>
      <div className="ln-lead ln-ok text-sm">
        Kept {phase.kept.length}, dropped {phase.dropped.length}. mnemo reaches the kept pages from your next prompt on.
      </div>
      {phase.failed.length > 0 && (
        <div className="ln-failed flex flex-col gap-1.5">
          <div className="ln-error text-sm text-destructive">
            {phase.failed.length === 1 ? '1 page was not decided and stays' : `${phase.failed.length} pages were not decided and stay`}
            {phase.expiresAt ? ` staged until ${day(phase.expiresAt)}` : ' staged'}:
          </div>
          <ul className="flex flex-col gap-0.5 text-xs">
            {phase.failed.map((f) => (
              <li key={f.key} data-failed={f.key}>
                <code className="font-mono">{f.key}</code> <span className="ln-muted text-sm text-muted-foreground">{f.error}</span>
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
      return (
        <div className="ln-muted text-sm text-muted-foreground">
          <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
          looking at what mnemo has for {project}…
        </div>
      )
    case 'consent': {
      const { sessions, callsEstimate } = phase.dry
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
          <div className="ln-lead text-sm leading-relaxed">
            mnemo can read your last {sessions} {sessions === 1 ? 'session' : 'sessions'} in <b>{project}</b> and learn from them.
            About {callsEstimate} model {callsEstimate === 1 ? 'call' : 'calls'} on your Claude plan.
          </div>
          <div className="ln-muted text-sm text-muted-foreground">Nothing is sent to a model until you say yes. You review every page before it goes live.</div>
          <div className="ln-actions flex flex-wrap items-center gap-2">
            <Button onClick={() => void learned.getState().consent()}>Read my history</Button>
            <Button variant="outline" onClick={() => void learned.getState().notNow()}>
              Not now
            </Button>
          </div>
        </div>
      )
    }
    case 'running':
      return (
        <>
          <div className="ln-lead text-sm leading-relaxed">Reading your history in {project}.</div>
          <Bar label="reading sessions" count={phase.harvest} />
          <Bar label="learning from them" count={phase.extract} />
          <div className="ln-muted text-sm text-muted-foreground">You can leave this screen: the run keeps going, and the review waits here.</div>
          {phase.err.length > 0 && <pre className="ln-log max-h-40 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap text-destructive">{phase.err.join('\n')}</pre>}
        </>
      )
    case 'review':
      return <Review />
    case 'deciding':
      return <div className="ln-muted text-sm text-muted-foreground">deciding…</div>
    case 'done':
      return <Done phase={phase} />
    case 'declined':
      return <div className="ln-lead text-sm leading-relaxed">Nothing was read. The vault's inbox opens this again whenever you want.</div>
    case 'nothing':
      return <div className="ln-lead text-sm leading-relaxed">Nothing to review in {project}: no session left to read, and nothing learned from your history is waiting.</div>
    case 'no-repo':
      return <div className="ln-lead text-sm leading-relaxed">Open a repo first: mnemo learns from the Claude Code sessions of one project at a time.</div>
    case 'error':
      return (
        <>
          <pre className="ln-error ln-log max-h-40 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">{phase.message}</pre>
          {target && (
            <div className="ln-actions flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void learned.getState().open(target)}>
                Try again
              </Button>
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
    <div className="pane-body learned flex flex-col gap-3 overflow-auto px-4 py-3 text-sm" data-ui>
      <header className="ln-head flex min-w-0 items-baseline gap-2.5">
        <span className="ln-title text-sm font-semibold">What mnemo learned</span>
        <span className="ln-sub min-w-0 flex-1 truncate text-xs text-muted-foreground">from your Claude Code history, decided once</span>
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
      // A dialog already open at setup reaches the consent on Continue.
      onboarding.getState().offer('learned')
    },
  })
}

/** Onboarding's second step: "what mnemo learned" (`src/learned/`), the same store as the pane ⌘K
 *  opens. It asks before anything reaches a model, shows the run as it goes (the run lives in
 *  the core, so closing the dialog does not stop it), then the checklist of every page. */
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui'
import { cn } from '@/ui/cn'
import { learned, useLearned } from '../learned/app-store'
import { settled, type Count, type Phase } from '../learned/store'
import { day, firstExpiry, groupPages, type Group, type LearnedPage } from '../learned/types'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function Bar({ label, count }: { label: string; count: Count | null }) {
  const pct = count && count.of > 0 ? Math.min(100, Math.round((count.done / count.of) * 100)) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">{count ? `${count.done} of ${count.of}` : 'waiting'}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Row({ page, checked, open }: { page: LearnedPage; checked: boolean; open: boolean }) {
  return (
    <li data-key={page.key} className={cn('rounded-md px-2 py-1', !checked && 'opacity-55')}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          className="size-3.5 shrink-0 accent-brand"
          checked={checked}
          aria-label={`keep ${page.name}`}
          onChange={() => learned.getState().toggle(page.key)}
        />
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
          aria-expanded={open}
          title={page.key}
          onClick={() => learned.getState().expand(page.key)}
        >
          {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className={cn('shrink-0 font-medium', !checked && 'line-through')}>{page.name}</span>
          {page.description && <span className="truncate text-xs text-muted-foreground">{page.description}</span>}
        </button>
      </div>
      {open && (
        <pre className="mt-1 ml-6 max-h-40 overflow-y-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
          {page.excerpt || '(no excerpt)'}
        </pre>
      )}
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
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-2 py-1.5 text-xs backdrop-blur-sm dark:bg-[rgba(23,23,23,0.95)]">
        <span className="font-medium tracking-wide text-foreground uppercase">{group.label}</span>
        <span className="text-muted-foreground">
          {kept} of {group.pages.length} kept
        </span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={() => learned.getState().setType(group.type, !all)}>
          {all ? 'Keep none' : 'Keep all'}
        </Button>
      </header>
      <ul className="flex flex-col">
        {group.pages.map((p) => (
          <Row key={p.key} page={p} checked={!!checked[p.key]} open={!!expanded[p.key]} />
        ))}
      </ul>
    </section>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>
}

function Body({ phase, project }: { phase: Phase; project: string }) {
  const pages = useLearned((s) => s.pages)
  switch (phase.kind) {
    case 'idle':
    case 'checking':
      return (
        <Muted>
          <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
          looking at what mnemo has for {project}…
        </Muted>
      )
    case 'consent': {
      const { sessions, callsEstimate } = phase.dry
      return (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-sm">
          <div>
            mnemo can read your last {plural(sessions, 'session')} in <b className="font-semibold">{project}</b> and learn from them.
            About {plural(callsEstimate, 'model call')} on your Claude plan.
          </div>
          <Muted>Nothing is sent to a model until you say yes. You review every page before it goes live.</Muted>
        </div>
      )
    }
    case 'running':
      return (
        <div className="flex flex-col gap-3">
          <Bar label="reading sessions" count={phase.harvest} />
          <Bar label="learning from them" count={phase.extract} />
          <Muted>You can close this: the run keeps going, and ⌘K → “Review what mnemo learned” brings the review back.</Muted>
          {phase.err.length > 0 && (
            <pre className="max-h-24 overflow-y-auto font-mono text-[11px] whitespace-pre-wrap text-destructive">{phase.err.join('\n')}</pre>
          )}
        </div>
      )
    case 'review':
      return (
        <div className="-mx-2 max-h-[45vh] overflow-y-auto" data-review>
          {groupPages(pages).map((g) => (
            <GroupList key={g.type} group={g} />
          ))}
        </div>
      )
    case 'deciding':
      return (
        <Muted>
          <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
          deciding…
        </Muted>
      )
    case 'done':
      if (phase.skipped)
        return (
          <Muted>
            The pages stay staged{phase.expiresAt ? ` until ${day(phase.expiresAt)}` : ''}, then expire; the vault's inbox lists them until
            then.
          </Muted>
        )
      return phase.failed.length > 0 ? (
        <div className="flex flex-col gap-1.5 text-sm">
          <div className="text-destructive">
            {phase.failed.length === 1 ? '1 page was not decided and stays' : `${phase.failed.length} pages were not decided and stay`}
            {phase.expiresAt ? ` staged until ${day(phase.expiresAt)}` : ' staged'}:
          </div>
          <ul className="flex flex-col gap-0.5 text-xs">
            {phase.failed.map((f) => (
              <li key={f.key} data-failed={f.key}>
                <code className="font-mono">{f.key}</code> <span className="text-muted-foreground">{f.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Muted>mnemo reaches the kept pages from your next prompt on.</Muted>
      )
    case 'declined':
      return <Muted>Nothing was read. ⌘K → “Review what mnemo learned” asks again whenever you want.</Muted>
    case 'nothing':
      return <Muted>No session left to read in {project}, and nothing learned from your history is waiting.</Muted>
    case 'no-repo':
      return <Muted>Open a repo first: mnemo learns from the Claude Code sessions of one project at a time.</Muted>
    case 'error':
      return (
        <pre className="max-h-40 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {phase.message}
        </pre>
      )
  }
}

/** The line under the title, per phase. */
function lead(phase: Phase, pages: LearnedPage[]): string {
  switch (phase.kind) {
    case 'consent':
      return 'Learn from your Claude Code history, once.'
    case 'running':
      return 'Reading your history.'
    case 'review':
      return `mnemo learned ${plural(pages.length, 'page')} from your history. Everything starts kept: uncheck what is wrong or was only true for a while.`
    case 'done':
      return phase.skipped ? 'Nothing decided.' : `Kept ${phase.kept.length}, dropped ${phase.dropped.length}.`
    case 'nothing':
      return 'Nothing to review.'
    case 'error':
      return 'The review could not go on.'
    default:
      return 'From your Claude Code history, decided once.'
  }
}

export function LearnedStep({ onBack, onClose }: { onBack(): void; onClose(): void }) {
  const phase = useLearned((s) => s.phase)
  const target = useLearned((s) => s.target)
  const pages = useLearned((s) => s.pages)
  const checked = useLearned((s) => s.checked)
  const project = target?.project ?? 'this repo'
  const kept = pages.filter((p) => checked[p.key]).length
  const expires = firstExpiry(pages)
  const l = learned.getState()
  return (
    <>
      <DialogHeader>
        <DialogTitle>What mnemo learned</DialogTitle>
        <DialogDescription>{lead(phase, pages)}</DialogDescription>
      </DialogHeader>
      <Body phase={phase} project={project} />
      <DialogFooter className="sm:items-center">
        {(phase.kind === 'consent' || settled(phase)) && (
          <Button variant="ghost" className="sm:mr-auto" onClick={onBack}>
            Back
          </Button>
        )}
        {phase.kind === 'consent' && (
          <>
            <Button variant="outline" onClick={() => void l.notNow()}>
              Not now
            </Button>
            <Button onClick={() => void l.consent()}>Read my history</Button>
          </>
        )}
        {phase.kind === 'review' && (
          <>
            <span className="mr-auto text-xs text-muted-foreground">
              {pages.length - kept} unchecked {pages.length - kept === 1 ? 'is' : 'are'} dropped
              {expires && <>; undecided pages expire on {day(expires)}</>}
            </span>
            <Button variant="outline" onClick={() => void l.later()}>
              Decide later
            </Button>
            <Button onClick={() => void l.keep()}>Keep selected ({kept})</Button>
          </>
        )}
        {phase.kind === 'error' && target && (
          <Button variant="outline" onClick={() => void l.open(target)}>
            Try again
          </Button>
        )}
        {phase.kind !== 'consent' && phase.kind !== 'review' && (
          <Button variant={phase.kind === 'running' ? 'outline' : 'default'} disabled={phase.kind === 'deciding'} onClick={onClose}>
            {phase.kind === 'running' || phase.kind === 'checking' || phase.kind === 'idle' ? 'Close' : 'Done'}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

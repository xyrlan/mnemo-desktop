/** Setup (round 19): the four programs the app runs, found or missing, and a click that
 *  installs each missing one. mnemo installs inside the app; git, gh and Claude Code install
 *  in a terminal tab through this OS's own route. Since the Orca redesign it is onboarding's
 *  first step (`src/onboarding/`), which opens by itself at launch when `claude` or `mnemo` is
 *  missing; the pane stays for a workspace saved with it open. */
import { useEffect, type ReactNode } from 'react'
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { Badge, Button } from '@/ui'
import { cn } from '@/ui/cn'
import { store, useApp } from '../layout/app-store'
import { leaves } from '../layout/tree'
import { registerPaneView, type PaneViewProps } from '../panes/registry'
import { register } from '../actions/registry'
import { ghInstall, installGh } from '../github/actions'
import { setup, useSetup } from './app-store'
import { onboarding } from '../onboarding/app-store'
import { afterRestore, openIfMissing } from './launch'
import type { Run } from './store'
import { currentOs, ESSENTIAL, installRoute, TOOLS, WHAT, needsSetup, type Route, type ToolName, type ToolStatus } from './tools'

const inTab = (command: string) => void store.getState().openCommandTab(undefined, command)

function RunOutput({ run, head }: { run: Run; head: string }) {
  if (!run.running && !run.lines.length && !run.ok && !run.error) return null
  return (
    <div className="su-output mt-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-xs">
      <div className={cn('su-output-head font-medium', run.error ? 'text-destructive' : run.ok ? 'text-state-done' : 'text-muted-foreground')}>
        {run.error ? `${head} failed` : (run.ok ?? `${head}…`)}
      </div>
      {run.lines.length > 0 && (
        <pre className="mt-1 max-h-60 overflow-y-auto font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{run.lines.join('\n')}</pre>
      )}
      {run.error && <pre className="su-error mt-1 font-mono text-[11px] break-words whitespace-pre-wrap text-destructive">{run.error}</pre>}
    </div>
  )
}

/** Stays under mnemo's row after the install, so its lines and its error outlive the button. */
function MnemoRun() {
  return <RunOutput run={useSetup((s) => s.mnemo)} head="installing mnemo" />
}

/** The button a missing tool gets, with what it does beside it. */
function ActionRow({ button, hint }: { button: ReactNode; hint: ReactNode }) {
  return (
    <div className="su-action mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {button}
      <span className="su-hint min-w-0 text-[11px] text-muted-foreground">{hint}</span>
    </div>
  )
}

/** A missing tool installed in a terminal tab: the command it types is said beside the button. */
function Terminal({ label, route, onClick, after }: { label: string; route: Route; onClick: () => void; after?: string }) {
  return (
    <ActionRow
      button={
        <Button variant="outline" size="xs" onClick={onClick} title={`opens a terminal with ${route.shows}`}>
          {label}
        </Button>
      }
      hint={
        <>
          opens a terminal with <code className="font-mono break-all text-foreground/80">{route.shows}</code>
          {after && `, ${after}`}
        </>
      }
    />
  )
}

function Action({ name }: { name: ToolName }) {
  const mnemo = useSetup((s) => s.mnemo)
  const os = currentOs()
  switch (name) {
    case 'mnemo':
      return (
        <ActionRow
          button={
            <Button size="xs" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
              {mnemo.running && <Loader2 className="animate-spin" />}
              {mnemo.running ? 'installing…' : 'Install mnemo'}
            </Button>
          }
          hint="downloads the latest release into the app's own folder, checks it, then runs mnemo init"
        />
      )
    case 'claude': {
      const route = installRoute('claude', os)
      return <Terminal label="Install Claude Code" route={route} onClick={() => inTab(route.command)} after="then starts claude there to log in" />
    }
    case 'git': {
      const route = installRoute('git', os)
      return <Terminal label="Install git" route={route} onClick={() => inTab(route.command)} />
    }
    case 'gh':
      return <Terminal label="Install gh" route={ghInstall()} onClick={installGh} />
  }
}

/** Found; missing and needed; missing and optional — as onboarding's setup step marks them. */
function Mark({ found, essential }: { found: boolean; essential: boolean }) {
  if (found) return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-state-done" aria-hidden />
  if (essential) return <XCircle className="mt-0.5 size-4 shrink-0 text-state-needs-you" aria-hidden />
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function Tool({ name, row }: { name: ToolName; row: ToolStatus | undefined }) {
  const path = row?.path ?? null
  return (
    <li className={cn('su-tool flex min-w-0 items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5', path ? 'su-found' : 'su-missing')} data-tool={name}>
      <Mark found={!!path} essential={ESSENTIAL.includes(name)} />
      <div className="min-w-0 flex-1">
        <div className="su-tool-head flex min-w-0 items-center gap-2">
          <span className="su-name text-sm font-medium">{name}</span>
          <span className={cn('su-state text-xs', path ? 'text-state-done' : 'text-muted-foreground')}>{path ? 'found' : 'missing'}</span>
          {row?.managed && (
            <Badge variant="secondary" className="su-badge">
              managed by the app
            </Badge>
          )}
          {row?.version && <span className="su-version min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{row.version}</span>}
        </div>
        <div className="su-what text-xs text-muted-foreground">{WHAT[name]}</div>
        {path && (
          <div className="su-path truncate font-mono text-[11px] text-muted-foreground/80" title={path}>
            {path}
          </div>
        )}
        {!path && <Action name={name} />}
        {name === 'mnemo' && <MnemoRun />}
      </div>
    </li>
  )
}

function SetupPane({ id }: PaneViewProps) {
  const rows = useSetup((s) => s.rows)
  const checking = useSetup((s) => s.checking)
  const statusError = useSetup((s) => s.statusError)
  const path = useSetup((s) => s.path)
  // Checks again whenever this pane comes into view: back from the tab an installer ran in,
  // the list is already current.
  const shown = useApp((s) => !!s.tabs.find((t) => t.id === s.activeTab && leaves(t.root).includes(id)))
  useEffect(() => {
    if (shown && !setup.getState().checking) void setup.getState().check()
  }, [shown])

  return (
    <div className="pane-body setup overflow-auto px-4 py-3 text-foreground">
      <div className="flex max-w-3xl flex-col gap-3">
        <header className="su-head flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="su-title text-sm font-medium">Setup</div>
            <div className="su-sub truncate text-xs text-muted-foreground">what the app runs, and where it found it</div>
          </div>
          <Button variant="outline" size="xs" disabled={checking} onClick={() => void setup.getState().check()}>
            {checking && <Loader2 className="animate-spin" />}
            {checking ? 'checking…' : 'Check again'}
          </Button>
        </header>
        {statusError && (
          <pre className="su-error su-status-error rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-xs break-words whitespace-pre-wrap text-destructive">
            could not check the tools: {statusError}
          </pre>
        )}
        {!rows && !statusError && <div className="su-empty text-xs text-muted-foreground">checking…</div>}
        {rows && (
          <>
            <div className={cn('su-summary text-xs', needsSetup(rows) ? 'su-summary-missing text-state-needs-you' : 'text-muted-foreground')}>
              {needsSetup(rows)
                ? 'claude and mnemo are both needed. Install what is missing, one click each.'
                : TOOLS.every((n) => rows.find((r) => r.name === n)?.path)
                  ? 'Everything is in place.'
                  : 'claude and mnemo are in place.'}
            </div>
            <ul className="su-tools flex flex-col gap-2">
              {TOOLS.map((n) => (
                <Tool key={n} name={n} row={rows.find((r) => r.name === n)} />
              ))}
            </ul>
          </>
        )}
        <section className="su-path-section flex flex-col gap-1.5 border-t border-border pt-3">
          <div className="su-what text-xs text-muted-foreground">
            The app finds what it installed by itself. Terminals outside it do not, until the app's tool folders are on your own PATH.
          </div>
          <div className="su-action flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Button variant="outline" size="xs" disabled={path.running} onClick={() => void setup.getState().addToPath()}>
              {path.running ? 'adding…' : 'Add to PATH'}
            </Button>
            {path.ok && <span className="su-ok text-xs text-state-done">{path.ok}</span>}
            {path.error && <span className="su-error text-xs text-destructive">{path.error}</span>}
          </div>
        </section>
      </div>
    </div>
  )
}

registerPaneView('setup', SetupPane)

register({ id: 'setup.open', title: 'Setup: install git, claude, mnemo and gh', run: () => onboarding.getState().show('setup') })

// Once per app run, not once per hot reload: the first launch with `claude` or `mnemo` missing
// opens onboarding at setup instead of leaving the user on a Home that cannot do anything.
const hot = import.meta.hot?.data as { setupChecked?: boolean } | undefined
if (!hot?.setupChecked) {
  if (hot) hot.setupChecked = true
  void openIfMissing({
    restored: afterRestore(store),
    check: () => setup.getState().check(),
    open: () => onboarding.getState().show('setup'),
  })
}

/** Onboarding's first step: the four programs the app runs (`src/setup/`), found or missing,
 *  with a click that installs each missing one. mnemo installs here; git, gh and Claude Code
 *  install in a terminal tab, and the dialog steps aside until the user leaves it. */
import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { Badge, Button, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/ui'
import { cn } from '@/ui/cn'
import { store } from '../layout/app-store'
import { ghInstall } from '../github/actions'
import { setup, useSetup } from '../setup/app-store'
import type { Run } from '../setup/store'
import { ESSENTIAL, TOOLS, WHAT, currentOs, installRoute, needsSetup, type Route, type ToolName, type ToolStatus } from '../setup/tools'
import { onboarding } from './app-store'

/** Opens `route` in a terminal tab, with the dialog out of the way until the user leaves it. */
const inTab = (route: Route) =>
  void onboarding.getState().stepAside({
    open: () => store.getState().openCommandTab(undefined, route.command),
    activeTab: () => store.getState().activeTab,
    subscribe: (fn) => store.subscribe(fn),
  })

function route(name: Exclude<ToolName, 'mnemo'>): Route {
  return name === 'gh' ? ghInstall() : installRoute(name, currentOs())
}

/** What a missing tool's button says. */
const LABEL: Record<ToolName, string> = { git: 'Install git', claude: 'Install Claude Code', mnemo: 'Install mnemo', gh: 'Install gh' }

function Output({ run }: { run: Run }) {
  if (!run.running && !run.lines.length && !run.ok && !run.error) return null
  return (
    <div className="mt-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-xs" data-run>
      <div className={cn('font-medium', run.error ? 'text-destructive' : run.ok ? 'text-state-done' : 'text-muted-foreground')}>
        {run.error ? 'installing mnemo failed' : (run.ok ?? 'installing mnemo…')}
      </div>
      {run.lines.length > 0 && (
        <pre className="mt-1 max-h-24 overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {run.lines.join('\n')}
        </pre>
      )}
      {run.error && <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap text-destructive">{run.error}</pre>}
    </div>
  )
}

function Mark({ found, essential }: { found: boolean; essential: boolean }) {
  if (found) return <CheckCircle2 className="mt-0.5 size-4 text-state-done" aria-label="found" />
  if (essential) return <XCircle className="mt-0.5 size-4 text-state-needs-you" aria-label="missing" />
  return <CircleDashed className="mt-0.5 size-4 text-muted-foreground" aria-label="missing" />
}

function Tool({ name, row }: { name: ToolName; row: ToolStatus | undefined }) {
  const mnemo = useSetup((s) => s.mnemo)
  const path = row?.path ?? null
  const essential = ESSENTIAL.includes(name)
  const r = name === 'mnemo' ? null : route(name)
  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5"
      data-tool={name}
      data-found={path ? '' : undefined}
    >
      <Mark found={!!path} essential={essential} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          {!path && (essential ? <Badge variant="outline">needed</Badge> : <Badge variant="outline">optional</Badge>)}
          {row?.managed && <Badge variant="secondary">managed by the app</Badge>}
          {row?.version && <span className="truncate text-xs text-muted-foreground">{row.version}</span>}
        </div>
        <div className="text-xs text-muted-foreground">{WHAT[name]}</div>
        {path && (
          <div className="truncate font-mono text-[11px] text-muted-foreground/80" title={path}>
            {path}
          </div>
        )}
        {!path && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            {r ? (
              <>
                opens a terminal with <code className="font-mono text-foreground/80">{r.shows}</code>
                {name === 'claude' && ', then starts claude there to log in'}
              </>
            ) : (
              "downloads the latest release into the app's own folder, checks it, then runs mnemo init"
            )}
          </div>
        )}
        {name === 'mnemo' && <Output run={mnemo} />}
      </div>
      {!path &&
        (r ? (
          <Button size="sm" variant="outline" onClick={() => inTab(r)}>
            {LABEL[name]}
          </Button>
        ) : (
          <Button size="sm" disabled={mnemo.running} onClick={() => void setup.getState().installMnemo()}>
            {mnemo.running && <Loader2 className="animate-spin" />}
            {mnemo.running ? 'Installing…' : LABEL[name]}
          </Button>
        ))}
    </li>
  )
}

function summary(rows: ToolStatus[] | null, statusError: string | null) {
  if (statusError) return 'The tools could not be checked.'
  if (!rows) return 'Looking for the programs the app runs…'
  if (needsSetup(rows)) return 'Claude Code and mnemo are both needed. Install what is missing, one click each.'
  if (TOOLS.every((n) => rows.find((r) => r.name === n)?.path)) return 'Everything is in place.'
  return 'Claude Code and mnemo are in place. The rest is optional.'
}

export function SetupStep({ onContinue }: { onContinue(): void }) {
  const rows = useSetup((s) => s.rows)
  const checking = useSetup((s) => s.checking)
  const statusError = useSetup((s) => s.statusError)
  const path = useSetup((s) => s.path)
  const ready = !!rows && !needsSetup(rows)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up mnemo</DialogTitle>
        <DialogDescription>{summary(rows, statusError)}</DialogDescription>
      </DialogHeader>
      {statusError && (
        <pre className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {statusError}
        </pre>
      )}
      {rows && (
        <ul className="flex flex-col gap-2">
          {TOOLS.map((n) => (
            <Tool key={n} name={n} row={rows.find((r) => r.name === n)} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">
          {path.ok ? (
            <span className="text-state-done">{path.ok}</span>
          ) : path.error ? (
            <span className="text-destructive">{path.error}</span>
          ) : (
            'Terminals outside the app find what it installed once its folders are on your PATH.'
          )}
        </span>
        <Button size="xs" variant="ghost" disabled={path.running} onClick={() => void setup.getState().addToPath()}>
          {path.running ? 'Adding…' : 'Add to PATH'}
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={checking} onClick={() => void setup.getState().check()}>
          {checking && <Loader2 className="animate-spin" />}
          {checking ? 'Checking…' : 'Check again'}
        </Button>
        <Button disabled={!ready} onClick={onContinue}>
          Continue
        </Button>
      </DialogFooter>
    </>
  )
}

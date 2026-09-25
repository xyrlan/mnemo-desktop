// adapted from stablyai/orca src/renderer/src/components/pull-request-page/page/header.tsx,
// page/tabs-shell.tsx, conversation/tab.tsx (the right panel) and checks/row.tsx (MIT, 122b8c25)
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ArrowLeft, Bot, ChevronLeft, CircleCheck, CircleX, ExternalLink, FileText, Globe, ListChecks, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button, Tabs, TabsList, TabsTrigger } from '@/ui'
import { cn } from '@/ui/cn'
import { makeBrowserClient, pageBounds, sameBounds, type Bounds } from '../browser/client'
import { makeWebviews } from '../browser/lifecycle'
import { useArm } from '../cockpit/actions'
import { store as layout, useApp } from '../layout/app-store'
import { repoColor } from '../sidebar/model'
import { homeStore, useHome } from './app-store'
import { prView, relTime, stopCmd, takeOver, type HomeRepo, type HomeSession, type OpenedPr } from './types'
import { useReview, type ReviewState } from './review/client'
import DiffView, { FileList, type Focus } from './review/DiffView'
import Merge, { StatePill } from './review/Merge'

/** The PR view's one webview. Layout panes are positive ids and its synthetic view ids start
 *  at -1 and count down (`src/layout/store.ts`), so this sits far below anything that counter
 *  could reach: the two id spaces share the browser client and must never collide. */
export const PR_WEBVIEW = -1_000_000

/** Home's own browser client, built like the browser pane's (`src/browser/view.tsx`). The
 *  per-id command queue inside it is keyed by webview, and `PR_WEBVIEW` is ours alone. */
const browser = makeBrowserClient(invoke, <T,>(event: string, cb: (payload: T) => void) => listen<T>(event, (e) => cb(e.payload)))
const webviews = makeWebviews(browser)

/** The lens's checks word, with Orca's check icon and tone (`CHECK_ICON` / `CHECK_COLOR`). */
const CHECK: Record<string, { icon: typeof CircleCheck; label: string; tone: string; spin?: boolean }> = {
  pass: { icon: CircleCheck, label: 'checks pass', tone: 'text-status-success' },
  fail: { icon: CircleX, label: 'checks fail', tone: 'text-destructive' },
  pending: { icon: LoaderCircle, label: 'checks running', tone: 'text-status-warning', spin: true },
}
const LIVE: Record<string, string> = { here: 'running here', bg: 'running in the background', elsewhere: 'running in another terminal' }

/** One card of the right panel (Orca's `aside` cards beside a PR's conversation). */
function Card({ icon: Icon, title, className, children }: { icon: typeof Bot; title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-lg border border-border/50 bg-card p-3 shadow-xs', className)}>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="text-[13px] font-medium text-foreground">{title}</span>
      </div>
      {children}
    </section>
  )
}

/** The dispatch child that opened the PR, with what can still be done to it. A live child can
 *  be taken over and stopped; a finished one only resumed, and neither is a control when
 *  `whatClickDoes` has nothing to offer. */
function Child({ repo, child, pr }: { repo: HomeRepo; child: HomeSession; pr: number }) {
  const panes = useApp((s) => s.panes)
  const { armed, fire } = useArm()
  const act = takeOver(child, panes)
  const stopKey = `stop:${pr}`
  return (
    <Card icon={Bot} title="Opened by" className="hm-pr-child">
      <div className="hm-pr-kid flex min-w-0 flex-col gap-1">
        <span className="hm-session-title truncate text-[13px] text-foreground">{child.title || child.id.slice(0, 8)}</span>
        <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', child.live ? 'animate-pulse bg-state-working' : 'bg-state-done')} />
            <span className={`hm-live hm-live-${child.live ?? 'done'}`}>{child.live ? LIVE[child.live] : 'finished'}</span>
          </span>
          <span className="hm-session-meta">{relTime(child.last_at)}</span>
        </span>
      </div>
      <div className="hm-pr-acts mt-3 flex flex-wrap gap-2">
        {act.why ? (
          <span className="hm-pr-why text-[11px] text-muted-foreground">{act.why}</span>
        ) : (
          <Button type="button" size="sm" className="flex-1" onClick={() => homeStore.getState().openSession(repo, child)}>
            {act.label}
          </Button>
        )}
        {/* Only a live child can be stopped, and only after a second click. */}
        {child.live && (
          <Button
            type="button"
            size="sm"
            variant={armed === stopKey ? 'destructive' : 'outline'}
            className="hm-pr-stop"
            title={stopCmd(child)}
            onClick={() => fire(stopKey) && homeStore.getState().stopChild(repo, child)}
          >
            {armed === stopKey ? 'really stop?' : 'Stop'}
          </Button>
        )}
      </div>
    </Card>
  )
}

/** github.com in the one webview, drawn over its placeholder. It lives as long as the PR view
 *  does and loads behind the diff at zero size, so the GitHub tab shows a page already there;
 *  `shown` only sizes it. */
function GithubPage({ url, shown }: { url: string; shown: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const page = useRef<HTMLDivElement>(null)
  // Read every frame, so a tab switch resizes the webview without recreating it.
  const visible = useRef(shown)
  visible.current = shown

  // The page is a native child webview drawn over `.hm-pr-page`, outside the DOM: it follows
  // that element every frame and goes when this view does, so a lens back on its stream — or
  // left on another tab, which unmounts Home — holds no webview.
  useEffect(() => {
    const el = page.current!
    let alive = true
    const measure = () => pageBounds(el.getBoundingClientRect(), visible.current && !layout.getState().paletteOpen)
    let last: Bounds = measure()
    // A close and a different PR opened inside the grace period reuse the live webview,
    // which `acquire` leaves on the old page.
    const was = webviews.url(PR_WEBVIEW)
    webviews.acquire(PR_WEBVIEW, url, last).then(
      () => alive && setError(null),
      (e) => alive && setError(String(e)),
    )
    if (was !== undefined && was !== url) {
      webviews.remember(PR_WEBVIEW, url)
      browser.navigate(PR_WEBVIEW, url).catch((e) => alive && setError(String(e)))
    }
    let frame = requestAnimationFrame(function follow() {
      const next = measure()
      if (!sameBounds(last, next)) {
        last = next
        browser.setBounds(PR_WEBVIEW, next).catch(() => {})
      }
      frame = requestAnimationFrame(follow)
    })
    return () => {
      alive = false
      cancelAnimationFrame(frame)
      webviews.release(PR_WEBVIEW)
    }
  }, [url])

  return (
    <div ref={page} className="hm-pr-page relative min-h-0 flex-1 bg-card" hidden={!shown}>
      {error && <div className="hm-pr-error absolute inset-0 flex items-center justify-center p-5 text-center text-[13px] text-destructive">{error}</div>}
    </div>
  )
}

/** The native reading's column: the diff once `gh` answered, what it said when it did not. */
function Reading({ state, focus, reload, onGithub }: { state: ReviewState; focus: Focus | null; reload: () => void; onGithub: () => void }) {
  if (state.status === 'loading')
    return (
      <div className="rv-wait flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        reading the diff…
      </div>
    )
  if (state.status === 'error')
    return (
      <div className="rv-wait flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <div className="rv-error max-w-lg text-[12px] break-words text-destructive">{state.error}</div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={reload}>
            <RefreshCw className="size-3.5" />
            Try again
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onGithub}>
            <ExternalLink className="size-3.5" />
            Read it on GitHub
          </Button>
        </div>
      </div>
    )
  return <DiffView review={state.review} focus={focus} onGithub={onGithub} />
}

type Mode = 'diff' | 'github'

/** A branch name as Orca's header draws it: a mono chip. */
const Ref = ({ children }: { children: string }) => (
  <span className="truncate rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[12px] text-foreground">{children}</span>
)

/** The PR pushed over the stream: Orca's PR page. The header says what the PR is; the change is
 *  read natively by default, or on github.com in a webview; the right panel holds the merge,
 *  the checks, the child that opened it and the files. */
export default function PrPane({ opened }: { opened: OpenedPr }) {
  const snapshot = useHome((s) => s.snapshot)
  const { repo, pr, child } = prView(snapshot, opened)
  const root = repo?.root ?? opened.repo
  const { state, reload } = useReview(root, pr.number)
  const [mode, setMode] = useState<Mode>('diff')
  const [focus, setFocus] = useState<Focus | null>(null)
  const close = () => homeStore.getState().closePr()
  const pick = (path: string) => {
    setMode('diff')
    setFocus((f) => ({ path, n: (f?.n ?? 0) + 1 }))
  }

  // ⌘← pops back to the stream, the breadcrumb's shortcut. Unbound elsewhere: the layout's
  // arrow bindings all carry alt (`src/actions/keys.ts`).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const check = CHECK[pr.checks]
  const files = state.status === 'ready' ? state.review.files : []
  const review = state.status === 'ready' ? state.review : null
  return (
    // `data-ui`: new UI inside the old views' root (`src/theme.css`), beside Tasks' own. `z-30`:
    // over Tasks' sticky repo headers (`z-10`), under drawers and dialogs (`z-drawer`, 40).
    <div data-ui className="hm-pr-view absolute inset-0 z-30 flex flex-col overflow-hidden bg-background text-foreground">
      {/* Row 1: the breadcrumb strip. */}
      <header className="hm-pr-crumbs flex flex-none items-center gap-2 border-b border-border/60 bg-muted/30 px-6 py-2 text-[13px] text-muted-foreground">
        <Button type="button" variant="ghost" size="sm" className="hm-pr-back -ml-2 h-7 gap-1.5 px-2 text-muted-foreground hover:text-foreground" title="back to the stream (⌘←)" onClick={close}>
          <ChevronLeft className="size-4" />
          <span aria-hidden="true" className="size-2 shrink-0 rounded-[3px]" style={{ background: repoColor(opened.repo) }} />
          {repo?.name ?? opened.repo.split('/').pop()}
        </Button>
        <span className="text-muted-foreground/40">·</span>
        <span className="hm-pr-crumb font-mono">PR #{pr.number}</span>
      </header>

      {/* Row 2: the title block — title and number, then its state and base ← head. */}
      <div className="flex-none border-b border-border/60 px-6 py-4">
        <h1 className="hm-pr-title m-0 min-w-0 text-[22px] leading-snug font-medium text-foreground">
          <span className="break-words">{pr.title}</span>
          <span className="hm-num ml-2 align-baseline text-[17px] font-normal text-muted-foreground/70">#{pr.number}</span>
        </h1>
        <div className="hm-pr-head mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[13px] text-muted-foreground">
          <StatePill state={pr.state} />
          {review?.base && (
            <span className="hm-pr-refs flex min-w-0 items-center gap-1.5">
              <Ref>{review.base}</Ref>
              <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground/70" aria-label="←" />
              <Ref>{review.head}</Ref>
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="hm-pr-main min-h-0 min-w-0 flex-1 gap-0">
          <div className="hm-pr-modes flex flex-none items-center border-b border-border/60 pr-3 pl-4">
            <TabsList variant="line" className="justify-start gap-2 bg-transparent">
              <TabsTrigger value="diff" data-mode="diff" className="px-3 py-2.5 text-[13px]">
                <FileText className="size-3.5" />
                Files changed
                {files.length > 0 && <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">{files.length}</span>}
              </TabsTrigger>
              <TabsTrigger value="github" data-mode="github" className="px-3 py-2.5 text-[13px]">
                <Globe className="size-3.5" />
                GitHub
              </TabsTrigger>
            </TabsList>
            {mode === 'diff' && state.status !== 'loading' && (
              <Button type="button" variant="ghost" size="icon-xs" className="hm-pr-reload ml-auto text-muted-foreground hover:text-foreground" title="read the PR again" aria-label="read the PR again" onClick={reload}>
                <RefreshCw />
              </Button>
            )}
          </div>
          <GithubPage url={pr.url} shown={mode === 'github'} />
          {mode === 'diff' && <Reading state={state} focus={focus} reload={reload} onGithub={() => setMode('github')} />}
        </Tabs>

        <aside className="hm-pr-side flex w-[300px] flex-none flex-col gap-4 overflow-auto border-l border-border/60 p-4 scrollbar-sleek">
          <Merge root={root} pr={pr} review={state} />
          {check && (
            <Card icon={ListChecks} title="Checks" className="hm-pr-checks">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <check.icon className={cn('hm-checks size-3.5 shrink-0', check.tone, check.spin && 'animate-spin')} data-checks={pr.checks} />
                {check.label}
              </div>
            </Card>
          )}
          {repo && child ? (
            <Child repo={repo} child={child} pr={pr.number} />
          ) : (
            // `child: null` is ordinary — a PR a human opened. No child section at all, rather
            // than an empty slot where the actions were.
            pr.child && (
              <Card icon={Bot} title="Opened by" className="hm-pr-child">
                <div className="hm-pr-kid text-[12px] text-muted-foreground">child {pr.child}, not in this snapshot</div>
              </Card>
            )
          )}
          {files.length > 0 && (
            <Card icon={FileText} title="Files" className="hm-pr-files px-1.5 pb-1.5 [&>div:first-child]:px-1.5">
              <FileList files={files} onPick={pick} />
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { makeBrowserClient, pageBounds, sameBounds, type Bounds } from '../browser/client'
import { makeWebviews } from '../browser/lifecycle'
import { useArm } from '../cockpit/actions'
import { store as layout, useApp } from '../layout/app-store'
import { homeStore, useHome } from './app-store'
import { prView, relTime, stopCmd, takeOver, type HomeRepo, type HomeSession, type OpenedPr } from './types'
import { repoAccent } from './repo-color'
import { useReview, type ReviewState } from './review/client'
import DiffView, { FileList, type Focus } from './review/DiffView'
import Merge from './review/Merge'

/** The PR view's one webview. Layout panes are positive ids and its synthetic view ids start
 *  at -1 and count down (`src/layout/store.ts`), so this sits far below anything that counter
 *  could reach: the two id spaces share the browser client and must never collide. */
export const PR_WEBVIEW = -1_000_000

/** Home's own browser client, built like the browser pane's (`src/browser/view.tsx`). The
 *  per-id command queue inside it is keyed by webview, and `PR_WEBVIEW` is ours alone. */
const browser = makeBrowserClient(invoke, <T,>(event: string, cb: (payload: T) => void) => listen<T>(event, (e) => cb(e.payload)))
const webviews = makeWebviews(browser)

const CHECK: Record<string, [string, string]> = {
  pass: ['✓', 'checks pass'],
  fail: ['✗', 'checks fail'],
  pending: ['●', 'checks running'],
}
const LIVE: Record<string, string> = { here: 'running here', bg: 'running in the background', elsewhere: 'running in another terminal' }

/** The dispatch child that opened the PR, with what can still be done to it. A live child can
 *  be taken over and stopped; a finished one only resumed, and neither is a control when
 *  `whatClickDoes` has nothing to offer. */
function Child({ repo, child, pr }: { repo: HomeRepo; child: HomeSession; pr: number }) {
  const panes = useApp((s) => s.panes)
  const { armed, fire } = useArm()
  const act = takeOver(child, panes)
  const stopKey = `stop:${pr}`
  return (
    <section className="hm-pr-child">
      <div className="hm-section-label">Opened by</div>
      <div className="hm-pr-kid">
        <span className="hm-session-title">{child.title || child.id.slice(0, 8)}</span>
        <span className={`hm-live hm-live-${child.live ?? 'done'}`}>{child.live ? LIVE[child.live] : 'finished'}</span>
        <span className="hm-session-meta">{relTime(child.last_at)}</span>
      </div>
      <div className="hm-pr-acts">
        {act.why ? (
          <span className="hm-muted hm-pr-why">{act.why}</span>
        ) : (
          <button className="hm-btn hm-primary" onClick={() => homeStore.getState().openSession(repo, child)}>
            {act.label}
          </button>
        )}
        {/* Only a live child can be stopped, and only after a second click. */}
        {child.live && (
          <button
            className={`hm-btn${armed === stopKey ? ' hm-armed' : ''}`}
            title={stopCmd(child)}
            onClick={() => fire(stopKey) && homeStore.getState().stopChild(repo, child)}
          >
            {armed === stopKey ? 'really stop?' : 'Stop'}
          </button>
        )}
      </div>
    </section>
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
    <div ref={page} className="hm-pr-page" hidden={!shown}>
      {error && <div className="hm-pr-error">{error}</div>}
    </div>
  )
}

/** The native reading's column: the diff once `gh` answered, what it said when it did not. */
function Reading({ state, focus, reload, onGithub }: { state: ReviewState; focus: Focus | null; reload: () => void; onGithub: () => void }) {
  if (state.status === 'loading') return <div className="rv-wait hm-muted">reading the diff…</div>
  if (state.status === 'error')
    return (
      <div className="rv-wait">
        <div className="rv-error">{state.error}</div>
        <div className="rv-acts">
          <button className="hm-btn" onClick={reload}>
            Try again
          </button>
          <button className="hm-btn" onClick={onGithub}>
            Read it on GitHub
          </button>
        </div>
      </div>
    )
  return <DiffView review={state.review} focus={focus} onGithub={onGithub} />
}

type Mode = 'diff' | 'github'

/** The PR pushed over the stream: what the lens knows on the left, the change on the right —
 *  read natively by default, or on github.com in a webview. */
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
  return (
    <div className="hm-pr-view" style={{ '--repo': repoAccent(opened.repo) } as CSSProperties}>
      <header className="hm-pr-crumbs">
        <button className="hm-link hm-pr-back" title="back to the stream (⌘←)" onClick={close}>
          ‹ {repo?.name ?? opened.repo.split('/').pop()}
        </button>
        <span className="hm-pr-sep">/</span>
        <span className="hm-pr-crumb">PR #{pr.number}</span>
      </header>
      <div className="hm-pr-cols">
        <aside className="hm-pr-side">
          <div className="hm-pr-head">
            <span className="hm-num">#{pr.number}</span>
            {check && (
              <span className={`hm-checks hm-checks-${pr.checks}`} title={check[1]}>
                {check[0]}
              </span>
            )}
            {pr.state === 'draft' && <span className="hm-agent">draft</span>}
          </div>
          <h2 className="hm-pr-title">{pr.title}</h2>
          {check && <div className="hm-pr-checks">{check[1]}</div>}
          <Merge root={root} pr={pr} review={state} />
          {repo && child ? (
            <Child repo={repo} child={child} pr={pr.number} />
          ) : (
            // `child: null` is ordinary — a PR a human opened. No child section at all, rather
            // than an empty slot where the actions were.
            pr.child && (
              <section className="hm-pr-child">
                <div className="hm-section-label">Opened by</div>
                <div className="hm-pr-kid hm-muted">child {pr.child}, not in this snapshot</div>
              </section>
            )
          )}
          {files.length > 0 && (
            <section className="hm-pr-files">
              <div className="hm-section-label">Files</div>
              <FileList files={files} onPick={pick} />
            </section>
          )}
        </aside>
        <div className="hm-pr-main">
          <div className="hm-pr-modes" role="tablist">
            <button role="tab" aria-selected={mode === 'diff'} className={`hm-pr-mode${mode === 'diff' ? ' on' : ''}`} onClick={() => setMode('diff')}>
              Diff
            </button>
            <button role="tab" aria-selected={mode === 'github'} className={`hm-pr-mode${mode === 'github' ? ' on' : ''}`} onClick={() => setMode('github')}>
              GitHub
            </button>
            {mode === 'diff' && state.status !== 'loading' && (
              <button className="hm-link hm-pr-reload" title="read the PR again" onClick={reload}>
                ↻
              </button>
            )}
          </div>
          <GithubPage url={pr.url} shown={mode === 'github'} />
          {mode === 'diff' && <Reading state={state} focus={focus} reload={reload} onGithub={() => setMode('github')} />}
        </div>
      </div>
    </div>
  )
}

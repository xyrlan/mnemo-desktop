import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { homeStore, useHome } from './app-store'
import { childSession, firstRows, githubError, isFolded, otherErrors, relTime, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession, type Pr } from './types'
import { repoAccent } from './repo-color'
import PrPane from './pr-pane'
import type { Issue } from '../github/types'
import { openIssue } from '../github/actions'
import { store as layout, useApp } from '../layout/app-store'
import { Wordmark } from '../brand/Wordmark'
import Account from '../github/Account'
import './home.css'

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')
/** Rows a section shows before its "more" line. */
const FIRST = 5
/** Dead parent sessions a group shows before "more"; live ones always show. */
const RECENT_SESSIONS = 3

function Entry() {
  const spec = useHome((s) => s.cloneSpec)
  const h = homeStore.getState()
  return (
    <div className="hm-entry">
      <button className="hm-btn" onClick={() => void h.openFolder()}>
        Open folder…
      </button>
      <form
        className="hm-clone"
        onSubmit={(e) => {
          e.preventDefault()
          void h.clone()
        }}
      >
        <input placeholder="owner/repo or URL" value={spec} onChange={(e) => h.setCloneSpec(e.target.value)} />
        <button className="hm-btn" type="submit" disabled={!spec.trim()}>
          Clone
        </button>
      </form>
    </div>
  )
}

/** The explicit GitHub read; the other one is the lens showing. */
function Refresh() {
  const github = useHome((s) => s.github)
  const at = useHome((s) => s.githubAt)
  return (
    <button
      className="hm-btn hm-refresh"
      disabled={github === 'loading'}
      title={at ? `issues and PRs read ${relTime(at)} ago` : 'issues and PRs not read yet'}
      onClick={() => void homeStore.getState().refreshGithub()}
    >
      {github === 'loading' ? 'reading GitHub…' : '↻ GitHub'}
    </button>
  )
}

/** Plain rows sharing a group's accent; `repo` names the group on hover. */
function RowButton({ repo, className = '', ...p }: { repo: HomeRepo; className?: string; title?: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button className={`hm-row ${className}`} disabled={p.disabled} title={`${repo.name} · ${p.title ?? ''}`} onClick={p.onClick}>
      {p.children}
    </button>
  )
}

const BADGE: Record<string, string> = { here: 'here', bg: 'background', elsewhere: 'in another terminal' }

function SessionRow({ repo, s }: { repo: HomeRepo; s: HomeSession }) {
  const panes = useApp((st) => st.panes)
  const click = whatClickDoes(s, panes)
  return (
    <RowButton
      repo={repo}
      className="hm-session"
      disabled={click.kind === 'nothing'}
      title={click.kind === 'nothing' ? click.why : s.id}
      onClick={() => homeStore.getState().openSession(repo, s)}
    >
      {s.live && <span className={`hm-live hm-live-${s.live}`}>{BADGE[s.live]}</span>}
      <span className="hm-session-title">{s.title || s.id.slice(0, 8)}</span>
      {s.agent && (
        <span className="hm-agent" title="name in claude agents">
          {s.agent}
        </span>
      )}
      <span className="hm-session-meta">
        {s.cwd !== repo.root && <span className="hm-session-cwd">{short(s.cwd)}</span>}
        {relTime(s.last_at)}
      </span>
    </RowButton>
  )
}

function IssueRow({ repo, i }: { repo: HomeRepo; i: Issue }) {
  return (
    <RowButton repo={repo} className="hm-issue" title={i.url} onClick={() => openIssue(i)}>
      <span className="hm-num">#{i.number}</span>
      <span className="hm-session-title">{i.title}</span>
      {i.labels.slice(0, 3).map((l) => (
        <span key={l} className="hm-agent">
          {l}
        </span>
      ))}
    </RowButton>
  )
}

const CHECKS: Record<Pr['checks'], [string, string] | null> = {
  pass: ['✓', 'checks pass'],
  fail: ['✗', 'checks fail'],
  pending: ['●', 'checks running'],
  none: null,
}

function PrRow({ repo, pr }: { repo: HomeRepo; pr: Pr }) {
  const check = CHECKS[pr.checks]
  const kid = pr.child ? childSession(repo, pr.child) : null
  return (
    <div className="hm-row hm-pr" title={`${repo.name} · ${pr.url}`}>
      <button className="hm-pr-open" title="open the PR view" onClick={() => homeStore.getState().openPr(repo.root, pr)}>
        <span className="hm-num">#{pr.number}</span>
        {check && (
          <span className={`hm-checks hm-checks-${pr.checks}`} title={check[1]}>
            {check[0]}
          </span>
        )}
        <span className="hm-session-title">{pr.title}</span>
        {pr.state === 'draft' && <span className="hm-agent">draft</span>}
      </button>
      {pr.child &&
        (kid ? (
          <button className="hm-child" title={`opened by ${kid.title || kid.id}`} onClick={() => homeStore.getState().openSession(repo, kid)}>
            ← child {pr.child}
          </button>
        ) : (
          <span className="hm-child" title={`opened by job ${pr.child}`}>
            ← child {pr.child}
          </span>
        ))}
    </div>
  )
}

/** A labelled list that shows `first(items)` and folds the rest behind one line. */
function Capped<T>({ label, items, first, more, row }: { label: string; items: T[]; first: (all: T[]) => T[]; more: string; row(t: T): ReactNode }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const shown = open ? items : first(items)
  const rest = items.length - first(items).length
  return (
    <div className="hm-section">
      <div className="hm-section-label">
        {label} <span className="hm-count">{items.length}</span>
      </div>
      {shown.map(row)}
      {rest > 0 && (
        <button className="hm-link hm-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'show less' : `${rest} ${more}`}
        </button>
      )}
    </div>
  )
}

function RepoGroup({ r }: { r: HomeRepo }) {
  // Read at click time, not render time: the store's actions are replaceable.
  const h = () => homeStore.getState()
  const selected = useHome((s) => s.selected === r.root)
  const errors = useHome((s) => s.snapshot.errors)
  const ghError = githubError(errors, r.name)
  const live = r.sessions.some((s) => s.live) || r.children.some((s) => s.live)
  const issues = r.issues ?? []
  const prs = r.prs ?? []
  // Acting in a group makes it the repo the rest of the app defaults to (`selected`).
  const act = (f: () => void) => () => {
    if (!r.unresolved) void h().select(r.root)
    f()
  }
  const empty = !r.unresolved && issues.length + prs.length + r.sessions.length + r.children.length === 0
  return (
    <section
      className={`hm-group${selected ? ' hm-selected' : ''}${r.hidden ? ' hm-hidden' : ''}${r.unresolved ? ' hm-unresolved' : ''}`}
      style={{ '--repo': repoAccent(r.root) } as CSSProperties}
      data-root={r.root}
    >
      <header className="hm-group-head" title={r.root}>
        <span className="hm-repo-name">
          {r.pinned ? '★ ' : ''}
          {r.name}
        </span>
        <span className="hm-repo-path">{short(r.root)}</span>
        <span className="hm-repo-when">
          {live && <span className="hm-dot" />}
          {relTime(r.last_at)}
        </span>
        <span className="hm-actions">
          {r.unresolved ? (
            <button className="hm-btn" title="read the repo (macOS may ask for permission)" onClick={() => void h().select(r.root)}>
              Read repo
            </button>
          ) : (
            <>
              <button className="hm-btn hm-primary" onClick={act(() => h().newSession(r.root))}>
                New session
              </button>
              <button className="hm-btn" onClick={act(() => h().shell(r.root))}>
                Shell
              </button>
            </>
          )}
          <button className="hm-btn" onClick={() => void h().togglePin(r.root)}>
            {r.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button className="hm-btn" onClick={() => void h().toggleHidden(r.root)}>
            {r.hidden ? 'Show' : 'Hide'}
          </button>
        </span>
      </header>
      {ghError && <div className="hm-row hm-gh-error">GitHub could not read this repo: {ghError}</div>}
      <Capped label="Issues" items={issues} more="more issues" first={(a) => a.slice(0, FIRST)} row={(i) => <IssueRow key={i.number} repo={r} i={i} />} />
      <Capped label="PRs" items={prs} more="more PRs" first={(a) => a.slice(0, FIRST)} row={(p) => <PrRow key={p.number} repo={r} pr={p} />} />
      <Capped label="Sessions" items={r.sessions} more="older sessions" first={(a) => firstRows(a, RECENT_SESSIONS).rows} row={(s) => <SessionRow key={s.id} repo={r} s={s} />} />
      <Capped label="Dispatch children" items={r.children} more="finished children" first={(a) => firstRows(a, 0).rows} row={(s) => <SessionRow key={s.id} repo={r} s={s} />} />
      {empty && <div className="hm-row hm-muted">No sessions yet.</div>}
    </section>
  )
}

export default function Home() {
  const snap = useHome((s) => s.snapshot)
  const filter = useHome((s) => s.filter)
  const showHidden = useHome((s) => s.showHidden)
  const showProtected = useHome((s) => s.showProtected)
  const notice = useHome((s) => s.notice)
  const opened = useHome((s) => s.openedPr)
  const tabs = useApp((s) => s.tabs)
  const h = homeStore.getState()

  // Home is mounted only while it shows: this is "the lens became visible". Sessions first,
  // since they are local and fast; GitHub after, on the roots that snapshot listed.
  useEffect(() => {
    const st = homeStore.getState()
    void st.load().then(() => st.refreshGithub())
  }, [])

  const repos = visibleRepos(snap.repos, filter, showHidden, showProtected)
  const folded = snap.repos.filter(isFolded).length
  const hiddenCount = snap.repos.filter((r) => r.hidden).length
  const errors = otherErrors(snap.errors)

  if (snap.repos.length === 0) {
    return (
      <div className="hm hm-empty">
        <p>No repos yet. Open a folder or clone one from GitHub.</p>
        <Entry />
        {notice && (
          <div className="hm-notice" onClick={h.dismiss}>
            {notice}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="hm">
      {/* The stream stays mounted under an open PR, so its scroll position is still there
          when the view pops; `inert` keeps the covered rows out of focus and screen readers. */}
      <header className="hm-head" inert={!!opened}>
        <Wordmark />
        {tabs.length > 0 && (
          <button className="hm-btn hm-back" onClick={() => layout.getState().goToTab(0)}>
            ← back
          </button>
        )}
        <input className="hm-filter" placeholder="filter repos…" value={filter} onChange={(e) => h.setFilter(e.target.value)} />
        <Refresh />
        <Entry />
        <Account />
      </header>
      <main className="hm-stream" inert={!!opened}>
        {repos.map((r) => (
          <RepoGroup key={r.root} r={r} />
        ))}
        {repos.length === 0 && filter.trim() && <p className="hm-muted">No repo matches “{filter}”.</p>}
        <div className="hm-folds">
          {folded > 0 && (
            <button className="hm-link hm-protected" onClick={() => h.setShowProtected(!showProtected)} title="folders macOS protects (Downloads, Desktop, Documents, volumes); reading one runs git there">
              {showProtected ? 'hide protected folders' : `${folded} protected folder${folded === 1 ? '' : 's'} · show`}
            </button>
          )}
          {hiddenCount > 0 && (
            <button className="hm-link" onClick={() => h.setShowHidden(!showHidden)}>
              {showHidden ? 'hide hidden repos' : `${hiddenCount} hidden repo${hiddenCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </main>
      {opened && <PrPane opened={opened} />}
      {errors.length > 0 && <div className="hm-errors">{errors.join(' · ')}</div>}
      {notice && (
        <div className="hm-notice" onClick={h.dismiss}>
          {notice}
        </div>
      )}
    </div>
  )
}

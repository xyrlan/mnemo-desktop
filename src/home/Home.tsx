import { useEffect, useState } from 'react'
import { homeStore, useHome } from './app-store'
import { isFolded, relTime, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession } from './types'
import { store as layout, useApp } from '../layout/app-store'
import { Wordmark } from '../brand/Wordmark'
import Account from '../github/Account'
import './home.css'

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

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

function RepoRow({ r, selected }: { r: HomeRepo; selected: boolean }) {
  const live = r.sessions.some((s) => s.live) || r.children.some((s) => s.live)
  return (
    <button
      className={`hm-repo${selected ? ' hm-selected' : ''}${r.hidden ? ' hm-hidden' : ''}${r.unresolved ? ' hm-unresolved' : ''}`}
      onClick={() => void homeStore.getState().select(r.root)}
      title={r.unresolved ? `${r.root}\nclick to read the repo (macOS may ask for permission)` : r.root}
    >
      <span className="hm-repo-name">
        {r.pinned ? '★ ' : ''}
        {r.name}
      </span>
      <span className="hm-repo-path">{short(r.root)}</span>
      <span className="hm-repo-when">
        {live && <span className="hm-dot" />}
        {relTime(r.last_at)}
      </span>
    </button>
  )
}

const BADGE: Record<string, string> = { here: 'here', bg: 'background', elsewhere: 'in another terminal' }

function SessionRow({ repo, s }: { repo: HomeRepo; s: HomeSession }) {
  const panes = useApp((st) => st.panes)
  const click = whatClickDoes(s, panes)
  return (
    <button
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
    </button>
  )
}

/** Background children of dispatches: one collapsed row per repo, rows on click. */
function Children({ repo }: { repo: HomeRepo }) {
  const [open, setOpen] = useState(false)
  const kids = repo.children
  const live = kids.filter((s) => s.live).length
  return (
    <>
      <button className={`hm-session hm-children${open ? ' hm-open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hm-caret">{open ? '▾' : '▸'}</span>
        <span className="hm-session-title">dispatch children ({kids.length})</span>
        <span className="hm-session-meta">
          {live > 0 && (
            <span className="hm-children-live">
              <span className="hm-dot" />
              {live}
            </span>
          )}
          {relTime(kids[0]?.last_at ?? 0)}
        </span>
      </button>
      {open && (
        <div className="hm-children-rows">
          {kids.map((s) => (
            <SessionRow key={s.id} repo={repo} s={s} />
          ))}
        </div>
      )}
    </>
  )
}

export default function Home() {
  const snap = useHome((s) => s.snapshot)
  const selected = useHome((s) => s.selected)
  const filter = useHome((s) => s.filter)
  const showHidden = useHome((s) => s.showHidden)
  const showProtected = useHome((s) => s.showProtected)
  const notice = useHome((s) => s.notice)
  const tabs = useApp((s) => s.tabs)
  const h = homeStore.getState()

  useEffect(() => {
    void homeStore.getState().load()
  }, [])

  const repos = visibleRepos(snap.repos, filter, showHidden, showProtected)
  const folded = snap.repos.filter(isFolded).length
  const repo = snap.repos.find((r) => r.root === selected) ?? null
  const hiddenCount = snap.repos.filter((r) => r.hidden).length

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
      <header className="hm-head">
        <Wordmark />
        {tabs.length > 0 && (
          <button className="hm-btn hm-back" onClick={() => layout.getState().goToTab(0)}>
            ← back
          </button>
        )}
        <Entry />
        <Account />
      </header>
      <div className="hm-body">
        <aside className="hm-left">
          <input className="hm-filter" placeholder="filter…" value={filter} onChange={(e) => h.setFilter(e.target.value)} />
          {repos.map((r) => (
            <RepoRow key={r.root} r={r} selected={r.root === selected} />
          ))}
          {folded > 0 && (
            <button className="hm-link hm-protected" onClick={() => h.setShowProtected(!showProtected)} title="folders macOS protects (Downloads, Desktop, Documents, volumes); selecting one reads the repo">
              {showProtected ? 'hide protected folders' : `${folded} protected folder${folded === 1 ? '' : 's'} · show`}
            </button>
          )}
          {hiddenCount > 0 && (
            <button className="hm-link" onClick={() => h.setShowHidden(!showHidden)}>
              {showHidden ? 'hide hidden repos' : `${hiddenCount} hidden repo${hiddenCount === 1 ? '' : 's'}`}
            </button>
          )}
        </aside>
        <main className="hm-right">
          {repo && (
            <>
              <div className="hm-repo-head">
                <h2>{repo.name}</h2>
                <span className="hm-repo-path">{short(repo.root)}</span>
                <span className="hm-actions">
                  <button className="hm-btn hm-primary" onClick={() => h.newSession(repo.root)}>
                    New session
                  </button>
                  <button className="hm-btn" onClick={() => h.shell(repo.root)}>
                    Shell
                  </button>
                  <button className="hm-btn" onClick={() => void h.togglePin(repo.root)}>
                    {repo.pinned ? 'Unpin' : 'Pin'}
                  </button>
                  <button className="hm-btn" onClick={() => void h.toggleHidden(repo.root)}>
                    {repo.hidden ? 'Show' : 'Hide'}
                  </button>
                </span>
              </div>
              {repo.children.length > 0 && <Children key={repo.root} repo={repo} />}
              {repo.sessions.length === 0 && repo.children.length === 0 ? (
                <p className="hm-muted">No sessions yet.</p>
              ) : (
                repo.sessions.map((s) => <SessionRow key={s.id} repo={repo} s={s} />)
              )}
            </>
          )}
        </main>
      </div>
      {snap.errors.length > 0 && <div className="hm-errors">{snap.errors.join(' · ')}</div>}
      {notice && (
        <div className="hm-notice" onClick={h.dismiss}>
          {notice}
        </div>
      )}
    </div>
  )
}

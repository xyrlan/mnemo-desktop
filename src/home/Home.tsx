import { useEffect } from 'react'
import { homeStore, useHome } from './app-store'
import { relTime, visibleRepos, whatClickDoes, type HomeRepo, type HomeSession } from './types'
import { store as layout, useApp } from '../layout/app-store'
import { Wordmark } from '../brand/Wordmark'
import './home.css'

const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

function Entry() {
  const spec = useHome((s) => s.cloneSpec)
  const h = homeStore.getState()
  return (
    <div className="hm-entry">
      <button className="hm-btn" onClick={() => void h.openFolder()}>
        Abrir pasta…
      </button>
      <form
        className="hm-clone"
        onSubmit={(e) => {
          e.preventDefault()
          void h.clone()
        }}
      >
        <input placeholder="owner/repo ou URL" value={spec} onChange={(e) => h.setCloneSpec(e.target.value)} />
        <button className="hm-btn" type="submit" disabled={!spec.trim()}>
          Clonar
        </button>
      </form>
    </div>
  )
}

function RepoRow({ r, selected }: { r: HomeRepo; selected: boolean }) {
  const live = r.sessions.some((s) => s.live)
  return (
    <button
      className={`hm-repo${selected ? ' hm-selected' : ''}${r.hidden ? ' hm-hidden' : ''}`}
      onClick={() => homeStore.getState().select(r.root)}
      title={r.root}
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

const BADGE: Record<string, string> = { here: 'aqui', bg: 'background', elsewhere: 'em outro terminal' }

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
      <span className="hm-session-meta">
        {s.cwd !== repo.root && <span className="hm-session-cwd">{short(s.cwd)}</span>}
        {relTime(s.last_at)}
      </span>
    </button>
  )
}

export default function Home() {
  const snap = useHome((s) => s.snapshot)
  const selected = useHome((s) => s.selected)
  const filter = useHome((s) => s.filter)
  const showHidden = useHome((s) => s.showHidden)
  const notice = useHome((s) => s.notice)
  const tabs = useApp((s) => s.tabs)
  const h = homeStore.getState()

  useEffect(() => {
    void homeStore.getState().load()
  }, [])

  const repos = visibleRepos(snap.repos, filter, showHidden)
  const repo = snap.repos.find((r) => r.root === selected) ?? null
  const hiddenCount = snap.repos.filter((r) => r.hidden).length

  if (snap.repos.length === 0) {
    return (
      <div className="hm hm-empty">
        <p>Nenhum repositório ainda. Abra uma pasta ou clone um do GitHub.</p>
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
            ← voltar
          </button>
        )}
        <Entry />
      </header>
      <div className="hm-body">
        <aside className="hm-left">
          <input className="hm-filter" placeholder="filtrar…" value={filter} onChange={(e) => h.setFilter(e.target.value)} />
          {repos.map((r) => (
            <RepoRow key={r.root} r={r} selected={r.root === selected} />
          ))}
          {hiddenCount > 0 && (
            <button className="hm-link" onClick={() => h.setShowHidden(!showHidden)}>
              {showHidden ? 'ocultar escondidos' : `${hiddenCount} escondido${hiddenCount > 1 ? 's' : ''}`}
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
                    Nova sessão
                  </button>
                  <button className="hm-btn" onClick={() => h.shell(repo.root)}>
                    Shell
                  </button>
                  <button className="hm-btn" onClick={() => void h.togglePin(repo.root)}>
                    {repo.pinned ? 'Desafixar' : 'Fixar'}
                  </button>
                  <button className="hm-btn" onClick={() => void h.toggleHidden(repo.root)}>
                    {repo.hidden ? 'Mostrar' : 'Esconder'}
                  </button>
                </span>
              </div>
              {repo.sessions.length === 0 ? (
                <p className="hm-muted">Nenhuma sessão ainda.</p>
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

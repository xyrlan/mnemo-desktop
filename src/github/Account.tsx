import { useEffect } from 'react'
import { githubStore, useGithub } from './app-store'
import { ghLogin, installGh } from './actions'
import './github.css'

/** Home's header, right side: install `gh`, log in through it, or who is logged in. */
export default function Account() {
  const auth = useGithub((s) => s.auth)
  useEffect(() => {
    void githubStore.getState().loadAuth()
    const again = () => void githubStore.getState().loadAuth()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [])
  if (!auth) return null
  if (!auth.installed)
    return (
      <span className="gh-account">
        <button className="hm-btn" onClick={installGh} title="abre um terminal com brew install gh">
          instalar gh
        </button>
        <code className="gh-quiet">brew install gh</code>
      </span>
    )
  if (!auth.logged)
    return (
      <span className="gh-account">
        <button className="hm-btn" onClick={ghLogin} title="abre um terminal com gh auth login --web">
          Entrar no GitHub
        </button>
      </span>
    )
  return (
    <span className="gh-account gh-login" title={auth.scopes.length ? `escopos: ${auth.scopes.join(', ')}` : undefined}>
      @{auth.login ?? 'github'}
    </span>
  )
}

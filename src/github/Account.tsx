import { useEffect } from 'react'
import { githubStore, useGithub } from './app-store'
import { ghInstall, ghLogin, installGh } from './actions'
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
  if (!auth.installed) {
    const route = ghInstall()
    return (
      <span className="gh-account">
        <button className="hm-btn" onClick={installGh} title={`opens a terminal with ${route.shows}`}>
          install gh
        </button>
        <code className="gh-quiet">{route.shows}</code>
      </span>
    )
  }
  if (!auth.logged)
    return (
      <span className="gh-account">
        <button className="hm-btn" onClick={ghLogin} title="opens a terminal with gh auth login --web">
          Log in to GitHub
        </button>
      </span>
    )
  return (
    <span className="gh-account gh-login" title={auth.scopes.length ? `scopes: ${auth.scopes.join(', ')}` : undefined}>
      @{auth.login ?? 'github'}
    </span>
  )
}

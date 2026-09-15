import { useEffect, useRef } from 'react'
import { missionStore, useMission } from './app-store'
import { store as appStore, useApp } from '../layout/app-store'
import { settingsStore, useSettings } from '../settings/app-store'
import { pruneSnapshot } from './types'
import { focusedCwd, repoOfCwd, scopeRepos } from './scope'
import { RepoBlock } from './rows'

export { openMissionPane } from './rows'

export default function Sidebar() {
  const open = useMission((s) => s.sidebarOpen)
  const width = useMission((s) => s.sidebarWidth)
  const raw = useMission((s) => s.snapshot)
  const err = useMission((s) => s.lastError)
  const snap = pruneSnapshot(raw)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const tabs = useApp((s) => s.tabs)
  const scope = useSettings((s) => s.sidebarScope)
  const ref = useRef<HTMLDivElement>(null)

  // Poll: 3 s focused, 15 s when the window is hidden. PRs every 10th tick.
  useEffect(() => {
    let tick = 0
    let timer: number | undefined
    const loop = async () => {
      const withPrs = tick % 10 === 0
      tick++
      await missionStore.getState().refresh(focusedCwd(appStore.getState(), missionStore.getState().snapshot), withPrs)
      timer = window.setTimeout(loop, document.hidden ? 15000 : 3000)
    }
    void missionStore.getState().loadLooked()
    void loop()
    return () => window.clearTimeout(timer)
  }, [])

  if (!open) return null
  // Resolve against the unpruned snapshot: a finished child's worktree still names its repo.
  const focused = repoOfCwd(raw, focusedCwd({ tabs, activeTab, panes }, raw))
  const { repos, effective } = scopeRepos(snap, scope, focused?.root)
  const setScope = (v: 'repo' | 'all') => void settingsStore.getState().set('sidebarScope', v)

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => missionStore.getState().setSidebarWidth(window.innerWidth - ev.clientX)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="sidebar" style={{ width }} ref={ref}>
      <div className="sidebar-grip" onMouseDown={onDown} />
      <div className="m-scope">
        <button className={scope === 'repo' ? 'on' : ''} onClick={() => setScope('repo')} title="Only the repo of the focused pane">
          this repo
        </button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title="Every repo with a live session">
          all
        </button>
        <span className="m-scope-hint" title={focused?.root}>
          {scope === 'repo' && effective === 'all' ? 'no repo in focus, showing all' : focused && scope === 'repo' ? focused.name : ''}
        </span>
        <button className="m-scope-open" onClick={() => appStore.getState().openView('cockpit', {}, 'auto', 'cockpit')} title="Open the cockpit pane (every repo, full size)">
          ⤢
        </button>
      </div>
      <div className="sidebar-body">
        {err && <div className="m-error">{err}</div>}
        {snap.errors.map((e, i) => (
          <div key={i} className="m-error">{e}</div>
        ))}
        {repos.length === 0 && !err && (
          <div className="m-empty">{effective === 'repo' && focused ? `nothing recent in ${focused.name}` : 'no live sessions'}</div>
        )}
        {repos.map((r) => (
          <RepoBlock key={r.root} r={r} focused={r.root === focused?.root} />
        ))}
      </div>
    </div>
  )
}

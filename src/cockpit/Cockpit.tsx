import { useMemo } from 'react'
import { useMission } from '../mission/app-store'
import { useApp } from '../layout/app-store'
import { settingsStore, useSettings } from '../settings/app-store'
import { pruneSnapshot } from '../mission/types'
import { focusedCwd, repoOfCwd, scopeRepos } from '../mission/scope'
import { attachChild, openContract, openMissionPane, openPr } from '../mission/rows'
import { Graph } from '../graph'
import { buildGraph } from './model'
import { layoutGrouped } from './layout'
import { needsYou } from './needs'
import NeedsList from './NeedsList'
import './cockpit.css'

/** The missions as a node canvas (repo → parent → children → PR → CI, contracts as groups)
 *  under a needs-you strip. Reads the snapshot the sidebar polls; it never polls itself. */
export default function Cockpit() {
  const raw = useMission((s) => s.snapshot)
  const err = useMission((s) => s.lastError)
  const looked = useMission((s) => s.looked)
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const scope = useSettings((s) => s.sidebarScope)
  // Resolve against the unpruned snapshot: a finished child's worktree still names its repo.
  const focusedRoot = repoOfCwd(raw, focusedCwd({ tabs, activeTab, panes }, raw))?.root

  const { snap, repos, effective, graph, needs } = useMemo(() => {
    const snap = pruneSnapshot(raw)
    const { repos, effective } = scopeRepos(snap, scope, focusedRoot)
    const scoped = { ...snap, repos }
    const g = buildGraph(scoped, looked, focusedRoot)
    return { snap, repos, effective, graph: { ...g, nodes: layoutGrouped(g.nodes, g.edges) }, needs: needsYou(scoped) }
  }, [raw, looked, scope, focusedRoot])

  const at = raw.at && Number.isFinite(Date.parse(raw.at)) ? new Date(raw.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
  const setScope = (v: 'repo' | 'all') => void settingsStore.getState().set('sidebarScope', v)

  const onClick = (id: string) => {
    const t = graph.targets[id]
    if (t?.kind === 'child') openMissionPane(t.child)
    else if (t?.kind === 'pr') openPr(t.pr)
    else if (t?.kind === 'mission') openContract(t.mission)
  }
  const onDoubleClick = (id: string) => {
    const t = graph.targets[id]
    if (t?.kind === 'child') attachChild(t.child.id)
  }

  return (
    <div className="pane-body cockpit">
      <div className="ck-head">
        <span className="ck-title">cockpit</span>
        <span>
          {repos.length} {repos.length === 1 ? 'repo' : 'repos'}
        </span>
        {at && <span>updated {at}</span>}
        <span className="ck-spacer" />
        <span className="m-scope ck-scope">
          <button className={scope === 'repo' ? 'on' : ''} onClick={() => setScope('repo')} title="Only the repo of the focused pane">
            this repo
          </button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')} title="Every repo with a live session">
            all
          </button>
        </span>
      </div>
      {(err || snap.errors.length > 0) && (
        <div className="ck-errors">
          {err && <div className="m-error">{err}</div>}
          {snap.errors.map((e, i) => (
            <div key={i} className="m-error">
              {e}
            </div>
          ))}
        </div>
      )}
      <div className="ck-strip">
        <span className="ck-strip-title">needs you</span>
        {needs.length > 0 ? <NeedsList needs={needs} variant="strip" showRepo={effective === 'all'} /> : <span className="ck-quiet">nothing</span>}
      </div>
      <div className="ck-canvas">
        {repos.length === 0 ? (
          !err && <div className="ck-empty">{effective === 'repo' ? 'nothing recent in this repo' : 'no live sessions'}</div>
        ) : (
          <Graph nodes={graph.nodes} edges={graph.edges} onNodeClick={onClick} onNodeDoubleClick={onDoubleClick} fitKey={`${effective}:${focusedRoot ?? ''}`} />
        )}
      </div>
      <div className="ck-hint">click a child: mission pane · double-click: attach · click a PR: open it</div>
    </div>
  )
}

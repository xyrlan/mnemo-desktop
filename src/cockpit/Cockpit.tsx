import { useMission } from '../mission/app-store'
import { useApp } from '../layout/app-store'
import { pruneSnapshot } from '../mission/types'
import { focusedCwd, repoOfCwd } from '../mission/scope'
import { RepoBlock } from '../mission/rows'
import './cockpit.css'

/** Every repo side by side, one column each, rows at full detail. Reads the snapshot the
 *  sidebar polls; it never polls itself. */
export default function Cockpit() {
  const raw = useMission((s) => s.snapshot)
  const err = useMission((s) => s.lastError)
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const snap = pruneSnapshot(raw)
  const focused = repoOfCwd(raw, focusedCwd({ tabs, activeTab, panes }, raw))
  const at = raw.at && Number.isFinite(Date.parse(raw.at)) ? new Date(raw.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null

  return (
    <div className="pane-body cockpit">
      <div className="ck-head">
        <span className="ck-title">cockpit</span>
        <span>
          {snap.repos.length} {snap.repos.length === 1 ? 'repo' : 'repos'}
        </span>
        {at && <span>updated {at}</span>}
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
      {snap.repos.length === 0 && !err ? (
        <div className="ck-empty">no live sessions</div>
      ) : (
        <div className="ck-columns">
          {snap.repos.map((r) => (
            <section key={r.root} className={`ck-column${r.root === focused?.root ? ' focused' : ''}`} data-root={r.root}>
              <RepoBlock r={r} focused={r.root === focused?.root} full />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

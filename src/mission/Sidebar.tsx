import { useEffect, useMemo, useRef, useState } from 'react'
import { missionStore, useMission } from './app-store'
import { store as appStore, useApp } from '../layout/app-store'
import { homeStore, useHome } from '../home/app-store'
import { pruneSnapshot } from './types'
import { focusedCwd, paneCwd } from './scope'
import { pruneGone } from '../cockpit/needs'
import { buildInbox, type ChildRow } from '../cockpit/inbox'
import NeedsList from '../cockpit/NeedsList'
import CockpitBody from '../cockpit/CockpitBody'
import InboxRow from '../cockpit/InboxRow'
import { VaultLevelSlot } from '../cockpit/VaultLevelSlot'
import { useArm } from '../cockpit/actions'
import { cwdForNewShell } from '../layout/cwd'
import { sessionTitle, tabLabel, type Git, type TabLabel } from '../layout/tabs'
import { tauriChrome, type ChromeClient } from '../chrome/client'
import type { Tab } from '../layout/store'

export { openMissionPane } from './rows'

/** How often the tab rows ask git again for repo · branch. */
export const GIT_POLL_MS = 5000
/** At most this often, Home's snapshot is re-read for a session a tab runs that it does not know. */
export const TITLE_RELOAD_MS = 60_000

const openCockpit = () => appStore.getState().openView('cockpit', {}, 'auto', 'cockpit')

/** Repo and branch for each of `cwds`, re-asked every few seconds. */
function useGitFor(cwds: string[], client: ChromeClient): Record<string, Git> {
  const [git, setGit] = useState<Record<string, Git>>({})
  const key = [...new Set(cwds)].sort().join('\n')
  useEffect(() => {
    const list = key ? key.split('\n') : []
    if (list.length === 0) return
    let live = true
    const ask = () =>
      void Promise.all(
        list.map((cwd) =>
          Promise.all([client.repo(cwd).catch(() => null), client.branch(cwd).catch(() => null)]).then(([repo, branch]) => [cwd, { repo, branch }] as const),
        ),
      ).then((pairs) => live && setGit(Object.fromEntries(pairs)))
    ask()
    const timer = setInterval(ask, GIT_POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [key, client])
  return git
}

const DOT_TITLE = { working: 'Claude Code is working', blocked: 'Claude Code is waiting for you', idle: 'Claude Code is idle' }

function TabRow({ tab, index, label, active }: { tab: Tab; index: number; label: TabLabel; active: boolean }) {
  const [editing, setEditing] = useState(false)
  // Enter and Escape end the edit before the input's blur does; the blur must not apply it again.
  const open = useRef(false)
  const start = () => {
    open.current = true
    setEditing(true)
  }
  const done = (name: string | undefined) => {
    if (!open.current) return
    open.current = false
    setEditing(false)
    if (name !== undefined) appStore.getState().renameTab(tab.id, name)
  }
  return (
    <div
      className={`ws-tab${active ? ' active' : ''}`}
      data-tab={tab.id}
      title={index < 9 ? `⌘${index + 1} · double-click to rename` : 'Double-click to rename'}
      onMouseDown={() => appStore.getState().goToTab(index)}
      onDoubleClick={start}
    >
      <span className={`ws-dot${label.state ? ` ws-${label.state}` : ''}`} title={label.state ? DOT_TITLE[label.state] : undefined} />
      <span className="ws-text">
        {editing ? (
          <input
            className="ws-rename"
            autoFocus
            defaultValue={tab.name ?? label.name}
            placeholder={label.name}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') done(e.currentTarget.value)
              else if (e.key === 'Escape') done(undefined)
            }}
            onBlur={(e) => done(e.currentTarget.value)}
          />
        ) : (
          <span className="ws-name">{label.name}</span>
        )}
        {label.sub && <span className="ws-sub">{label.sub}</span>}
      </span>
      <button
        className="ws-close"
        title="Close tab (⌘⇧W)"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void appStore.getState().closeTab(tab.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

/** The workspace column: Home and the tabs of this window (named by what runs in them, with a
 *  dot while Claude Code runs there), then the cockpit body for every repo — what needs you,
 *  who is working, what finished today — with `⤢` to expand it into the pane, then the vault's
 *  slot. A surface for reading and clicking: the keyboard stays the pane's. This component owns
 *  the snapshot poll every mission surface reads. */
export default function Sidebar({ chrome = tauriChrome }: { chrome?: ChromeClient }) {
  const open = useMission((s) => s.sidebarOpen)
  const width = useMission((s) => s.sidebarWidth)
  const raw = useMission((s) => s.snapshot)
  const err = useMission((s) => s.lastError)
  const home = useHome((s) => s.snapshot)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)
  const tabs = useApp((s) => s.tabs)
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

  const cwds = tabs.map((t) => paneCwd(panes[t.focused], raw)).filter((c): c is string => !!c)
  const git = useGitFor(cwds, chrome)
  const snap = useMemo(() => pruneGone(pruneSnapshot(raw)), [raw])
  const inbox = useMemo(() => buildInbox(snap), [snap])
  const { armed, fire } = useArm()

  // A tab running Claude is named by Home's title for the session. A restored workspace never
  // showed Home, and a session started by hand is newer than its snapshot: read it again, rarely.
  const titleLoad = useRef(-Infinity)
  const unknown = tabs.some((t) => {
    const sid = panes[t.focused]?.sessionId
    return !!sid && !sessionTitle(home, sid)
  })
  useEffect(() => {
    if (!unknown || Date.now() - titleLoad.current < TITLE_RELOAD_MS || homeStore.getState().loading) return
    titleLoad.current = Date.now()
    void homeStore.getState().load()
  }, [unknown, tabs, panes])

  if (!open) return null
  const needs = inbox.needs
  const renderRows = (rows: ChildRow[]) =>
    rows.map((r) => <InboxRow key={r.key} row={r} selected={false} showRepo narrow armed={armed} fire={fire} onSelect={() => {}} />)

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
      <div className="ws-tabs">
        <div className={`ws-tab ws-home${activeTab === '' ? ' active' : ''}`} title="Home (⌘⇧H)" onMouseDown={() => appStore.getState().showHome()}>
          <span className="ws-dot ws-glyph">⌂</span>
          <span className="ws-text">
            <span className="ws-name">Home</span>
          </span>
        </div>
        {tabs.map((t, i) => {
          const pane = panes[t.focused]
          const cwd = paneCwd(pane, raw)
          return <TabRow key={t.id} tab={t} index={i} active={t.id === activeTab} label={tabLabel(t, panes, raw, home, cwd ? git[cwd] : undefined)} />
        })}
        <div className="ws-tab ws-new" title="New tab (⌘T)" onMouseDown={() => void appStore.getState().newTab(cwdForNewShell())}>
          <span className="ws-dot ws-glyph">+</span>
          <span className="ws-text">
            <span className="ws-name">new tab</span>
          </span>
        </div>
      </div>
      <div className="sidebar-body">
        {err && <div className="m-error">{err}</div>}
        {snap.errors.map((e, i) => (
          <div key={i} className="m-error">
            {e}
          </div>
        ))}
        <div className="m-needs-head">
          <span>needs you</span>
          {needs.length > 0 && <span className="m-needs-count">{needs.length}</span>}
          <span className="m-needs-spacer" />
          <button className="m-cockpit" onClick={openCockpit} title="Expand into the cockpit pane, with the mission map (⌘⇧B)">
            ⤢
          </button>
        </div>
        <CockpitBody
          inbox={inbox}
          needs={<NeedsList needs={needs} showRepo />}
          empty={!err && <div className="m-empty">{snap.repos.length === 0 ? 'no live sessions' : 'nothing needs you'}</div>}
          renderRows={renderRows}
        />
      </div>
      <VaultLevelSlot className="sidebar-vault" />
    </div>
  )
}

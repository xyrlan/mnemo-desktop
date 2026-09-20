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
import VaultSquare from '../vaultlevel/VaultSquare'
import Avatar from '../avatar/Avatar'
import type { ChildWord } from '../avatar/scenes'
import { useArm } from '../cockpit/actions'
import { cwdForNewShell } from '../layout/cwd'
import { dropOnGroup, groupLabel, paneAccent, paneLabel, sessionTitle, tabLabel, type Git, type TabLabel } from '../layout/tabs'
import { dragStore, dropZone, startPaneDrag, type Zone } from '../chrome/drag'
import { leaves, type PaneId } from '../layout/tree'
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

/** Which sidebar line a dragged pane is over and where in it: `key` is the line (a group's head
 *  and its focused pane's own line stand for the same pane, and only the one under the pointer
 *  lights up), `pane` what a drop would land beside. */
type Over = { key: string; pane: PaneId; zone: Zone }

/** The classes a line wears while a drop would land in it. */
const overClass = (over: Over | null, key: string) => (over?.key === key ? ` ws-over ws-over-${over.zone}` : '')

/** The octopus a group's head wears, in the scene of the loudest thing Claude is doing in it:
 *  the same creature the cockpit gives a child, so one mark means one thing across the app. */
const CLAUDE_WORD: Record<NonNullable<TabLabel['state']>, ChildWord> = { working: 'active', blocked: 'BLOCKED', idle: 'stalled' }

/** The state dot of a line, with the tooltip that says what it means. */
const Dot = ({ state }: { state?: TabLabel['state'] }) => (
  <span className={`ws-dot${state ? ` ws-${state}` : ''}`} title={state ? DOT_TITLE[state] : undefined} />
)

function TabRow({
  tab,
  index,
  label,
  active,
  group,
  dropKey,
  dropPaneId,
  over,
}: {
  tab: Tab
  index: number
  label: TabLabel
  active: boolean
  /** True when this line heads a group of several panes, which are listed under it. */
  group?: boolean
  dropKey: string
  dropPaneId: PaneId
  over: Over | null
}) {
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
      className={`ws-tab ws-drop${group ? ' ws-group-head' : ''}${active ? ' active' : ''}${overClass(over, dropKey)}`}
      data-tab={tab.id}
      data-drop={dropKey}
      data-pane={dropPaneId}
      title={group ? 'Double-click to rename this group' : index < 9 ? `⌘${index + 1} · double-click to rename` : 'Double-click to rename'}
      onMouseDown={(e) => {
        // A group's head names the group and nothing else: its panes are the lines underneath,
        // and each of them is the way in. Renaming and closing stay, since those act on the
        // group itself rather than on whichever pane the head would otherwise have picked.
        if (group) return
        appStore.getState().goToTab(index)
        // A tab of one pane is that pane's own line as well, so dragging it carries the pane into
        // another group — and the tab it empties goes with it. A group's head carries no one pane.
        if (e.button === 0) startPaneDrag(dropPaneId, e, (from, to, zone) => dropOnGroup(appStore.getState(), from, to, zone))
      }}
      onDoubleClick={start}
    >
      <Dot state={label.state} />
      {group && label.state && (
        <span className="ws-claude" title="Claude Code runs in one of these panes" aria-hidden>
          <Avatar state={CLAUDE_WORD[label.state]} size={14} />
        </span>
      )}
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

/** One pane of a group, on a line of its own: its repo's accent down the left, what runs in it,
 *  and where that is. Pressing it focuses the pane and shows its group; dragging it moves the
 *  pane — onto a pane on screen, or onto another group's line here. */
function PaneRow({ id, label, accent, active, over }: { id: PaneId; label: TabLabel; accent?: string; active: boolean; over: Over | null }) {
  const key = `pane-${id}`
  return (
    <div
      className={`ws-pane ws-drop${active ? ' active' : ''}${overClass(over, key)}`}
      data-drop={key}
      data-pane={id}
      title="Click to focus · drag onto another group to move it there"
      style={accent ? { borderLeftColor: accent } : undefined}
      onMouseDown={(e) => {
        if (e.button !== 0) return
        appStore.getState().goToPane(id)
        startPaneDrag(id, e, (from, to, zone) => dropOnGroup(appStore.getState(), from, to, zone))
      }}
    >
      <Dot state={label.state} />
      <span className="ws-text">
        <span className="ws-name">{label.name}</span>
        {label.sub && <span className="ws-sub">{label.sub}</span>}
      </span>
    </div>
  )
}

/** The sidebar line a dragged pane bar is over, and where in it a drop would land — plus the
 *  drop itself, on release.
 *
 *  `startPaneDrag` tracks the drag and resolves its own target among the panes on screen; a
 *  sidebar line is not one of those, so the sidebar resolves its own here. Both listen on the
 *  window in the capture phase and nothing says which of them the browser calls first, so the
 *  pane being carried is mirrored out of the drag store as it is set — never read from inside a
 *  listener, where it may not be there yet or may already have been cleared. At most one of the
 *  two ever has a target, so a release lands exactly one move. */
function useSidebarDrop(host: React.RefObject<HTMLElement | null>): Over | null {
  const [over, setOver] = useState<Over | null>(null)
  /** The pane being dragged, and the line of this sidebar it is over; both null between drags. */
  const from = useRef<PaneId | null>(null)
  const live = useRef<Over | null>(null)
  useEffect(
    () =>
      dragStore.subscribe((s) => {
        if (s.from !== null) from.current = s.from
      }),
    [],
  )
  useEffect(() => {
    const at = (ev: MouseEvent, dragged: PaneId): Over | null => {
      const el = ev.target instanceof Element ? ev.target.closest<HTMLElement>('.ws-drop[data-pane]') : null
      if (!el || !host.current?.contains(el)) return null
      const pane = Number(el.dataset.pane)
      if (!Number.isFinite(pane) || pane === dragged) return null
      const r = el.getBoundingClientRect()
      const zone = dropZone(ev.clientX, ev.clientY, { x: r.left, y: r.top, w: r.width, h: r.height })
      return zone ? { key: el.dataset.drop ?? '', pane, zone } : null
    }
    const rest = () => {
      from.current = null
      live.current = null
      setOver(null)
    }
    const move = (ev: MouseEvent) => {
      if (from.current === null) return
      const next = at(ev, from.current)
      if (next?.key === live.current?.key && next?.zone === live.current?.zone) return
      live.current = next
      setOver(next)
    }
    const up = (ev: MouseEvent) => {
      const dragged = from.current
      // The release names the target itself, so a drag whose last move the sidebar did not see
      // still lands where the pointer was let go.
      const target = dragged === null ? null : at(ev, dragged) ?? live.current
      rest()
      if (dragged !== null && target) dropOnGroup(appStore.getState(), dragged, target.pane, target.zone)
    }
    // A press begins a drag that has carried nothing yet; Escape cancels the one in flight.
    const key = (ev: KeyboardEvent) => ev.key === 'Escape' && rest()
    window.addEventListener('mousedown', rest, true)
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', rest, true)
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [host])
  return over
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

  // Every pane of every tab, in the order the sidebar lists them: each has a line of its own.
  const paneIds = useMemo(() => tabs.map((t) => leaves(t.root)), [tabs])
  const cwds = paneIds.flat().map((id) => paneCwd(panes[id], raw)).filter((c): c is string => !!c)
  const git = useGitFor(cwds, chrome)
  const over = useSidebarDrop(ref)
  const snap = useMemo(() => pruneGone(pruneSnapshot(raw)), [raw])
  const inbox = useMemo(() => buildInbox(snap), [snap])
  const { armed, fire } = useArm()

  // A tab running Claude is named by Home's title for the session. A restored workspace never
  // showed Home, and a session started by hand is newer than its snapshot: read it again, rarely.
  const titleLoad = useRef(-Infinity)
  const unknown = paneIds.flat().some((id) => {
    const sid = panes[id]?.sessionId
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
          const ids = paneIds[i]
          const gitOf = (id: PaneId) => {
            const cwd = paneCwd(panes[id], raw)
            return cwd ? git[cwd] : undefined
          }
          const head = (key: string, label: TabLabel, group?: boolean) => (
            <TabRow key={key} tab={t} index={i} active={t.id === activeTab} label={label} group={group} dropKey={`tab-${t.id}`} dropPaneId={t.focused} over={over} />
          )
          // One pane is one line, exactly as it was: a header over a single child would spend a
          // line saying nothing. The group appears only where there is something to group.
          if (ids.length < 2) return head(t.id, tabLabel(t, panes, raw, home, gitOf(t.focused)))
          return (
            <div key={t.id} className="ws-group">
              {head(t.id, groupLabel(t, panes, raw), true)}
              {ids.map((id) => (
                <PaneRow
                  key={id}
                  id={id}
                  label={paneLabel(panes[id], raw, home, gitOf(id))}
                  accent={paneAccent(panes[id], raw)}
                  active={t.id === activeTab && t.focused === id}
                  over={over}
                />
              ))}
            </div>
          )
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
      <VaultLevelSlot className="sidebar-vault">
        <VaultSquare />
      </VaultLevelSlot>
    </div>
  )
}

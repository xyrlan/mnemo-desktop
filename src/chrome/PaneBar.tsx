import { useEffect, useRef, useState } from 'react'
import { store, useApp } from '../layout/app-store'
import { useMission } from '../mission/app-store'
import type { PaneId } from '../layout/tree'
import { tauriChrome, type ChromeClient } from './client'
import { barInfo, FLASH_MS, pulseLabel, pulseTitle } from './info'
import { dropPane, startPaneDrag } from './drag'
import { tauriSession, useSessionLearn, type SessionClient } from './session'
import { pulseStore, usePulse } from '../pulse/app-store'
import type { Pulse } from '../pulse/store'
import { openRule } from '../pulse/open'
import Overlay from '../pulse/Overlay'
import DropZoneOverlay from './DropZoneOverlay'
import './chrome.css'

/** How often a visible bar asks git again (a `git switch` in the pane shows up this late). */
export const POLL_MS = 5000

type Git = { cwd?: string; repo?: string | null; branch?: string | null }

/** Repo and branch of `cwd`, refreshed while the bar is on screen. */
function useGit(cwd: string | undefined, client: ChromeClient, bar: React.RefObject<HTMLElement | null>): Git {
  const [git, setGit] = useState<Git>({})
  useEffect(() => {
    if (!cwd) return
    let live = true
    const ask = () =>
      void Promise.all([client.repo(cwd).catch(() => null), client.branch(cwd).catch(() => null)]).then(([repo, branch]) => {
        if (live) setGit({ cwd, repo, branch })
      })
    ask()
    // Hidden tabs are `display: none`, which leaves the bar without an offsetParent.
    const timer = setInterval(() => bar.current?.offsetParent && ask(), POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [cwd, client, bar])
  // A stale answer for the previous cwd would label the pane with the wrong branch.
  return git.cwd === cwd ? git : {}
}

/** Claims pane `id` for the pulses of its session and repo (see `routePulse`) while mounted. */
function usePulseClaim(id: PaneId, place: string | undefined, sessionId: string | undefined) {
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  useEffect(() => pulseStore.getState().claim({ pane: id, place, sessionId, focused }), [id, place, sessionId, focused])
  useEffect(() => () => pulseStore.getState().release(id), [id])
}

/** The newest pulse of pane `id` while it is under `FLASH_MS` old, and how many it has had. */
function usePulseFlash(id: PaneId): { live: Pulse | undefined; count: number } {
  const latest = usePulse((s) => s.latestFor(id))
  const count = usePulse((s) => s.countFor(id))
  const [live, setLive] = useState<Pulse>()
  useEffect(() => {
    const left = latest ? latest.received + FLASH_MS - Date.now() : 0
    setLive(left > 0 ? latest : undefined)
    if (left <= 0) return
    const timer = setTimeout(() => setLive(undefined), left)
    return () => clearTimeout(timer)
  }, [latest])
  return { live, count }
}

/** The header of every pane: drag handle, repo · branch, Claude tokens, close. Pressing it
 *  focuses the pane without taking keyboard focus from a terminal that already has it. It also
 *  learns the Claude session a terminal runs (`useSessionLearn`). */
export default function PaneBar({ id, client = tauriChrome, sessions = tauriSession }: { id: PaneId; client?: ChromeClient; sessions?: SessionClient }) {
  const ref = useRef<HTMLDivElement>(null)
  useSessionLearn(id, sessions)
  const pane = useApp((s) => s.panes[id])
  const snap = useMission((s) => s.snapshot)
  const cwd = barInfo(pane, snap).cwd
  const git = useGit(cwd, client, ref)
  const info = barInfo(pane, snap, git)
  usePulseClaim(id, info.place, pane?.sessionId)
  const { live, count } = usePulseFlash(id)

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    // preventDefault keeps focus where it is; when that is another pane, let it go so the
    // pane taking focus (a terminal focuses its xterm) is the one that gets the keys.
    const own = ref.current?.closest('.pane')
    const active = document.activeElement
    if (active instanceof HTMLElement && own && !own.contains(active)) active.blur()
    store.getState().focusPane(id)
    startPaneDrag(id, e, (from, to, zone) => dropPane(store.getState(), from, to, zone))
  }

  const close = (e: React.MouseEvent) => {
    e.stopPropagation()
    store.getState().focusPane(id)
    void store.getState().closePane()
  }

  const toggleFace = (e: React.MouseEvent) => {
    e.stopPropagation()
    store.getState().focusPane(id)
    store.getState().setFace(id, pane?.face === 'conversation' ? 'terminal' : 'conversation')
  }

  const openPulse = (e: React.MouseEvent) => {
    e.stopPropagation()
    // The rule of the flash, else the last rule that fired here (a briefing names none).
    const hit = live?.event.slugs.length ? live.event : pulseStore.getState().recentFor(id).find((x) => x.slugs.length)
    if (hit) void openRule(hit.slugs[0], hit.agent || hit.project)
  }

  return (
    <>
      <div ref={ref} className={`pane-bar${live ? ` pane-bar-pulsing pulse-${live.event.kind}` : ''}`} onMouseDown={onMouseDown} title={info.cwd ?? 'Drag onto another pane to swap, or onto its edge to move beside it'}>
        <span className="pane-bar-grip" aria-hidden>
          ⠿
        </span>
        {info.place && <span className="pane-bar-repo">{info.place}</span>}
        {info.branch && <span className="pane-bar-branch">{info.branch}</span>}
        <span className="pane-bar-title">{info.title}</span>
        {live && <span key={live.id} className="pane-bar-glow" aria-hidden />}
        {count > 0 && (
          <button
            className={`pane-bar-pulse${live ? ' live' : ''}`}
            title={live ? pulseTitle(live.event) : `${count} mnemo event${count === 1 ? '' : 's'} in this pane since launch`}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={openPulse}
          >
            {live && <span className="pane-bar-pulse-label">{pulseLabel(live.event)}</span>}
            <span className="pane-bar-pulse-count">{live ? count : `↯ ${count}`}</span>
          </button>
        )}
        {info.tokens && <span className="pane-bar-tokens">{info.tokens}</span>}
        {pane?.view === 'terminal' && (
          <button
            className={`pane-bar-face${pane.face === 'conversation' ? ' on' : ''}`}
            title="Toggle conversation (⌘⇧C)"
            aria-pressed={pane.face === 'conversation'}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={toggleFace}
          >
            {pane.face === 'conversation' ? 'conversation' : 'terminal'}
          </button>
        )}
        <button
          className="pane-close"
          title="Close pane (⌘W)"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={close}
        >
          ×
        </button>
      </div>
      <Overlay pane={id} />
      <DropZoneOverlay pane={id} />
    </>
  )
}

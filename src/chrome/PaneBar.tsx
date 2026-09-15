import { useEffect, useRef, useState } from 'react'
import { store, useApp } from '../layout/app-store'
import { useMission } from '../mission/app-store'
import type { PaneId } from '../layout/tree'
import { tauriChrome, type ChromeClient } from './client'
import { barInfo } from './info'
import { startPaneDrag } from './drag'

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

/** The header of every pane: drag handle, repo · branch, Claude tokens, close. Pressing it
 *  focuses the pane without taking keyboard focus from a terminal that already has it. */
export default function PaneBar({ id, client = tauriChrome }: { id: PaneId; client?: ChromeClient }) {
  const ref = useRef<HTMLDivElement>(null)
  const pane = useApp((s) => s.panes[id])
  const snap = useMission((s) => s.snapshot)
  const cwd = barInfo(pane, snap).cwd
  const git = useGit(cwd, client, ref)
  const info = barInfo(pane, snap, git)

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    // preventDefault keeps focus where it is; when that is another pane, let it go so the
    // pane taking focus (a terminal focuses its xterm) is the one that gets the keys.
    const own = ref.current?.closest('.pane')
    const active = document.activeElement
    if (active instanceof HTMLElement && own && !own.contains(active)) active.blur()
    store.getState().focusPane(id)
    startPaneDrag(id, e, (a, b) => store.getState().swapPanes(a, b))
  }

  const close = (e: React.MouseEvent) => {
    e.stopPropagation()
    store.getState().focusPane(id)
    void store.getState().closePane()
  }

  return (
    <div ref={ref} className="pane-bar" onMouseDown={onMouseDown} title={info.cwd ?? 'Drag onto another pane to swap'}>
      <span className="pane-bar-grip" aria-hidden>
        ⠿
      </span>
      {info.place && <span className="pane-bar-repo">{info.place}</span>}
      {info.branch && <span className="pane-bar-branch">{info.branch}</span>}
      <span className="pane-bar-title">{info.title}</span>
      {info.tokens && <span className="pane-bar-tokens">{info.tokens}</span>}
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
  )
}

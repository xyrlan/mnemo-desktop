import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/ui'
import { STATUS_BAR, TOP_CHROME } from '../dashboard/AgentDashboardDrawer'
import { useMission } from '../mission/app-store'
import { usePulse } from '../pulse/app-store'
import { pollWhileShown } from '../shell/while-shown'
import type { PulseEvent } from '../pulse/types'
import { openArchive, openNexus, openRobot } from './actions'
import type { NexusClient } from './client'
import { packetsFrom } from './packets'
import { Scene } from './Scene'
import { useNexus } from './store'
import type { ArchiveCounts, Target } from './types'
import { startNexusUsage } from './usage'
import { buildWorld } from './world'

/** How often the archives' page counts are asked again while the drawer is open. */
const ARCHIVES_MS = 60_000
const NO_ARCHIVES: ArchiveCounts = { projects: {}, universal: 0 }

const reducedMotionQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null)

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => reducedMotionQuery()?.matches ?? false)
  useEffect(() => {
    const q = reducedMotionQuery()
    if (!q) return
    const on = () => setReduced(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return reduced
}

function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}

/** Mounted only while the sheet is open (Radix unmounts closed content), so nothing is built,
 *  polled or animated while nobody looks. */
function NexusBody({ client, onPicked }: { client: NexusClient; onPicked: () => void }) {
  const snapshot = useMission((s) => s.snapshot)
  const log = usePulse((s) => s.log)
  const [archives, setArchives] = useState<ArchiveCounts>(NO_ARCHIVES)
  const [now, setNow] = useState(() => Date.now())
  const reducedMotion = useReducedMotion()
  const visible = useVisible()

  useEffect(() => {
    let live = true
    const stop = pollWhileShown(async () => {
      const a = await client.archives()
      if (live) setArchives(a)
    }, ARCHIVES_MS)
    return () => {
      live = false
      stop()
    }
  }, [client])

  useEffect(() => startNexusUsage((row) => void client.logUsage(row).catch(() => {}), Date.now), [client])

  // The world is rebuilt on every snapshot and pulse; `now` moves with them.
  useEffect(() => setNow(Date.now()), [snapshot, log])

  const events: PulseEvent[] = useMemo(() => log.map((p) => p.event), [log])
  const world = useMemo(() => buildWorld(snapshot, archives, now), [snapshot, archives, now])
  const packets = useMemo(() => packetsFrom(events, world, now), [events, world, now])

  const pick = useCallback(
    (t: Target) => {
      if (t.kind === 'nexus') openNexus(t.nexus)
      else if (t.kind === 'robot') openRobot(t.robot)
      else openArchive(t.root, t.archive)
      onPicked()
    },
    [onPicked],
  )

  return <Scene world={world} packets={packets} events={events} onPick={pick} reducedMotion={reducedMotion} visible={visible} />
}

export type NexusDrawerProps = {
  client: NexusClient
  /** Where the left sidebar ends, in px: the drawer opens from there. */
  leftEdge: number
}

/** The Nexus: a non-modal sheet from the left sidebar's edge, like the Agent Dashboard, so it
 *  stays the same while the workbench switches worktrees under it (spec Q2). A pick closes it. */
export function NexusDrawer({ client, leftEdge }: NexusDrawerProps) {
  const open = useNexus((s) => s.open)
  const setOpen = useNexus((s) => s.setOpen)
  const close = useCallback(() => setOpen(false), [setOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][data-state="open"]:not([data-nexus-sheet])')) return
      e.preventDefault()
      e.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  const left = `${leftEdge}px`
  const onOpenChange = useCallback((next: boolean) => void (next && setOpen(true)), [setOpen])

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        className="nexus-sheet z-drawer bg-worktree-sidebar p-0 sm:max-w-none dark:bg-worktree-sidebar"
        style={{ left, top: TOP_CHROME, bottom: STATUS_BAR, height: 'auto', width: `calc(100vw - ${left})` }}
        data-nexus-sheet=""
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">Nexus</SheetTitle>
        <div className="flex min-h-0 flex-1 flex-col">
          <NexusBody client={client} onPicked={close} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

import { useEffect, useRef, useState, type JSX } from 'react'
import type { SelectionBarProps, ShipAction, ShipRobot } from '../ship-types'
import { isGreen, isRunning, robotById } from './find'

/** How long a merge or a stop waits for its second click. */
export const ARM_MS = 4_000

type Armed = 'merge' | 'stop' | null

/** What can be done to the shift+clicked robots (spec "Selection"): *merge N green · stop N · open
 *  N · clear*, while there is a selection. A merge and a stop cannot be undone, so each takes a
 *  second click within 4 s; either one, or opening, clears the selection. */
export function SelectionBar({ ship, selection, onClear, run }: SelectionBarProps): JSX.Element | null {
  const [armed, setArmed] = useState<Armed>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const robots = [...selection].map((id) => robotById(ship, id)).filter((r): r is ShipRobot => !!r)
  const green = robots.filter(isGreen)
  const running = robots.filter(isRunning)

  // A new selection is a new question: an armed button does not carry over.
  const key = [...selection].join(',')
  useEffect(() => {
    window.clearTimeout(timer.current)
    setArmed(null)
  }, [key])

  if (!robots.length) return null

  const fire = (what: Exclude<Armed, null>, action: ShipAction) => {
    window.clearTimeout(timer.current)
    if (armed !== what) {
      setArmed(what)
      timer.current = window.setTimeout(() => setArmed(null), ARM_MS)
      return
    }
    setArmed(null)
    onClear()
    void run(action).catch(() => {})
  }
  const open = () => {
    onClear()
    for (const r of robots) void run({ kind: 'open', id: r.id }).catch(() => {})
  }

  const btn = 'rounded-sm border-2 px-2 py-0.5 font-bold disabled:cursor-default disabled:opacity-35'
  return (
    <div
      data-selection-bar=""
      role="toolbar"
      aria-label="Selected robots"
      className="fixed bottom-3.5 left-1/2 z-popover flex -translate-x-1/2 items-center gap-2 rounded-sm border-2 border-[#26335c] bg-[#0b1020] px-2.5 py-1.5 font-mono text-[12px] text-slate-200 shadow-[4px_4px_0_#000]"
    >
      <b className="mr-1 text-white">{robots.length} selected</b>
      <button
        type="button"
        data-b="merge"
        disabled={!green.length}
        title={green.length ? `merges ${green.map((r) => r.label).join(' ')} through the checks-gated merge` : 'no selected PR is green'}
        className={`${btn} border-state-done bg-green-900 text-green-100`}
        onClick={() => fire('merge', { kind: 'merge', robotIds: green.map((r) => r.id) })}
      >
        {armed === 'merge' ? `confirm merge of ${green.length}?` : `✈ merge ${green.length} green`}
      </button>
      <button
        type="button"
        data-b="stop"
        disabled={!running.length}
        title={running.length ? `claude stop ${running.map((r) => r.label).join(' ')}: each keeps its conversation` : 'none of them is running'}
        className={`${btn} border-red-900 bg-[#18213f] text-red-200`}
        onClick={() => fire('stop', { kind: 'stop', robotIds: running.map((r) => r.id) })}
      >
        {armed === 'stop' ? `confirm stop of ${running.length}?` : `■ stop ${running.length}`}
      </button>
      <button type="button" data-b="open" className={`${btn} border-[#26335c] bg-[#18213f]`} onClick={open}>
        ⤢ open {robots.length}
      </button>
      <button type="button" data-b="clear" className={`${btn} border-[#26335c] bg-[#18213f]`} onClick={onClear}>
        clear
      </button>
      <small className="text-slate-400">shift+click adds · Esc clears</small>
    </div>
  )
}

// A stand for the instruments, for the preview harness only: nothing in the app imports
// this file, so no build carries it. A scenario's `drive` loads it into the page to draw
// `Instruments` where the frame does not put it yet (beside the score, at the playhead's
// moment), on the same world and route the page already has:
//
//   await page.evaluate(() => import('/src/instruments/bench.tsx').then((b) => b.stand({ minutesAgo: 95 })))

import { createRoot } from 'react-dom/client'
import { useRoute } from '../world/route'
import { useWorld } from '../world/store'
import { Instruments } from './index'

interface Stand {
  /** The column's width, in the frame's `em`. */
  width?: number
  /** The moment read: this many minutes before the world's now. Absent: the route's `at`. */
  minutesAgo?: number
}

function Stood({ minutesAgo }: Stand) {
  const sessionId = useRoute((r) => r.session)
  const routed = useRoute((r) => r.at)
  const now = useWorld((w) => w.at)
  if (!sessionId) return null
  return <Instruments sessionId={sessionId} at={minutesAgo == null ? routed : now - minutesAgo * 60_000} />
}

/** Stands the instruments on the right of the frame's view, as the score will. */
export function stand({ width = 30, minutesAgo }: Stand = {}): void {
  const main = document.querySelector('.mn main')
  if (!main) throw new Error('the new front is not on this page')
  const column = document.createElement('div')
  column.dataset.instrumentsStand = ''
  column.style.cssText = `position:absolute;top:0;right:0;bottom:0;width:${width}em;background:var(--void);z-index:2`
  main.appendChild(column)
  createRoot(column).render(<Stood minutesAgo={minutesAgo} />)
}

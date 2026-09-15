import { useEffect, useRef, useState } from 'react'

/** How long a destructive button stays armed for its second click. */
export const ARM_MS = 4000

/** Destructive actions ask once, like the mission pane's stop: `press(key)` is true on the
 *  second press of the same key within `ARM_MS`, and arms it otherwise. */
export function useArm(): { armed: string | null; press(key: string): boolean } {
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    armed,
    press(key) {
      window.clearTimeout(timer.current)
      if (armed === key) {
        setArmed(null)
        return true
      }
      setArmed(key)
      timer.current = window.setTimeout(() => setArmed(null), ARM_MS)
      return false
    },
  }
}

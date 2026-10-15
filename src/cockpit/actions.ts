import { useEffect, useRef, useState } from 'react'

export { mergeKey } from './merge'

/** Two-step confirmation for what cannot be undone (a merge): the first `fire(key)`
 *  arms `key` and returns false, a second one within `ms` returns true. `armed` names what
 *  is waiting for the second press, so the button can say so. */
export function useArm(ms = 4000): { armed: string | null; fire: (key: string) => boolean } {
  const [armed, setArmed] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const fire = (key: string) => {
    window.clearTimeout(timer.current)
    if (armed === key) {
      setArmed(null)
      return true
    }
    setArmed(key)
    timer.current = window.setTimeout(() => setArmed(null), ms)
    return false
  }
  return { armed, fire }
}

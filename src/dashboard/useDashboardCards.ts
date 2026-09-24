// adapted from stablyai/orca components/dashboard-popout/useDashboardSnapshot.ts
import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { StoreApi } from 'zustand/vanilla'
import type { Fleet } from '../fleet/types'
import { cardsOf, columnSignature, type DashboardCard } from './model'

/** Set on `<html>` for the length of the board's own view transition: the pseudo-element rules in
 *  dashboard.css hang off it, so they never touch a transition anything else starts. */
export const MOVING_CLASS = 'agent-dashboard-moving'

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

type StartViewTransition = (update: () => void) => { finished: Promise<void> }

/** The fleet's agents as cards, live. When a card changes column — or one comes or goes — the
 *  update runs inside a view transition, so the browser morphs each card from where it was to
 *  where it is; any other change (a title, a PR) just lands. */
export function useDashboardCards(fleet: StoreApi<Fleet>): DashboardCard[] {
  const [cards, setCards] = useState(() => cardsOf(fleet.getState().repos))

  useEffect(() => {
    let signature = columnSignature(cardsOf(fleet.getState().repos))
    let running = 0
    const apply = (repos: Fleet['repos']) => {
      const next = cardsOf(repos)
      const nextSignature = columnSignature(next)
      const moved = nextSignature !== signature
      signature = nextSignature
      const doc = document as Document & { startViewTransition?: StartViewTransition }
      if (!moved || prefersReducedMotion() || typeof doc.startViewTransition !== 'function') {
        setCards(next)
        return
      }
      const root = document.documentElement
      root.classList.add(MOVING_CLASS)
      running++
      // flushSync: the browser captures the "after" picture from the DOM as the callback returns.
      const t = doc.startViewTransition(() => flushSync(() => setCards(next)))
      // A transition started over one still running cuts it short; the class stays for the last.
      const done = () => void (--running === 0 && root.classList.remove(MOVING_CLASS))
      t.finished.then(done, done)
    }
    // The fleet may have moved between the first render and this subscription.
    apply(fleet.getState().repos)
    return fleet.subscribe((s, p) => {
      if (s.repos !== p.repos) apply(s.repos)
    })
  }, [fleet])

  return cards
}

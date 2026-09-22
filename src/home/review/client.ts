import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useState } from 'react'
import type { Review } from './types'

/** PR `number` of the repo at `root`, read through `gh` from the repo root (`review.rs`). */
export async function readReview(root: string, number: number): Promise<Review> {
  const r = await invoke<Review>('review_pr', { root, number })
  // A backend of another shape (an older build, a mock) is a failed read, not a crash.
  if (!r || !Array.isArray(r.files)) throw new Error('review_pr answered something this view cannot read')
  return r
}

export type ReviewState = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; review: Review }

/** The PR's review, read when the view opens and again on `reload`. A read that lands after
 *  the view moved to another PR is dropped. */
export function useReview(root: string, number: number): { state: ReviewState; reload: () => void } {
  const [state, setState] = useState<ReviewState>({ status: 'loading' })
  const [round, setRound] = useState(0)
  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    readReview(root, number).then(
      (review) => alive && setState({ status: 'ready', review }),
      (e) => alive && setState({ status: 'error', error: String(e) }),
    )
    return () => {
      alive = false
    }
  }, [root, number, round])
  const reload = useCallback(() => setRound((r) => r + 1), [])
  return { state, reload }
}

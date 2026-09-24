import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

/** The two steps, in order: the four programs the app runs, then the consent to learn from the
 *  user's Claude Code history. */
export type Step = 'setup' | 'learned'

export const STEPS: Step[] = ['setup', 'learned']

export type OnboardingState = {
  open: boolean
  step: Step
  /** The dialog stepped aside for a terminal tab an installer runs in; it comes back when the
   *  user leaves that tab. */
  aside: boolean
}

export type OnboardingActions = {
  /** Opens the dialog at `step`, by hand: ⌘K, or the launch check with a tool missing. */
  show(step?: Step): void
  /** Opens it at `step` unless the user is already in it or away in an installer's tab: the
   *  launch check of the review, which must not jump a dialog the user is reading. */
  offer(step: Step): void
  close(): void
  /** Closes the dialog for as long as the tab `open` makes is in front, then opens it again at
   *  setup, which checks again. `open` opens the tab; `activeTab` and `subscribe` watch it. */
  stepAside(deps: { open(): Promise<void>; activeTab(): string; subscribe(fn: () => void): () => void }): Promise<void>
}

export type OnboardingStore = StoreApi<OnboardingState & OnboardingActions>

export function createOnboardingStore(): OnboardingStore {
  return createZustand<OnboardingState & OnboardingActions>((set, get) => {
    let unwatch = () => {}
    const back = () => {
      unwatch()
      unwatch = () => {}
    }
    return {
      open: false,
      step: 'setup',
      aside: false,

      show(step = 'setup') {
        back()
        set({ open: true, step, aside: false })
      },

      offer(step) {
        const s = get()
        if (s.open || s.aside) return
        set({ open: true, step })
      },

      close() {
        back()
        set({ open: false, aside: false })
      },

      async stepAside(d) {
        back()
        set({ open: false, aside: true })
        try {
          await d.open()
        } catch {
          // No tab came up: nothing to wait for.
          if (get().aside) set({ open: true, step: 'setup', aside: false })
          return
        }
        // Closed or shown again by hand while the tab was coming up.
        if (!get().aside) return
        const tab = d.activeTab()
        const stop = d.subscribe(() => {
          if (d.activeTab() === tab) return
          back()
          set({ open: true, step: 'setup', aside: false })
        })
        unwatch = stop
      },
    }
  })
}

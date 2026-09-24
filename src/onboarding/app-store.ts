import { useStore } from 'zustand'
import { createOnboardingStore, type OnboardingActions, type OnboardingState } from './store'

/** The single live store: the launch checks of setup and of the review open the dialog here. */
export const onboarding = createOnboardingStore()
export const useOnboarding = <T,>(sel: (s: OnboardingState & OnboardingActions) => T) => useStore(onboarding, sel)

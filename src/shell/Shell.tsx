import { TooltipProvider } from '@/ui'
import { SlotOutlet } from './Slot'

/** The app's root: what is mounted in the overlay slot (the Nexus, its toaster, the notification
 *  stack, the dictation indicator), each in its own error boundary, inside one `TooltipProvider`
 *  (the indicator's Radix tooltip throws without one). Every screen mounts itself through
 *  `mountInSlot`. */
export default function Shell() {
  return (
    <TooltipProvider delayDuration={400}>
      <SlotOutlet slot="overlay" />
    </TooltipProvider>
  )
}

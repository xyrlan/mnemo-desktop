import { Toaster } from '@/ui'

/** The app's one toaster, which the Nexus mounts in the shell's overlay slot at launch. Each toast
 *  can be closed; the look is the ship's (`src/ui/sonner.css`). */
export function NexusToasts() {
  return <Toaster closeButton />
}

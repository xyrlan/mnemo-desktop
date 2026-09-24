import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge only knows Tailwind's own scales: taught the names theme.css adds, so a
// `className="z-menu"` passed to a primitive replaces its `z-popover` instead of sitting
// beside it and losing on source order.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      z: [{ z: ['drawer', 'toast', 'modal', 'popover', 'menu', 'tooltip'] }],
      shadow: [{ shadow: ['floating'] }],
    },
  },
})

/** Joins class names the way every shadcn component expects: conditional parts via clsx, and
 *  a later Tailwind class wins over an earlier one of the same kind. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

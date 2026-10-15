// adapted from stablyai/orca src/renderer/src/components/ui/sonner.tsx (MIT, 122b8c25)
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import './sonner.css'

/** The app's one toaster, in the ship's look (sonner.css): the Nexus mounts it at launch
 *  (`src/nexus/boot/`), and every `toast(...)` lands in it. */
const Toaster = ({ ...props }: ToasterProps) => {
  // The ship is dark; a caller's `theme` prop still wins.
  const theme = 'dark'

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      position="bottom-right"
      // Why: clear of the strip along the window's bottom edge (the ship's bottom is 24px up), and
      // mobileOffset keeps that clearance below Sonner's 600px breakpoint, which otherwise reverts
      // to Sonner's default 16px.
      offset={{ bottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
      mobileOffset={{ bottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))' }}
      className="toaster group nx-toaster"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />
      }}
      style={
        {
          // The ship's hull and its lit edge (src/nexus/ui/ui.css).
          '--normal-bg': '#0e1529',
          '--normal-bg-hover': '#121a33',
          '--normal-text': '#dfe6ff',
          '--normal-border': '#a5b4fc',
          '--normal-border-hover': '#a5b4fc',
          '--border-radius': '4px',
          '--width': 'min(26rem, calc(100vw - 2rem))'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

// How a panel of this piece registers itself. The host (`src/panels/index.tsx`) imports every
// panel folder from an eager glob, which compiles to imports hoisted above the host's own body.
// So when the host is what was imported first (the frame does that), a panel's file runs while
// the host's registry is still uninitialised, and a plain `registerPanel(spec)` at import throws
// "Cannot access 'registry' before initialization" and takes the whole frame with it.
//
// Until the host makes its registry safe to reach early, a panel registers at once when it can
// and as soon as the host's body has run when it cannot: on a microtask in a browser, where a
// module graph is evaluated in one go and the first render comes after; on a timer where
// modules are evaluated one await at a time (vitest).

import { registerPanel, type PanelSpec } from '..'

/** How many timer turns the host is given before the failure is let through. */
const TURNS = 200

export function register(spec: PanelSpec): void {
  const attempt = (): boolean => {
    try {
      registerPanel(spec)
      return true
    } catch (e) {
      // Only the registry not being there yet is waited out.
      if (!(e instanceof ReferenceError)) throw e
      return false
    }
  }
  if (attempt()) return
  queueMicrotask(() => {
    if (attempt()) return
    let turns = 0
    const again = () => {
      if (attempt()) return
      if (++turns >= TURNS) return registerPanel(spec)
      setTimeout(again, 0)
    }
    setTimeout(again, 0)
  })
}

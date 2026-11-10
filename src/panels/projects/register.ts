// How a panel of this piece registers itself.
//
// The host (`../index.tsx`) imports every panel folder, so a panel must not import the host
// back to register: that cycle ran a panel's file before the host's own body, and the call
// threw. The registry is a file of its own (`../registry.ts`) that imports nothing of the host.

import { registerPanel, type PanelSpec } from '../registry'

export function register(spec: PanelSpec): void {
  registerPanel(spec)
}

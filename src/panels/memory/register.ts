// How the system panels register with the host.
//
// The host (`../index.tsx`) imports every panel folder, so a panel must not import the host
// back to register: that cycle ran a panel's module before the host's own body, and the call
// threw. The registry is a file of its own (`../registry.ts`) that imports nothing of the host,
// and this is the one place the system panels reach it.

import { registerPanel, type PanelSpec } from '../registry'

/** Registers `spec` with the host. */
export function register(spec: PanelSpec): void {
  registerPanel(spec)
}

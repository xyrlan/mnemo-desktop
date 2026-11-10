// How the system panels register with the host.
//
// The host (`../index.tsx`) imports every panel folder eagerly, and a panel imports the host for
// `registerPanel`: a cycle. The frame imports the host first, so a panel's module runs before the
// host's own body has made its registry, and a `registerPanel` called at that moment throws
// (`Cannot access 'registry' before initialization`), which takes the whole frame down with it.
// So the call is tried now and, while the host is still loading, again once it has finished: a
// microtask later in a browser, where the module graph is evaluated in one go and the first
// render comes after it. With a host that no longer has the cycle the first try registers.

import { registerPanel, type PanelSpec } from '../index'

/** Microtask tries before falling back to a timer: more than any module graph needs, few enough
 *  that a host that never loads does not hold the page. */
const TICKS = 200
/** Timer tries after that, 10 ms apart. */
const WAITS = 50

const hostNotReady = (e: unknown) => e instanceof ReferenceError

/** Registers `spec` with the host, now or as soon as the host has loaded. */
export function register(spec: PanelSpec, tries = 0): void {
  try {
    registerPanel(spec)
  } catch (e) {
    if (!hostNotReady(e)) throw e
    if (tries < TICKS) queueMicrotask(() => register(spec, tries + 1))
    else if (tries < TICKS + WAITS) setTimeout(() => register(spec, tries + 1), 10)
    else console.error(`panels: ${spec.id} was not registered: the panel host never finished loading`)
  }
}

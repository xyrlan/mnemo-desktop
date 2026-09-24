// The scenario registry. A scenario is a named answer to "what does the Rust side say": `ipc`
// answers every `invoke`, `events` are emitted into the page on timers.
//
// Scenarios live one per file in `scenarios/`; each file calls `scenario(...)` at import, and
// `loadScenarios()` imports them all, so adding one never edits a shared file.

import { readdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

/** @typedef {{ event: string; payload: unknown; afterMs?: number }} ScenarioEvent */
/** @typedef {{ ipc: (cmd: string, args: Record<string, unknown>) => unknown; events?: ScenarioEvent[] }} ScenarioSetup */

/** @type {Map<string, ScenarioSetup>} */
const registry = new Map()

/**
 * Registers a scenario. `ipc` may return a value or a promise; throwing (or rejecting) makes the
 * app's `invoke` reject with that error, as a Rust command returning `Err` would. An argument
 * that was a `Channel` in the page arrives as a {@link PreviewChannel}.
 *
 * @param {string} name
 * @param {ScenarioSetup} setup
 * @returns {void}
 */
export function scenario(name, setup) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new Error(`scenario name must be kebab-case: ${JSON.stringify(name)}`)
  }
  if (!setup || typeof setup.ipc !== 'function') throw new Error(`scenario ${name}: setup.ipc must be a function`)
  for (const e of setup.events ?? []) {
    if (typeof e?.event !== 'string') throw new Error(`scenario ${name}: every event needs an \`event\` name`)
    if (e.afterMs !== undefined && !(Number.isFinite(e.afterMs) && e.afterMs >= 0)) {
      throw new Error(`scenario ${name}: afterMs must be a non-negative number (${e.event})`)
    }
  }
  if (registry.has(name)) throw new Error(`scenario ${name} is registered twice`)
  registry.set(name, { ipc: setup.ipc, events: setup.events ?? [] })
}

/** @returns {ScenarioSetup | undefined} */
export const getScenario = (name) => registry.get(name)

export const scenarioNames = () => [...registry.keys()].sort()

const SCENARIO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scenarios')

/** Imports every `scenarios/*.mjs`. */
export async function loadScenarios(dir = SCENARIO_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).sort()
  for (const f of files) await import(pathToFileURL(path.join(dir, f)).href)
}

/**
 * Node's handle on a `Channel` the page passed to a command. `send` delivers one message to the
 * channel's `onmessage`, in order; `sendBytes` sends text or bytes the way Rust sends a
 * `Vec<u8>` (an array of numbers), which is what the pty's output channel carries.
 */
export class PreviewChannel {
  /** @param {number} id @param {(id: number, message: unknown) => Promise<void>} deliver */
  constructor(id, deliver) {
    this.id = id
    this.deliver = deliver
  }
  send(message) {
    return this.deliver(this.id, message)
  }
  sendBytes(data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    return this.send(Array.from(bytes))
  }
}

/** Replaces every `__CHANNEL__:<id>` in the page's args with a {@link PreviewChannel}. */
export function reviveChannels(value, deliver) {
  if (typeof value === 'string') {
    const m = /^__CHANNEL__:(\d+)$/.exec(value)
    return m ? new PreviewChannel(Number(m[1]), deliver) : value
  }
  if (Array.isArray(value)) return value.map((v) => reviveChannels(v, deliver))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveChannels(v, deliver)]))
  }
  return value
}

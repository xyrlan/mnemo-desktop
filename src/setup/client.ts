import type { ToolStatus } from './tools'

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
export type Listen = <T>(event: string, handler: (e: { payload: T }) => void) => Promise<() => void>

/** One progress line of an install, as the Rust side emits it on `tools-install`. */
export type InstallLine = { tool: string; message: string }

export interface SetupClient {
  /** Every tool, re-read from PATH on each call. */
  status(): Promise<ToolStatus[]>
  /** Installs the latest mnemo release into the app's own directory, then `mnemo init`.
   *  Resolves with the installed tag; rejects with what failed. */
  installMnemo(): Promise<string>
  /** Puts the app's tool directories on the user's own PATH; resolves with what changed. */
  addToPath(): Promise<string>
  /** Subscribes to `tools-install` lines; resolves with the unsubscribe once listening. */
  onInstallLine(cb: (line: InstallLine) => void): Promise<() => void>
}

export function makeSetupClient(invoke: Invoke, listen: Listen): SetupClient {
  return {
    status: () => invoke<ToolStatus[]>('tools_status'),
    installMnemo: () => invoke<string>('tools_install_mnemo'),
    addToPath: () => invoke<string>('tools_add_to_path'),
    onInstallLine: (cb) => listen<InstallLine>('tools-install', (e) => cb(e.payload)),
  }
}

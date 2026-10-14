/** What `mcp_socket_path` answers: where the app serves the desktop MCP, or, on a system where
 *  it cannot (Windows, #362), why. `unavailable` comes at the first start only. */
export type Serving = { socket: string | null; unavailable: string | null }

type Warn = (title: string, opts: { id: string; description: string; duration: number }) => unknown

/** Says, once and until dismissed, that the desktop MCP does not work on this system. */
export function sayServing(serving: Serving, warn: Warn): void {
  if (serving.unavailable === null) return
  warn('Desktop MCP not available', { id: 'mcp-unavailable', description: serving.unavailable, duration: Infinity })
}

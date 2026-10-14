/** What nobody needs in the app's first seconds waits for them to pass: the four `--version`
 *  probes of the launch's setup check and the plan-usage read. The first page load starts a
 *  burst of processes (the mission and fleet polls, Home, GitHub, the pane daemon); these come
 *  after it, not inside it (#369). */
export const STARTUP_MS = 3000

/** Resolves `ms` after it is called. */
export function afterStartup(ms = STARTUP_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

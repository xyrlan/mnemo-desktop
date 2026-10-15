import { needsSetup, type ToolStatus } from './tools'

/** The launch check: once `restored` settles, opens setup when `claude` or `mnemo` is missing.
 *  Resolves with whether it opened it. */
export async function openIfMissing(deps: { restored: Promise<unknown>; check: () => Promise<ToolStatus[] | null>; open: () => void }) {
  const [rows] = await Promise.all([deps.check(), deps.restored])
  if (!rows || !needsSetup(rows)) return false
  deps.open()
  return true
}

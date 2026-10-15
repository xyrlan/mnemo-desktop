import { shortcutLabel } from './chords'

/** What a caller registers. It names no shortcut: the chord table (`./chords`) is the one place
 *  an action gets a key, and the label is drawn from it. */
export type ActionDef = { id: string; title: string; run: () => void | Promise<void> }
export type Action = ActionDef & { shortcut?: string }

const actions: ActionDef[] = []
export function register(a: ActionDef) {
  actions.push(a)
}
/** Claims on actions about to run: one that returns true ran it in its own place. The drawer
 *  takes ⌘W and ⇧⌘W (`pane.close`, `tab.close`), which no action of their own runs: they close
 *  what is on top of the Nexus (`nexus/drawer/keys.ts`). */
const claims: ((id: string) => boolean)[] = []
export function claimAction(claim: (id: string) => boolean): () => void {
  claims.push(claim)
  return () => {
    const i = claims.indexOf(claim)
    if (i >= 0) claims.splice(i, 1)
  }
}
export function all(): Action[] {
  return actions.map(({ id, title, run }) => ({ id, title, run, shortcut: shortcutLabel(id) }))
}
export function run(id: string) {
  if (claims.some((c) => c(id))) return
  const a = all().find((x) => x.id === id)
  if (a) void a.run()
}

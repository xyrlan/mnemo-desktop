import type { Store } from '../layout/store'
import { neighbour, type Side } from '../layout/tree'
import { paneRects } from '../layout/rects'
import { cwdForNewShell } from '../layout/cwd'

export type Action = { id: string; title: string; shortcut?: string; run: () => void | Promise<void> }

const actions: Action[] = []
/** Providers contribute actions computed at palette-open time (one per live child, say). */
const providers: (() => Action[])[] = []
export function register(a: Action) {
  actions.push(a)
}
export function registerProvider(p: () => Action[]) {
  providers.push(p)
}
export function all(): Action[] {
  return [...actions, ...providers.flatMap((p) => p())]
}
export function run(id: string) {
  const a = all().find((x) => x.id === id)
  if (a) void a.run()
}

/** Registers the built-in actions against a store. Called once by the app. */
export function registerBuiltins(store: Store) {
  const s = () => store.getState()
  // The nearest pane on screen on that side, which may be in another group (focusing it makes
  // that group active). Panes of tabs not shown are laid out at nothing and are never it.
  const focusToward = (side: Side) => {
    const st = s()
    const tab = st.tabs.find((t) => t.id === st.activeTab)
    if (!tab) return
    const onScreen = new Map([...paneRects()].filter(([, r]) => r.w > 0 && r.h > 0))
    const next = neighbour(tab.focused, side, onScreen)
    if (next !== null) st.focusPane(next)
  }
  // New shells start where you are: the focused pane's directory, or Home's selected repo. A new
  // tab lands in the active group; a split outside a terminal tab is a terminal tab to that side.
  register({ id: 'tab.new', title: 'New tab', shortcut: '⌘T', run: () => s().newTab(cwdForNewShell(s())) })
  register({ id: 'pane.split.row', title: 'Split right', shortcut: '⌘D', run: () => s().split('row', cwdForNewShell(s())) })
  register({ id: 'pane.split.col', title: 'Split down', shortcut: '⌘⇧D', run: () => s().split('col', cwdForNewShell(s())) })
  register({ id: 'pane.close', title: 'Close pane', shortcut: '⌘W', run: () => s().closePane() })
  register({ id: 'pane.close-others', title: 'Close other panes', run: () => s().closeOthers() })
  register({ id: 'tab.close', title: 'Close tab', shortcut: '⌘⇧W', run: () => s().closeTab(s().activeTab) })
  register({
    id: 'pane.new.samecwd',
    title: 'New tab in same directory',
    run: () => {
      const st = s()
      const tab = st.tabs.find((t) => t.id === st.activeTab)
      return st.newTab(tab && st.panes[tab.focused]?.cwd)
    },
  })
  register({ id: 'tab.prev', title: 'Previous tab', shortcut: '⌘⇧[', run: () => s().cycleTab(-1) })
  register({ id: 'tab.next', title: 'Next tab', shortcut: '⌘⇧]', run: () => s().cycleTab(1) })
  for (let i = 1; i <= 9; i++) {
    register({ id: `tab.go.${i}`, title: `Go to tab ${i}`, shortcut: `⌃${i}`, run: () => s().goToTab(i - 1) })
  }
  register({ id: 'focus.left', title: 'Focus pane left', shortcut: '⌘⌥←', run: () => focusToward('left') })
  register({ id: 'focus.right', title: 'Focus pane right', shortcut: '⌘⌥→', run: () => focusToward('right') })
  register({ id: 'focus.up', title: 'Focus pane up', shortcut: '⌘⌥↑', run: () => focusToward('up') })
  register({ id: 'focus.down', title: 'Focus pane down', shortcut: '⌘⌥↓', run: () => focusToward('down') })
  register({
    id: 'pane.toggle-face',
    title: 'Toggle conversation',
    shortcut: '⌘⇧C',
    run: () => {
      const st = s()
      const pane = st.panes[st.tabs.find((t) => t.id === st.activeTab)?.focused ?? NaN]
      if (pane?.view === 'terminal') st.setFace(pane.id, pane.face === 'conversation' ? 'terminal' : 'conversation')
    },
  })
  register({ id: 'palette.open', title: 'Command palette', shortcut: '⌘K', run: () => s().setPalette(true) })
}

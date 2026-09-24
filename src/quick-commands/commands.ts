// adapted from stablyai/orca src/renderer/src/components/terminal-quick-commands/ (the saved
// command's shape and the save rules; Orca's agent prompts, scopes and "append Enter" are not
// ported: a command here belongs to one repo and always runs).

/** One saved command: what the menu shows, and what is typed into the terminal. */
export type QuickCommand = { label: string; command: string }

/** Every repo's commands, by repo root: `Settings['quickCommands']`. */
export type QuickCommands = Record<string, QuickCommand[]>

const NONE: QuickCommand[] = []

/** Repo `root`'s commands, in the order saved. The same empty array for a repo with none, so a
 *  selector that returns it does not re-render forever. */
export function commandsFor(all: QuickCommands | undefined, root: string | null): QuickCommand[] {
  return (root !== null && all?.[root]) || NONE
}

/** `draft` as it is saved — label trimmed, trailing whitespace off the command — or null when
 *  either is empty (Orca's Save stays disabled then). */
export function cleaned(draft: QuickCommand): QuickCommand | null {
  const label = draft.label.trim()
  const command = draft.command.trimEnd()
  return label && command.trim() ? { label, command } : null
}

/** `all` with `root`'s list replaced; a repo left with none is dropped from the record. */
function withList(all: QuickCommands, root: string, list: QuickCommand[]): QuickCommands {
  const next = { ...all }
  if (list.length) next[root] = list
  else delete next[root]
  return next
}

export function withAdded(all: QuickCommands, root: string, cmd: QuickCommand): QuickCommands {
  return withList(all, root, [...commandsFor(all, root), cmd])
}

/** `all` with `root`'s command at `index` replaced; unchanged when there is none there. */
export function withEdited(all: QuickCommands, root: string, index: number, cmd: QuickCommand): QuickCommands {
  const list = commandsFor(all, root)
  if (index < 0 || index >= list.length) return all
  return withList(all, root, list.map((c, i) => (i === index ? cmd : c)))
}

export function withRemoved(all: QuickCommands, root: string, index: number): QuickCommands {
  const list = commandsFor(all, root)
  if (index < 0 || index >= list.length) return all
  return withList(all, root, list.filter((_, i) => i !== index))
}

/** What is typed into the terminal: the command and Enter. A carriage return, as the Enter key
 *  sends, so a Claude pane submits it rather than starting a new line. */
export function keystrokes(cmd: QuickCommand): string {
  return cmd.command + '\r'
}

/** Where a command runs, told from the layout: the focused pane of the tab shown, when it is a
 *  live terminal (a positive id); else null, and the command opens a terminal tab of its own. */
export function focusedTerminal(s: {
  tabs: ReadonlyArray<{ id: string; focused: number }>
  activeTab: string
  panes: Record<number, { view: string } | undefined>
}): number | null {
  const id = s.tabs.find((t) => t.id === s.activeTab)?.focused
  if (id === undefined || id <= 0) return null
  return s.panes[id]?.view === 'terminal' ? id : null
}

/** The repo holding worktree `path` — its root, the key commands are saved under — or null
 *  (no worktree shown, or one the fleet does not know). */
export function repoOf(repos: ReadonlyArray<{ root: string; worktrees: ReadonlyArray<{ path: string }> }>, path: string | null): string | null {
  if (!path) return null
  return repos.find((r) => r.root === path || r.worktrees.some((w) => w.path === path))?.root ?? null
}

export type QuickCommandDeps = {
  /** Every repo's saved commands, now. */
  read(): QuickCommands
  /** Save them all. */
  write(next: QuickCommands): Promise<void>
  /** The layout's focused terminal, or null. */
  focused(): number | null
  writePty(pane: number, data: string): Promise<void>
  /** Open a terminal tab in the shown worktree running `cmd`. */
  openCommandTab(cmd: string): Promise<void>
}

/** The quick commands' actions, over the settings and the layout. */
export function createQuickCommands(deps: QuickCommandDeps) {
  return {
    /** Type `cmd` into the focused terminal, or run it in a new one when none is focused. */
    async run(cmd: QuickCommand): Promise<void> {
      const pane = deps.focused()
      if (pane === null) return deps.openCommandTab(cmd.command)
      return deps.writePty(pane, keystrokes(cmd))
    },
    /** Save `draft` for `root`; false (nothing saved) when it has no label or no command. */
    async add(root: string, draft: QuickCommand): Promise<boolean> {
      const cmd = cleaned(draft)
      if (!cmd) return false
      await deps.write(withAdded(deps.read(), root, cmd))
      return true
    },
    async edit(root: string, index: number, draft: QuickCommand): Promise<boolean> {
      const cmd = cleaned(draft)
      if (!cmd) return false
      await deps.write(withEdited(deps.read(), root, index, cmd))
      return true
    },
    async remove(root: string, index: number): Promise<void> {
      await deps.write(withRemoved(deps.read(), root, index))
    },
  }
}

export type QuickCommandActions = ReturnType<typeof createQuickCommands>

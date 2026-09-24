import { useMemo } from 'react'
import type React from 'react'
import { toast } from '@/ui'
import { store as layout, useApp } from '../layout/app-store'
import { useFleet } from '../fleet/store'
import { tauriPty } from '../pty/client'
import { createQuickCommands, focusedTerminal, repoOf, type QuickCommand, type QuickCommandActions } from './commands'
import { readQuickCommands, useQuickCommands, writeQuickCommands } from './settings'
import { uiStore, useUi } from './app-ui'
import { QuickCommandsButton } from './QuickCommandsButton'
import { QuickCommandDialog } from './QuickCommandDialog'

export const quickCommands: QuickCommandActions = createQuickCommands({
  read: readQuickCommands,
  write: writeQuickCommands,
  focused: () => focusedTerminal(layout.getState()),
  writePty: (pane, data) => tauriPty.write(pane, data),
  openCommandTab: (cmd) => layout.getState().openCommandTab(undefined, cmd),
})

const BLANK: QuickCommand = { label: '', command: '' }

/** A failure is shown, never swallowed. */
const report = (what: string) => (e: unknown) => void toast.error(`${what}: ${e instanceof Error ? e.message : String(e)}`)

/** The titlebar's quick commands, for the repo of the worktree shown, and their dialog. */
export default function QuickCommands({ actions = quickCommands }: { actions?: QuickCommandActions }): React.JSX.Element {
  const shown = useApp((s) => s.activeWorktree)
  const repos = useFleet((f) => f.repos)
  const repo = useMemo(() => {
    const root = repoOf(repos, shown)
    return root === null ? null : { root, name: repos.find((r) => r.root === root)?.name ?? root }
  }, [repos, shown])
  const root = repo?.root ?? null
  const commands = useQuickCommands(root)
  const menuOpen = useUi((s) => s.menuOpen)
  const dialog = useUi((s) => s.dialog)
  const ui = uiStore.getState()
  const editing = dialog?.mode === 'edit' ? commands[dialog.index] : undefined

  return (
    <>
      <QuickCommandsButton
        repoName={repo?.name ?? null}
        commands={commands}
        open={menuOpen}
        onOpenChange={ui.setMenuOpen}
        onRun={(cmd) => void actions.run(cmd).catch(report(`Could not run ${cmd.label}`))}
        onAdd={() => ui.openDialog({ mode: 'add' })}
        onEdit={(index) => ui.openDialog({ mode: 'edit', index })}
        onRemove={(index) => root !== null && void actions.remove(root, index).catch(report('Could not remove the command'))}
      />
      {repo && (
        <QuickCommandDialog
          open={dialog !== null && (dialog.mode === 'add' || editing !== undefined)}
          mode={dialog?.mode ?? 'add'}
          command={editing ?? BLANK}
          repoName={repo.name}
          onOpenChange={(open) => !open && ui.closeDialog()}
          onSave={(cmd) => {
            const saved = dialog?.mode === 'edit' ? actions.edit(repo.root, dialog.index, cmd) : actions.add(repo.root, cmd)
            void saved.catch(report('Could not save the command'))
          }}
          onRemove={dialog?.mode === 'edit' ? () => void actions.remove(repo.root, dialog.index).catch(report('Could not remove the command')) : undefined}
        />
      )}
    </>
  )
}

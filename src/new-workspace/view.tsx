/** The new-workspace composer (spec, *How a parallel agent is born*). It has no pane view: it
 *  lives in `view.tsx` because App imports every `src/*\/view.tsx`, and that import is where it
 *  registers `workspace.new` and mounts the composer and its setup cards in the shell's overlay. */
import { useMemo } from 'react'
import type React from 'react'
import { listen } from '@tauri-apps/api/event'
import { register } from '../actions/registry'
import { store as layout, useApp } from '../layout/app-store'
import { fleetStore, useFleet } from '../fleet/store'
import { homeStore } from '../home/app-store'
import { settingsStore, useSettings } from '../settings/app-store'
import { mountInSlot } from '../shell/slots'
import { dispatchIssue } from '../github/actions'
import { createWorktree } from '../worktrees/client'
import Composer from './Composer'
import SetupProgress from './SetupProgress'
import { createWorkspace, type CreateDeps, type CreateInput } from './create'
import { projectOptions, projectOf } from './projects'
import { createSetupStore } from './setup'
import { openNewWorkspace } from './open'

export const setupStore = createSetupStore()

// One pair of listeners, set up by the first create with a setup command; the events carry the id.
let listening: Promise<unknown> | null = null
function listenSetup(): Promise<void> {
  listening ??= Promise.all([
    listen<{ id: string; line: string }>('job-line', ({ payload: p }) => setupStore.getState().line(p.id, p.line)),
    listen<{ id: string; code: number | null }>('job-exit', ({ payload: p }) => setupStore.getState().exit(p.id, p.code)),
  ]).catch((e) => {
    // Try again on the next create rather than never hearing one.
    listening = null
    throw e
  })
  return listening.then(() => undefined)
}

const deps: CreateDeps = {
  createWorktree,
  switchWorktree: (path) => layout.getState().switchWorktree(path),
  openCommandTab: (cwd, cmd) => layout.getState().openCommandTab(cwd, cmd),
  saveSetup(repo, setup) {
    const all = settingsStore.getState().repoSetup
    if ((all[repo] ?? '') === setup) return
    const next = { ...all }
    if (setup) next[repo] = setup
    else delete next[repo]
    void settingsStore.getState().set('repoSetup', next)
  },
  listenSetup,
  trackSetup: (job, tree) => setupStore.getState().track(job, tree),
  refresh: () => void fleetStore.getState().refresh(),
}

const create = (input: CreateInput) => createWorkspace(deps, input)
const setupFor = (root: string) => settingsStore.getState().repoSetup[root] ?? ''
const setSkip = (v: boolean) => void settingsStore.getState().set('skipPermissions', v)
const modLabel = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'

/** Registers a folder through Home, as Home's own "Open folder" does; its root, or null when
 *  cancelled. Home's refusal (not a git repo) comes back as the rejection. */
async function addProject(): Promise<string | null> {
  const before = homeStore.getState()
  await before.openFolder()
  const after = homeStore.getState()
  if (after.notice && after.notice !== before.notice) throw new Error(after.notice)
  return after.selected !== before.selected ? after.selected : null
}

function NewWorkspace(): React.JSX.Element {
  const repos = useFleet((f) => f.repos)
  const shown = useApp((s) => s.activeWorktree)
  const skipPermissions = useSettings((s) => s.skipPermissions)
  const projects = useMemo(() => projectOptions(repos), [repos])
  const selected = homeStore.getState().selected
  return (
    <>
      <Composer
        projects={projects}
        defaultProject={projectOf(repos, shown) ?? selected ?? null}
        skipPermissions={skipPermissions}
        onSkipPermissionsChange={setSkip}
        setupFor={setupFor}
        onCreate={create}
        onDispatch={dispatchIssue}
        onAddProject={addProject}
        modLabel={modLabel}
      />
      <SetupProgress store={setupStore} onOpen={(path) => void layout.getState().switchWorktree(path)} />
    </>
  )
}

register({ id: 'workspace.new', title: 'New workspace', shortcut: '⌘N', run: () => openNewWorkspace() })

mountInSlot('overlay', NewWorkspace)

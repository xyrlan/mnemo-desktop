import { useContext, useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import { useStore } from 'zustand'
import { toast } from '@/ui'
import { cloneDest, isFolded, visibleRepos, type HomeRepo } from '../../../home/types'
import { cleaned, commandsFor, withAdded, withRemoved, type QuickCommand } from '../../../quick-commands/commands'
import type { SessionSpec } from '../../drawer/open'
import { ProjectsDepsContext, type ProjectsDeps } from './deps'
import { added, cloneBase, cloneCommand, liveSessions, WHERE } from './model'
import '../../ui/ui.css'
import './projects.css'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Starts a session in a drawer tab. The window closes first, so the tab it opens is in view. */
function launch(deps: ProjectsDeps, close: () => void, spec: SessionSpec) {
  close()
  void deps.openSession(spec).catch((e) => void toast.error('Could not open the session', { description: message(e) }))
}

/** The PROJECTS window (spec `2026-10-15-nexus-app-design.md`, Q3, Q4): every repo the app knows,
 *  whether or not a session is live in it. A row has the sessions live in it, **New session**,
 *  **Terminal** and its saved commands, each opening in a drawer tab; saved commands are added and
 *  removed there. The window adds a folder, clones a repo into the clone base, or opens a folder
 *  with `claude` in it. */
export function ProjectsWindow({ close }: { close: () => void }): JSX.Element {
  const deps = useContext(ProjectsDepsContext)
  const snapshot = useStore(deps.home, (s) => s.snapshot)
  const loading = useStore(deps.home, (s) => s.loading)
  const quick = useStore(deps.settings, (s) => s.quickCommands)
  const baseSetting = useStore(deps.settings, (s) => s.cloneBase)
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [showProtected, setShowProtected] = useState(false)
  const [spec, setSpec] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fresh live sessions as it opens; the fleet's poll keeps them after.
  useEffect(() => void deps.home.getState().load().catch(() => {}), [deps])

  const repos = useMemo(() => visibleRepos(snapshot.repos, filter, showHidden, showProtected), [snapshot.repos, filter, showHidden, showProtected])
  const hidden = snapshot.repos.filter((r) => r.hidden).length
  const folded = snapshot.repos.filter(isFolded).length
  const base = cloneBase(baseSetting, snapshot.clone_base)
  const dest = base ? cloneDest(base, spec) : null

  /** Saves `root` as a project, shown again if it was hidden. */
  async function save(root: string) {
    const s = deps.settings.getState()
    const next = added(root, s.projects, s.homeHidden)
    if (next.projects) await s.set('projects', next.projects)
    if (next.hidden) await s.set('homeHidden', next.hidden)
  }

  /** A folder picked and saved as a project; with `open`, `claude` starts in it. */
  async function addFolder(open: boolean) {
    setError(null)
    setBusy(true)
    try {
      const picked = await deps.pickFolder()
      if (!picked) return
      let root: string
      try {
        root = await deps.registerRepo(picked)
      } catch (e) {
        return setError(`${picked}: ${message(e)}`)
      }
      try {
        await save(root)
      } catch (e) {
        setError(`Could not save ${root} as a project: ${message(e)}`)
      }
      void deps.home.getState().load().catch(() => {})
      if (open) launch(deps, close, { kind: 'claude', root })
    } finally {
      setBusy(false)
    }
  }

  async function clone(e: FormEvent) {
    e.preventDefault()
    if (!dest) return
    setError(null)
    try {
      await save(dest)
    } catch (err) {
      return setError(`Could not save ${dest} as a project: ${message(err)}`)
    }
    const name = dest.split(/[/\\]/).pop() ?? dest
    setSpec('')
    launch(deps, close, { kind: 'command', root: base, command: cloneCommand(spec, dest), label: `clone ${name}` })
  }

  async function writeCommands(next: Record<string, QuickCommand[]>) {
    setError(null)
    try {
      await deps.settings.getState().set('quickCommands', next)
    } catch (e) {
      setError(`Could not save the commands: ${message(e)}`)
    }
  }

  return (
    <div className="nx-projects" data-nx-projects="">
      <div className="nx-projects-bar">
        <input className="nx-input nx-projects-filter" placeholder="Filter repos" aria-label="Filter repos" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="nx-btn" disabled={busy} title="Add an existing folder to the list" onClick={() => void addFolder(false)}>
          Add
        </button>
        <button type="button" className="nx-btn" disabled={busy} title="Pick a folder and start claude in it" onClick={() => void addFolder(true)}>
          Open folder
        </button>
      </div>
      <form className="nx-projects-bar" onSubmit={(e) => void clone(e)}>
        <input className="nx-input nx-projects-filter" placeholder="owner/repo or git URL" aria-label="Repo to clone" value={spec} onChange={(e) => setSpec(e.target.value)} />
        <button type="submit" className="nx-btn" disabled={!dest}>
          Clone
        </button>
        <span className="nx-muted nx-projects-base" title={base}>
          {dest ? `into ${dest}` : base ? `into ${base}` : ''}
        </span>
      </form>
      {error && (
        <p className="nx-projects-error" role="alert">
          {error}
          <button type="button" className="nx-projects-x" aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </p>
      )}
      {repos.length === 0 ? (
        <p className="nx-muted nx-projects-empty">
          {loading && snapshot.repos.length === 0 ? 'Reading your repos…' : filter.trim() ? 'No repo matches.' : 'No repos yet. Add a folder or clone one.'}
        </p>
      ) : (
        <div className="nx-projects-list">
          {repos.map((r) => (
            <ProjectRow
              key={r.root}
              repo={r}
              commands={commandsFor(quick, r.root)}
              open={(spec) => launch(deps, close, spec)}
              addCommand={(cmd) => writeCommands(withAdded(quick, r.root, cmd))}
              removeCommand={(i) => void writeCommands(withRemoved(quick, r.root, i))}
            />
          ))}
        </div>
      )}
      {(hidden > 0 || folded > 0) && (
        <div className="nx-projects-folds">
          {folded > 0 && (
            <button type="button" className="nx-projects-link" title="Folders macOS protects (Downloads, Desktop, Documents, volumes)" onClick={() => setShowProtected(!showProtected)}>
              {showProtected ? 'hide protected folders' : `${folded} protected folder${folded === 1 ? '' : 's'} · show`}
            </button>
          )}
          {hidden > 0 && (
            <button type="button" className="nx-projects-link" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? 'hide hidden repos' : `${hidden} hidden repo${hidden === 1 ? '' : 's'} · show`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type RowProps = {
  repo: HomeRepo
  commands: QuickCommand[]
  open(spec: SessionSpec): void
  addCommand(cmd: QuickCommand): Promise<void>
  removeCommand(index: number): void
}

/** One repo: its name and path, the sessions live in it, what starts one, and its saved commands. */
function ProjectRow({ repo, commands, open, addCommand, removeCommand }: RowProps): JSX.Element {
  const live = liveSessions(repo)
  const [draft, setDraft] = useState<QuickCommand | null>(null)
  const ready = draft && cleaned(draft)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    await addCommand(ready)
    setDraft(null)
  }
  return (
    <div className="nx-row nx-project" data-project-root={repo.root}>
      <div className="nx-project-head">
        <span className="nx-project-name">{repo.name}</span>
        <span className="nx-muted nx-project-path" title={repo.root}>
          {repo.root}
        </span>
        <button type="button" className="nx-btn" data-tone="go" onClick={() => open({ kind: 'claude', root: repo.root })}>
          New session
        </button>
        <button type="button" className="nx-btn" onClick={() => open({ kind: 'shell', root: repo.root })}>
          Terminal
        </button>
      </div>
      <div className="nx-project-line" data-project-live="">
        {live.length === 0 ? (
          <span className="nx-faint">no session live</span>
        ) : (
          live.map((s) => (
            <span key={s.id} className="nx-project-session" data-live={s.live} title={`${s.robot ? 'Robot' : 'Captain'} · ${WHERE[s.live]} · ${s.id}`}>
              {s.robot ? '▣' : '●'} {s.title} <span className="nx-muted">· {WHERE[s.live]}</span>
            </span>
          ))
        )}
      </div>
      <div className="nx-project-line" data-project-commands="">
        {commands.map((c, i) => (
          <span key={`${i}:${c.label}`} className="nx-project-cmd">
            <button type="button" className="nx-project-run" title={c.command} onClick={() => open({ kind: 'command', root: repo.root, command: c.command, label: c.label })}>
              ▶ {c.label}
            </button>
            <button type="button" className="nx-projects-x" aria-label={`Remove ${c.label}`} title="Remove this saved command" onClick={() => removeCommand(i)}>
              ×
            </button>
          </span>
        ))}
        {!draft && (
          <button type="button" className="nx-projects-link" onClick={() => setDraft({ label: '', command: '' })}>
            + saved command
          </button>
        )}
      </div>
      {draft && (
        <form className="nx-project-line" onSubmit={(e) => void submit(e)}>
          <input className="nx-input nx-project-label" placeholder="Label" aria-label="Command label" autoFocus value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input className="nx-input nx-project-command" placeholder="Command, as typed in a terminal" aria-label="Command" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
          <button type="submit" className="nx-btn" disabled={!ready}>
            Save
          </button>
          <button type="button" className="nx-btn" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  )
}

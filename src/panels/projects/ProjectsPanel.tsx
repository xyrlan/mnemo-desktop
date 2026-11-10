// The Projects panel: every repo the app knows, whether or not a session is live in it. The
// cursor is on one repo and each thing it can start is one key: Enter a session, S a shell, a
// digit the saved command at that place. Adding a folder, opening one and cloning are at the
// head. What the ship's window did in two clicks and a closing window is one key here.

import { useContext, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useStore } from 'zustand'
import { Figure, Kbd, Label, StateMark } from '../../ds'
import { cloneDest, isFolded, visibleRepos, type HomeRepo } from '../../home/types'
import { added, cloneBase, cloneCommand, liveSessions, WHERE } from '../../nexus/windows/projects/model'
import { basename } from '../../path/path'
import { cleaned, commandsFor, withAdded, withRemoved, type QuickCommand } from '../../quick-commands/commands'
import { actions, type Outcome } from '../../world/actions'
import { openOnStage } from '../../world/route'
import { sessionOf, useWorld } from '../../world/store'
import { closePanel } from '..'
import { ProjectsDepsContext } from './deps'
import { actOf, cursorOf, moved, plural, shortPath } from './model'
import './projects.css'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A text field has the keys: the panel's own are not read there. */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/** What the panel last did, said in place: an outcome's note, a refusal's reason. */
type Said = { tone: 'ok' | 'bad'; text: string }

export function ProjectsPanel() {
  const deps = useContext(ProjectsDepsContext)
  const snapshot = useStore(deps.home, (s) => s.snapshot)
  const loading = useStore(deps.home, (s) => s.loading)
  const quick = useStore(deps.settings, (s) => s.quickCommands)
  const baseSetting = useStore(deps.settings, (s) => s.cloneBase)
  const [filter, setFilter] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [showProtected, setShowProtected] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [spec, setSpec] = useState('')
  const [draftFor, setDraftFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const filterField = useRef<HTMLInputElement>(null)
  const cloneField = useRef<HTMLInputElement>(null)

  // Fresh as it opens; the keys work at once.
  useEffect(() => {
    void deps.home.getState().load().catch(() => {})
    if (!deps.settings.getState().loaded) void deps.settings.getState().load()
    root.current?.focus({ preventScroll: true })
  }, [deps])

  const repos = useMemo(() => visibleRepos(snapshot.repos, filter, showHidden, showProtected), [snapshot.repos, filter, showHidden, showProtected])
  const roots = useMemo(() => repos.map((r) => r.root), [repos])
  const cursor = cursorOf(roots, picked)
  const hidden = snapshot.repos.filter((r) => r.hidden).length
  const folded = snapshot.repos.filter(isFolded).length
  const base = cloneBase(baseSetting, snapshot.clone_base)
  const dest = base ? cloneDest(base, spec) : null

  useEffect(() => {
    if (cursor === null) return
    const row = [...(root.current?.querySelectorAll<HTMLElement>('[data-project-root]') ?? [])].find((el) => el.dataset.projectRoot === cursor)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor])

  const toList = () => root.current?.focus({ preventScroll: true })

  /** An outcome said in place. A plain yes closes the panel: what was started is on stage. */
  function settle(what: string, out: Outcome) {
    if (!out.ok) return setSaid({ tone: 'bad', text: `${what}: ${out.why}` })
    if (out.note) return setSaid({ tone: 'ok', text: `${what}: ${out.note}` })
    closePanel()
  }

  const session = async (repo: HomeRepo) => settle(`New session in ${repo.name}`, await actions().newSession(repo.root))
  const shell = async (repo: HomeRepo) => settle(`Shell in ${repo.name}`, await actions().newShell(repo.root))
  const run = async (repo: HomeRepo, c: QuickCommand) => settle(`${c.label} in ${repo.name}`, await deps.run(repo.root, c.command, c.label))

  /** Saves `path` as a project, shown again if it was hidden. */
  async function save(path: string) {
    const s = deps.settings.getState()
    const next = added(path, s.projects, s.homeHidden)
    if (next.projects) await s.set('projects', next.projects)
    if (next.hidden) await s.set('homeHidden', next.hidden)
  }

  /** A folder picked and saved as a project; with `open`, a session starts in it. */
  async function addFolder(open: boolean) {
    if (busy) return
    setSaid(null)
    setBusy(true)
    try {
      const folder = await deps.pickFolder()
      if (!folder) return
      let at: string
      try {
        at = await deps.registerRepo(folder)
      } catch (e) {
        return setSaid({ tone: 'bad', text: `${folder}: ${message(e)}` })
      }
      try {
        await save(at)
      } catch (e) {
        return setSaid({ tone: 'bad', text: `Could not save ${at} as a project: ${message(e)}` })
      }
      void deps.home.getState().load().catch(() => {})
      setFilter('')
      setPicked(at)
      if (open) settle(`New session in ${basename(at)}`, await actions().newSession(at))
      else setSaid({ tone: 'ok', text: `Added ${basename(at)}.` })
    } finally {
      setBusy(false)
    }
  }

  async function clone(e: FormEvent) {
    e.preventDefault()
    if (!dest) return
    setSaid(null)
    try {
      await save(dest)
    } catch (err) {
      return setSaid({ tone: 'bad', text: `Could not save ${dest} as a project: ${message(err)}` })
    }
    const name = basename(dest)
    const out = await deps.run(base, cloneCommand(spec, dest), `clone ${name}`)
    if (out.ok) setSpec('')
    settle(`Clone ${name}`, out)
  }

  async function writeCommands(next: Record<string, QuickCommand[]>): Promise<boolean> {
    setSaid(null)
    try {
      await deps.settings.getState().set('quickCommands', next)
      return true
    } catch (e) {
      setSaid({ tone: 'bad', text: `Could not save the commands: ${message(e)}` })
      return false
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (typing(e.target)) return
    const act = actOf(e)
    if (!act) return
    const repo = repos.find((r) => r.root === cursor)
    e.preventDefault()
    e.stopPropagation()
    if (act.kind === 'move') return setPicked(moved(roots, cursor, act.by))
    if (act.kind === 'filter') return filterField.current?.focus()
    if (act.kind === 'clone') return cloneField.current?.focus()
    if (act.kind === 'add') return void addFolder(false)
    if (act.kind === 'open-folder') return void addFolder(true)
    if (!repo) return
    if (act.kind === 'session') return void session(repo)
    if (act.kind === 'shell') return void shell(repo)
    if (act.kind === 'save-command') return setDraftFor(repo.root)
    const c = commandsFor(quick, repo.root)[act.index]
    if (c) void run(repo, c)
    else setSaid({ tone: 'bad', text: `${repo.name} has no saved command ${act.index + 1}.` })
  }

  /** Esc in a field gives the keys back to the list instead of closing the panel. */
  const leave = (e: KeyboardEvent<HTMLInputElement>, clear: () => void) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      clear()
      toList()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      toList()
    }
  }

  return (
    <div ref={root} className="mn-projects" data-projects="" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="mn-projects-bar">
        <label className="mn-projects-field">
          <Kbd>/</Kbd>
          <input ref={filterField} placeholder="Filter repos" aria-label="Filter repos" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => leave(e, () => setFilter(''))} />
        </label>
        <button type="button" className="mn-projects-btn" disabled={busy} title="Add an existing folder to the list" onClick={() => void addFolder(false)}>
          <Kbd>A</Kbd> Add folder
        </button>
        <button type="button" className="mn-projects-btn" disabled={busy} title="Pick a folder and start a session in it" onClick={() => void addFolder(true)}>
          <Kbd>O</Kbd> Open folder
        </button>
      </div>
      <form className="mn-projects-bar" onSubmit={(e) => void clone(e)}>
        <label className="mn-projects-field">
          <Kbd>G</Kbd>
          <input ref={cloneField} placeholder="Clone: owner/repo or a git URL" aria-label="Repo to clone" value={spec} onChange={(e) => setSpec(e.target.value)} onKeyDown={(e) => leave(e, () => setSpec(''))} />
        </label>
        <button type="submit" className="mn-projects-btn" disabled={!dest}>
          Clone
        </button>
        <span className="mn-projects-into mn-mono" title={dest ?? base}>
          {dest ? `into ${shortPath(dest)}` : base ? `into ${shortPath(base)}` : ''}
        </span>
      </form>
      {said && (
        <p className="mn-projects-said" data-tone={said.tone} role={said.tone === 'bad' ? 'alert' : 'status'}>
          <span>{said.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setSaid(null)}>
            ×
          </button>
        </p>
      )}
      {repos.length === 0 ? (
        <p className="mn-projects-empty">
          {loading && snapshot.repos.length === 0 ? 'Reading your repos…' : filter.trim() ? `No repo matches “${filter.trim()}”.` : 'No repos yet. Add a folder or clone one.'}
        </p>
      ) : (
        <div className="mn-projects-list" role="list" aria-label="Repos">
          {repos.map((r) => (
            <ProjectRow
              key={r.root}
              repo={r}
              on={r.root === cursor}
              commands={commandsFor(quick, r.root)}
              drafting={draftFor === r.root}
              onPick={() => setPicked(r.root)}
              onSession={() => void session(r)}
              onShell={() => void shell(r)}
              onRun={(c) => void run(r, c)}
              onDraft={(open) => {
                setDraftFor(open ? r.root : null)
                if (!open) toList()
              }}
              addCommand={(cmd) => writeCommands(withAdded(quick, r.root, cmd))}
              removeCommand={(i) => void writeCommands(withRemoved(quick, r.root, i))}
            />
          ))}
        </div>
      )}
      {(hidden > 0 || folded > 0) && (
        <div className="mn-projects-folds">
          {folded > 0 && (
            <button type="button" title="Folders the system protects (Downloads, Desktop, Documents, volumes)" onClick={() => setShowProtected(!showProtected)}>
              {showProtected ? 'hide protected folders' : `${plural(folded, 'protected folder')} · show`}
            </button>
          )}
          {hidden > 0 && (
            <button type="button" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? 'hide hidden repos' : `${plural(hidden, 'hidden repo')} · show`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type RowProps = {
  repo: HomeRepo
  /** The cursor is here: the keys act on this repo. */
  on: boolean
  commands: QuickCommand[]
  drafting: boolean
  onPick(): void
  onSession(): void
  onShell(): void
  onRun(c: QuickCommand): void
  onDraft(open: boolean): void
  addCommand(cmd: QuickCommand): Promise<boolean>
  removeCommand(index: number): void
}

/** One repo: its name and path, the sessions live in it, what starts one, and its saved commands. */
function ProjectRow({ repo, on, commands, drafting, onPick, onSession, onShell, onRun, onDraft, addCommand, removeCommand }: RowProps) {
  const world = useWorld((w) => w)
  const live = liveSessions(repo)
  const [draft, setDraft] = useState<QuickCommand>({ label: '', command: '' })
  const ready = cleaned(draft)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || !(await addCommand(ready))) return
    setDraft({ label: '', command: '' })
    onDraft(false)
  }
  return (
    <div className="mn-projects-row" role="listitem" data-project-root={repo.root} data-on={on || undefined} aria-current={on || undefined} onMouseDown={onPick}>
      <div className="mn-projects-head">
        <span className="mn-projects-name">{repo.name}</span>
        <span className="mn-projects-path mn-mono" title={repo.root}>
          {shortPath(repo.root)}
        </span>
      </div>
      <div className="mn-projects-live" data-project-live="">
        {live.length === 0 ? (
          <span className="mn-projects-none">no session live</span>
        ) : (
          live.map((s) => {
            const known = sessionOf(world, s.id)
            return (
              <button type="button" key={s.id} className="mn-projects-session" data-live={s.live} title={`Open on stage · ${s.robot ? 'dispatched' : 'yours'} · ${WHERE[s.live]}`} onClick={() => openOnStage(known?.id ?? s.id)}>
                <Figure id={known?.id ?? s.id} size={18} />
                {known && <StateMark state={known.state} />}
                <span className="mn-projects-title">{s.title}</span>
                <Label>{s.robot ? 'child' : WHERE[s.live]}</Label>
              </button>
            )
          })
        )}
      </div>
      <div className="mn-projects-acts" data-project-commands="">
        <button type="button" className="mn-projects-btn" data-tone="go" onClick={onSession}>
          {on && <Kbd>Enter</Kbd>} New session
        </button>
        <button type="button" className="mn-projects-btn" onClick={onShell}>
          {on && <Kbd>S</Kbd>} Shell
        </button>
        {commands.map((c, i) => (
          <span key={`${i}:${c.label}`} className="mn-projects-cmd">
            <button type="button" className="mn-projects-btn" title={c.command} onClick={() => onRun(c)}>
              {on && i < 9 && <Kbd>{i + 1}</Kbd>} {c.label}
            </button>
            <button type="button" className="mn-projects-x" aria-label={`Remove ${c.label}`} title="Remove this saved command" onClick={() => removeCommand(i)}>
              ×
            </button>
          </span>
        ))}
        {!drafting && (
          <button type="button" className="mn-projects-link" onClick={() => onDraft(true)}>
            {on && <Kbd>+</Kbd>} save a command
          </button>
        )}
      </div>
      {drafting && (
        <form
          className="mn-projects-draft"
          onSubmit={(e) => void submit(e)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.preventDefault()
            onDraft(false)
          }}
        >
          <input className="mn-projects-label" placeholder="Label" aria-label="Command label" autoFocus value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          <input className="mn-projects-command mn-mono" placeholder="Command, as typed in a terminal" aria-label="Command" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
          <button type="submit" className="mn-projects-btn" disabled={!ready}>
            <Kbd>Enter</Kbd> Save
          </button>
          <button type="button" className="mn-projects-link" onClick={() => onDraft(false)}>
            <Kbd>Esc</Kbd> cancel
          </button>
        </form>
      )}
    </div>
  )
}

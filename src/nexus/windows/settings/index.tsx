import { invoke } from '@tauri-apps/api/core'
import { open as pickFolder } from '@tauri-apps/plugin-dialog'
import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { useFleet } from '../../../fleet/store'
import { loadShells, shells, type Shells } from '../../../pty/shells'
import { onWindows } from '../../../pty/typed'
import { settingsStore, useSettings } from '../../../settings/app-store'
import type { Settings } from '../../../settings/store'
import { registerWindow } from '../../ui/windows'
import './settings.css'

const say = (e: unknown) => (e instanceof Error ? e.message : String(e))
const askShells = () => invoke<Shells>('pty_shells')
const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** Writes a setting; a failure is said under the setting it was for (`settings.set` keeps the
 *  value for this run only then). */
function useSave(): { failed: { key: keyof Settings; why: string } | null; save<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean> } {
  const [failed, setFailed] = useState<{ key: keyof Settings; why: string } | null>(null)
  return {
    failed,
    async save(key, value) {
      setFailed(null)
      try {
        await settingsStore.getState().set(key, value)
        return true
      } catch (e) {
        setFailed({ key, why: say(e) })
        return false
      }
    },
  }
}

/** One setting: its name, what it does in a line, how it is chosen, and why it was not saved. */
function Setting({ name, what, failed, children, id }: { name: string; what: ReactNode; failed?: string; children: ReactNode; id: string }) {
  return (
    <div className="nx-set" data-setting={id}>
      <div className="nx-set-text">
        <div className="nx-set-name">{name}</div>
        <div className="nx-muted">{what}</div>
        {failed && (
          <div role="alert" className="nx-set-err">
            Not saved: {failed}
          </div>
        )}
      </div>
      <div className="nx-set-pick">{children}</div>
    </div>
  )
}

/** A choice among a few, as a row of buttons; the chosen one is pressed. */
function Choice<T extends string | boolean>({ label, value, options, pick }: { label: string; value: T; options: Array<{ value: T; label: string }>; pick(v: T): void }) {
  return (
    <div className="nx-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="nx-btn" aria-pressed={o.value === value} onClick={() => o.value !== value && pick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** The shell a new terminal starts on Windows, among those `pty_shells` found; nothing elsewhere,
 *  or with one shell. */
function WindowsShell({ save, failed }: { save: ReturnType<typeof useSave>['save']; failed?: string }) {
  const [known, setKnown] = useState<Shells | null>(() => shells())
  useEffect(() => {
    void loadShells(askShells).then(setKnown)
  }, [])
  if (!known || known.shells.length < 2) return null
  return (
    <Setting id="windowsShell" name="New terminals start" what="The shell a new terminal starts. Terminals already open keep theirs." failed={failed}>
      <Choice
        label="New terminals start"
        value={known.current ?? ''}
        options={known.shells.map((s) => ({ value: s.id, label: s.label }))}
        pick={async (id) => {
          if (await save('windowsShell', id)) setKnown(await loadShells(askShells))
        }}
      />
    </Setting>
  )
}

/** Where Clone puts a repo: a folder typed or chosen, or the app's default. */
function CloneBase({ save, failed }: { save: ReturnType<typeof useSave>['save']; failed?: string }) {
  const saved = useSettings((s) => s.cloneBase)
  const [typed, setTyped] = useState(saved ?? '')
  useEffect(() => setTyped(saved ?? ''), [saved])
  const next = typed.trim() || null
  return (
    <Setting id="cloneBase" name="Clone into" what="The folder a cloned repo lands in. Empty: the app's default." failed={failed}>
      <form
        className="nx-set-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (next !== saved) void save('cloneBase', next)
        }}
      >
        <input className="nx-input" aria-label="Clone into" placeholder="the app's default" value={typed} onChange={(e) => setTyped(e.target.value)} />
        {next !== saved && (
          <button type="submit" className="nx-btn" data-tone="go">
            Save
          </button>
        )}
        <button
          type="button"
          className="nx-btn"
          onClick={async () => {
            const r = await pickFolder({ directory: true, multiple: false }).catch(() => null)
            if (typeof r === 'string') void save('cloneBase', r)
          }}
        >
          Choose…
        </button>
      </form>
    </Setting>
  )
}

/** The command a repo's new worktree runs once it exists, per repo: changed, removed, or added for a
 *  repo the app knows. */
function RepoSetup({ save, failed }: { save: ReturnType<typeof useSave>['save']; failed?: string }) {
  const all = useSettings((s) => s.repoSetup)
  const projects = useSettings((s) => s.projects)
  const repos = useFleet((f) => f.repos)
  const known = [...new Map([...repos.map((r) => [r.root, r.name] as const), ...projects.map((p) => [p, base(p)] as const)]).entries()].filter(([root]) => !(root in all))
  const [root, setRoot] = useState('')
  const [command, setCommand] = useState('')
  const put = (key: string, cmd: string) => {
    const nextAll = { ...all }
    if (cmd.trim()) nextAll[key] = cmd.trim()
    else delete nextAll[key]
    return save('repoSetup', nextAll)
  }
  return (
    <Setting id="repoSetup" name="Worktree setup" what="A command a repo's new worktree runs once it exists, such as pnpm install." failed={failed}>
      <ul className="nx-set-repos">
        {Object.entries(all).map(([r, cmd]) => (
          <RepoRow key={r} root={r} command={cmd} put={(c) => put(r, c)} />
        ))}
      </ul>
      {known.length > 0 && (
        <form
          className="nx-set-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (root && command.trim() && (await put(root, command))) (setRoot(''), setCommand(''))
          }}
        >
          <select className="nx-input" aria-label="Repo" value={root} onChange={(e) => setRoot(e.target.value)}>
            <option value="">a repo…</option>
            {known.map(([r, name]) => (
              <option key={r} value={r}>
                {name}
              </option>
            ))}
          </select>
          <input className="nx-input" aria-label="Setup command" placeholder="pnpm install" value={command} onChange={(e) => setCommand(e.target.value)} />
          <button type="submit" className="nx-btn" disabled={!root || !command.trim()}>
            Add
          </button>
        </form>
      )}
    </Setting>
  )
}

function RepoRow({ root, command, put }: { root: string; command: string; put(cmd: string): Promise<boolean> }) {
  const [typed, setTyped] = useState(command)
  useEffect(() => setTyped(command), [command])
  return (
    <li className="nx-row" data-repo={root}>
      <span className="nx-set-repo" title={root}>
        {base(root)}
      </span>
      <form
        className="nx-set-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (typed.trim() && typed.trim() !== command) void put(typed)
        }}
      >
        <input className="nx-input" aria-label={`Setup command for ${base(root)}`} value={typed} onChange={(e) => setTyped(e.target.value)} />
        {typed.trim() && typed.trim() !== command && (
          <button type="submit" className="nx-btn" data-tone="go">
            Save
          </button>
        )}
        <button type="button" className="nx-btn" data-tone="danger" aria-label={`Remove the setup command for ${base(root)}`} onClick={() => void put('')}>
          Remove
        </button>
      </form>
    </li>
  )
}

/** SYSTEMS › Settings (spec `2026-10-15-nexus-app-design.md`, Q8): every setting a person chooses
 *  (`src/settings/store.ts`), each with what it does in a line, saved as it is chosen. What the app
 *  keeps for itself (Home's order, the saved commands PROJECTS keeps, the issue filters) is not
 *  here. A settings file that could not be read is said, and nothing is saved until it can be. */
export function SettingsWindow(_props: { close: () => void }): JSX.Element {
  const loaded = useSettings((s) => s.loaded)
  const unreadable = useSettings((s) => s.unreadable)
  const outgoing = useSettings((s) => s.outgoing)
  const reply = useSettings((s) => s.replyLanguage)
  const skip = useSettings((s) => s.skipPermissions)
  const { failed, save } = useSave()
  const why = (key: keyof Settings) => (failed?.key === key ? failed.why : undefined)
  useEffect(() => {
    if (!settingsStore.getState().loaded) void settingsStore.getState().load()
  }, [])
  return (
    <div className="nx-sets" data-nx-settings="">
      {unreadable !== null && (
        <p role="alert" className="nx-set-err nx-set-banner">
          Your settings could not be read: {unreadable}. The defaults are showing, and nothing is saved until that file is fixed or moved away.
        </p>
      )}
      {!loaded && <p className="nx-muted">Reading your settings…</p>}
      <h3 className="nx-section">Replies and dictation</h3>
      <Setting id="outgoing" name="Outgoing text" what="A reply to a dispatched child, and what you dictate: sent as you typed it, or rewritten in English first." failed={why('outgoing')}>
        <Choice
          label="Outgoing text"
          value={outgoing}
          options={[
            { value: 'as-typed', label: 'As typed' },
            { value: 'en', label: 'In English' },
          ]}
          pick={(v) => void save('outgoing', v)}
        />
      </Setting>
      <Setting id="replyLanguage" name="Children answer in" what="A line at the end of a reply to a dispatched child asks it to answer in this language." failed={why('replyLanguage')}>
        <Choice
          label="Children answer in"
          value={reply}
          options={[
            { value: 'unchanged', label: 'Any' },
            { value: 'pt', label: 'Portuguese' },
            { value: 'en', label: 'English' },
          ]}
          pick={(v) => void save('replyLanguage', v)}
        />
      </Setting>
      <h3 className="nx-section">New sessions</h3>
      <Setting
        id="skipPermissions"
        name="Skip permission prompts"
        what={
          <>
            A new session's claude runs with <code>--dangerously-skip-permissions</code>: it never stops to ask before using a tool.
          </>
        }
        failed={why('skipPermissions')}
      >
        <Choice
          label="Skip permission prompts"
          value={skip}
          options={[
            { value: true, label: 'On' },
            { value: false, label: 'Off' },
          ]}
          pick={(v) => void save('skipPermissions', v)}
        />
      </Setting>
      {onWindows() && <WindowsShell save={save} failed={why('windowsShell')} />}
      <h3 className="nx-section">Repos</h3>
      <CloneBase save={save} failed={why('cloneBase')} />
      <RepoSetup save={save} failed={why('repoSetup')} />
    </div>
  )
}

registerWindow({ id: 'settings', title: 'Settings', group: 'systems', order: 50, width: 680, render: (_params, close) => <SettingsWindow close={close} /> })

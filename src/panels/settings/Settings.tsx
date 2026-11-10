// The Settings panel: every setting a person chooses (`src/settings/store.ts`), each with what
// it does in a line, saved as it is chosen; and the build that is running. What the app keeps
// for itself (Home's order, the saved commands, the issue filters) is not here. A settings file
// that could not be read is said, and nothing is saved until it can be.

import { invoke } from '@tauri-apps/api/core'
import { open as pickFolder } from '@tauri-apps/plugin-dialog'
import { useEffect, useState, type ReactNode } from 'react'
import { aboutLine, buildInfo, type BuildInfo } from '../../about/info'
import { newerLine, newerRelease, openRelease, type NewerRelease } from '../../about/release'
import { showClassic } from '../../frame/flag'
import { useKnownRepos } from '../../nexus/repos'
import { basename } from '../../path/path'
import { loadShells, shells, type Shells } from '../../pty/shells'
import { onWindows } from '../../pty/typed'
import { settingsStore, useSettings } from '../../settings/app-store'
import type { Settings } from '../../settings/store'
import type { Language } from '../../voice/client'
import { LANGUAGE_NAMES, LANGUAGES } from '../../voice/controller'
import { chooseLanguage, useDictationLanguage } from '../../voice/language'
import { ArmBtn, Btn, Field, Loading, Notice, say, Section, Seg, short } from '../memory/kit'
import { addable } from './model'
import './settings.css'

const askShells = () => invoke<Shells>('pty_shells')

type Save = <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<boolean>

/** Writes a setting; a failure is said under the setting it was for (`settings.set` keeps the
 *  value for this run only then). */
function useSave(): { failed: { key: keyof Settings; why: string } | null; save: Save } {
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
function Setting({ id, name, what, failed, children, wide }: { id: string; name: string; what: ReactNode; failed?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="settings-item" data-setting={id} data-wide={wide || undefined}>
      <div className="settings-text">
        <div className="settings-name">{name}</div>
        <div className="sp-dim settings-what">{what}</div>
        {failed && (
          <div role="alert" className="settings-err">
            ▲ Not saved: {failed}
          </div>
        )}
      </div>
      <div className="settings-pick">{children}</div>
    </div>
  )
}

/** The shell a new terminal starts on Windows, among those `pty_shells` found; nothing
 *  elsewhere, or with one shell. */
function WindowsShell({ save, failed }: { save: Save; failed?: string }) {
  const [known, setKnown] = useState<Shells | null>(() => shells())
  useEffect(() => {
    void loadShells(askShells).then(setKnown)
  }, [])
  if (!known || known.shells.length < 2) return null
  return (
    <Setting id="windowsShell" name="New terminals start" what="The shell a new terminal starts. Terminals already open keep theirs." failed={failed}>
      <Seg
        label="New terminals start"
        value={known.current ?? ''}
        options={known.shells.map((s) => ({ value: s.id, label: s.label }))}
        onPick={async (id) => {
          if (await save('windowsShell', id)) setKnown(await loadShells(askShells))
        }}
      />
    </Setting>
  )
}

/** The language dictation listens for. It is this machine's, not in the settings file. */
function DictationLanguage() {
  const language = useDictationLanguage()
  const [failed, setFailed] = useState<string>()
  const pick = (l: Language) =>
    void chooseLanguage(l).then(
      () => setFailed(undefined),
      (e: unknown) => setFailed(say(e)),
    )
  return (
    <Setting id="dictationLanguage" name="Dictation language" what="The language dictation listens for. Any detects it on each take, and gets a short one wrong more often." failed={failed}>
      <Seg label="Dictation language" value={language} options={LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))} onPick={pick} />
    </Setting>
  )
}

/** Where Clone puts a repo: a folder typed or chosen, or the app's default. */
function CloneBase({ save, failed }: { save: Save; failed?: string }) {
  const saved = useSettings((s) => s.cloneBase)
  const [typed, setTyped] = useState(saved ?? '')
  useEffect(() => setTyped(saved ?? ''), [saved])
  const next = typed.trim() || null
  return (
    <Setting id="cloneBase" name="Clone into" what="The folder a cloned repo lands in. Empty: the app's default." failed={failed} wide>
      <form
        className="sp-row settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (next !== saved) void save('cloneBase', next)
        }}
      >
        <Field className="sp-grow" aria-label="Clone into" placeholder="the app's default" value={typed} onChange={(e) => setTyped(e.target.value)} />
        {next !== saved && (
          <Btn type="submit" tone="go" small>
            Save
          </Btn>
        )}
        <Btn
          small
          onClick={async () => {
            const r = await pickFolder({ directory: true, multiple: false }).catch(() => null)
            if (typeof r === 'string') void save('cloneBase', r)
          }}
        >
          Choose…
        </Btn>
      </form>
    </Setting>
  )
}

function RepoRow({ root, command, put }: { root: string; command: string; put(cmd: string): Promise<boolean> }) {
  const [typed, setTyped] = useState(command)
  useEffect(() => setTyped(command), [command])
  const name = basename(root)
  const changed = typed.trim() !== '' && typed.trim() !== command
  return (
    <li className="settings-repo" data-repo={root}>
      <span className="settings-repo-name">
        <span className="sp-name sp-clip">{name}</span>
        <span className="sp-dim sp-mono sp-clip">{short(root)}</span>
      </span>
      <form
        className="sp-row settings-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (changed) void put(typed)
        }}
      >
        <Field className="sp-grow sp-mono" aria-label={`Setup command for ${name}`} value={typed} onChange={(e) => setTyped(e.target.value)} />
        {changed && (
          <Btn type="submit" tone="go" small>
            Save
          </Btn>
        )}
        <ArmBtn small aria-label={`Remove the setup command for ${name}`} sure="Remove it? Press again" onConfirm={() => void put('')}>
          Remove
        </ArmBtn>
      </form>
    </li>
  )
}

/** The command a repo's new worktree runs once it exists, per repo: changed, removed, or added
 *  for a repo the app knows. */
function RepoSetup({ save, failed }: { save: Save; failed?: string }) {
  const all = useSettings((s) => s.repoSetup)
  const repos = useKnownRepos()
  const known = addable(repos, all)
  const [root, setRoot] = useState('')
  const [command, setCommand] = useState('')
  const put = (key: string, cmd: string) => {
    const nextAll = { ...all }
    if (cmd.trim()) nextAll[key] = cmd.trim()
    else delete nextAll[key]
    return save('repoSetup', nextAll)
  }
  return (
    <Setting id="repoSetup" name="Worktree setup" what="A command a repo's new worktree runs once it exists, such as pnpm install." failed={failed} wide>
      {Object.keys(all).length > 0 && (
        <ul className="settings-repos">
          {Object.entries(all).map(([r, cmd]) => (
            <RepoRow key={r} root={r} command={cmd} put={(c) => put(r, c)} />
          ))}
        </ul>
      )}
      {known.length > 0 && (
        <form
          className="sp-row settings-form"
          onSubmit={async (e) => {
            e.preventDefault()
            if (root && command.trim() && (await put(root, command))) (setRoot(''), setCommand(''))
          }}
        >
          <select className="sp-input sp-select" aria-label="Repo" value={root} onChange={(e) => setRoot(e.target.value)}>
            <option value="">a repo…</option>
            {known.map((r) => (
              <option key={r.root} value={r.root}>
                {r.name}
              </option>
            ))}
          </select>
          <Field className="sp-grow sp-mono" aria-label="Setup command" placeholder="pnpm install" value={command} onChange={(e) => setCommand(e.target.value)} />
          <Btn type="submit" small disabled={!root || !command.trim()}>
            Add
          </Btn>
        </form>
      )}
    </Setting>
  )
}

/** The way back to the interface the app had before this one. It is a choice of screen, not a
 *  setting of the settings file: it is kept where the app decides which front to mount, and
 *  takes effect by loading the app again (`src/frame/flag.ts`). */
function ClassicInterface({ classic }: { classic: () => string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <Setting
      id="classic"
      name="Classic interface"
      what="The interface the app had before this one. Choosing it loads the app again: your sessions and their terminals stay as they are. Its SYSTEMS menu has New interface, the way back here."
      failed={failed ?? undefined}
    >
      <Btn small onClick={() => setFailed(classic())}>
        Show the classic interface
      </Btn>
    </Setting>
  )
}

/** The build that is running, so a stale bundle reads as stale, with a newer release beside it
 *  when GitHub has one. */
function About() {
  const [build, setBuild] = useState<BuildInfo | null>(null)
  const [newer, setNewer] = useState<NewerRelease | null>(null)
  useEffect(() => {
    let live = true
    void buildInfo().then((b) => live && setBuild(b))
    void newerRelease().then((r) => live && setNewer(r))
    return () => {
      live = false
    }
  }, [])
  const line = aboutLine(build)
  if (!line && !newer) return null
  return (
    <div className="sp-wrap settings-about" data-about="">
      <span className="sp-mono sp-dim">{line}</span>
      {newer && (
        <Btn small tone="go" onClick={() => void openRelease(newer).catch((why) => console.warn('could not open the release page:', why))}>
          {newerLine(newer)}
        </Btn>
      )}
    </div>
  )
}

export function SettingsPanel({ classic = showClassic }: { classic?: () => string | null }) {
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
    <div className="settings sp-root" tabIndex={-1} data-settings-panel="">
      {unreadable !== null && <Notice tone="bad" text={`Your settings could not be read: ${unreadable}. The defaults are showing, and nothing is saved until that file is fixed or moved away.`} />}
      {!loaded && <Loading>reading your settings…</Loading>}
      <Section title="Replies and dictation">
        <Setting id="outgoing" name="Outgoing text" what="A reply to a dispatched child, and what you dictate: sent as you typed it, or rewritten in English first." failed={why('outgoing')}>
          <Seg
            label="Outgoing text"
            value={outgoing}
            options={[
              { value: 'as-typed', label: 'As typed' },
              { value: 'en', label: 'In English' },
            ]}
            onPick={(v) => void save('outgoing', v)}
          />
        </Setting>
        <Setting id="replyLanguage" name="Children answer in" what="A line at the end of a reply to a dispatched child asks it to answer in this language." failed={why('replyLanguage')}>
          <Seg
            label="Children answer in"
            value={reply}
            options={[
              { value: 'unchanged', label: 'Any' },
              { value: 'pt', label: 'Portuguese' },
              { value: 'en', label: 'English' },
            ]}
            onPick={(v) => void save('replyLanguage', v)}
          />
        </Setting>
        <DictationLanguage />
      </Section>
      <Section title="New sessions">
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
          <Seg
            label="Skip permission prompts"
            value={skip}
            options={[
              { value: true, label: 'On' },
              { value: false, label: 'Off' },
            ]}
            onPick={(v) => void save('skipPermissions', v)}
          />
        </Setting>
        {onWindows() && <WindowsShell save={save} failed={why('windowsShell')} />}
      </Section>
      <Section title="Repos">
        <CloneBase save={save} failed={why('cloneBase')} />
        <RepoSetup save={save} failed={why('repoSetup')} />
      </Section>
      <Section title="Interface">
        <ClassicInterface classic={classic} />
      </Section>
      <About />
    </div>
  )
}

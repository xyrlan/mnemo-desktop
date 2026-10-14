import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

/** Outgoing text (replies to children, voice dictation) is rewritten in English
 *  before it leaves when `outgoing` is 'en'; `replyLanguage` asks a child to answer
 *  in that language. Persisted whole to ~/.mnemo-desktop/settings.json. */
export type Settings = {
  outgoing: 'en' | 'as-typed'
  replyLanguage: 'pt' | 'en' | 'unchanged'
  /** Home screen: repo roots pinned to the top / hidden, and where `gh repo clone` lands. */
  homePinned: string[]
  homeHidden: string[]
  cloneBase: string | null
  /** Cockpit and board: the labels the recent-issues filter keeps, per repo root. */
  issueLabels: Record<string, string[]>
  /** A new workspace's `claude` runs with `--dangerously-skip-permissions` (spec, *How a parallel
   *  agent is born*: on by default, the maintainer's call). */
  skipPermissions: boolean
  /** The command a new worktree runs once it exists (`pnpm install`, say), per repo root. */
  repoSetup: Record<string, string>
  /** Repo roots the user added ("Add project", "Open a folder", a clone). Home lists each
   *  whether or not Claude has run there; `forgetProject` takes one out. */
  projects: string[]
  /** The titlebar's saved commands, per repo root, in the order the user keeps them. */
  quickCommands: Record<string, Array<{ label: string; command: string }>>
}

export const DEFAULTS: Settings = {
  outgoing: 'en',
  replyLanguage: 'unchanged',
  homePinned: [],
  homeHidden: [],
  cloneBase: null,
  issueLabels: {},
  skipPermissions: true,
  repoSetup: {},
  projects: [],
  quickCommands: {},
}

export interface SettingsClient {
  read(): Promise<Partial<Settings>>
  write(s: Settings): Promise<void>
}

export type SettingsState = Settings & {
  loaded: boolean
  /** Why the settings file could not be read, when it is there and could not be. What shows is
   *  then the defaults, not what the person saved, and nothing is written while this stands. */
  unreadable: string | null
  load(): Promise<void>
  /** Sets the value and writes the file. Rejects when the file was not written: the value is
   *  then kept for this run only, and the caller says so. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createSettingsStore(client: SettingsClient): StoreApi<SettingsState> {
  /** The read under way or last made: a `set` waits for it, so the defaults never reach the file. */
  let reading: Promise<void> | null = null
  return createZustand<SettingsState>((set, get) => ({
    ...DEFAULTS,
    loaded: false,
    unreadable: null,
    load() {
      reading = (async () => {
        try {
          const v = await client.read()
          set({ ...DEFAULTS, ...pick(v), loaded: true, unreadable: null })
        } catch (e) {
          set({ loaded: true, unreadable: message(e) })
        }
      })()
      return reading
    },
    async set(key, value) {
      if (!get().loaded) await (reading ?? get().load())
      // The file may have been mended or moved away since: ask again before refusing.
      if (get().unreadable !== null) await get().load()
      set({ [key]: value } as Partial<SettingsState>)
      const s = get()
      // Never the defaults over a file that could not be read.
      if (s.unreadable !== null) throw new Error(s.unreadable)
      const whole = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, s[k as keyof Settings]])) as Settings
      await client.write(whole)
    },
  }))
}

function pick(v: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (v.outgoing === 'en' || v.outgoing === 'as-typed') out.outgoing = v.outgoing
  if (v.replyLanguage === 'pt' || v.replyLanguage === 'en' || v.replyLanguage === 'unchanged') out.replyLanguage = v.replyLanguage
  const strs = (x: unknown): string[] | null => (Array.isArray(x) && x.every((s) => typeof s === 'string') ? (x as string[]) : null)
  const pinned = strs(v.homePinned)
  if (pinned) out.homePinned = pinned
  const hidden = strs(v.homeHidden)
  if (hidden) out.homeHidden = hidden
  if (typeof v.cloneBase === 'string' && v.cloneBase) out.cloneBase = v.cloneBase
  if (v.issueLabels && typeof v.issueLabels === 'object' && !Array.isArray(v.issueLabels)) {
    out.issueLabels = Object.fromEntries(Object.entries(v.issueLabels).flatMap(([root, ls]) => (strs(ls) ? [[root, strs(ls)!]] : [])))
  }
  if (typeof v.skipPermissions === 'boolean') out.skipPermissions = v.skipPermissions
  if (v.repoSetup && typeof v.repoSetup === 'object' && !Array.isArray(v.repoSetup)) {
    out.repoSetup = Object.fromEntries(Object.entries(v.repoSetup).filter(([, cmd]) => typeof cmd === 'string' && cmd.trim() !== ''))
  }
  const projects = strs(v.projects)
  if (projects) out.projects = [...new Set(projects.filter((p) => p !== ''))]
  if (v.quickCommands && typeof v.quickCommands === 'object' && !Array.isArray(v.quickCommands)) {
    const ok = (c: unknown): c is { label: string; command: string } =>
      !!c && typeof c === 'object' && typeof (c as { label: unknown }).label === 'string' && typeof (c as { command: unknown }).command === 'string' && (c as { command: string }).command.trim() !== ''
    out.quickCommands = Object.fromEntries(
      Object.entries(v.quickCommands).flatMap(([root, cs]) => {
        const kept = Array.isArray(cs) ? cs.filter(ok).map((c) => ({ label: c.label, command: c.command })) : []
        return kept.length ? [[root, kept]] : []
      }),
    )
  }
  return out
}

/** Footer appended to a message sent to a child so it answers in the chosen language. */
export function replyLanguageFooter(lang: Settings['replyLanguage']): string {
  switch (lang) {
    case 'pt': return '\n\n(Please answer in Portuguese.)'
    case 'en': return '\n\n(Please answer in English.)'
    default: return ''
  }
}

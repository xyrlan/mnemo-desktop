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
}

export interface SettingsClient {
  read(): Promise<Partial<Settings>>
  write(s: Settings): Promise<void>
}

export type SettingsState = Settings & {
  loaded: boolean
  load(): Promise<void>
  set<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
}

export function createSettingsStore(client: SettingsClient): StoreApi<SettingsState> {
  return createZustand<SettingsState>((set, get) => ({
    ...DEFAULTS,
    loaded: false,
    async load() {
      try {
        const v = await client.read()
        set({ ...DEFAULTS, ...pick(v), loaded: true })
      } catch {
        set({ loaded: true })
      }
    },
    async set(key, value) {
      set({ [key]: value } as Partial<SettingsState>)
      const s = get()
      const whole = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, s[k as keyof Settings]])) as Settings
      try {
        await client.write(whole)
      } catch {
        /* keep the in-memory value; the file is a convenience */
      }
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

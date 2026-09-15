import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'

/** Outgoing text (replies to children, voice dictation) is rewritten in English
 *  before it leaves when `outgoing` is 'en'; `replyLanguage` asks a child to answer
 *  in that language. `sidebarScope` narrows the mission sidebar to the focused repo or shows
 *  every repo. Persisted whole to ~/.mnemo-desktop/settings.json. */
export type Settings = {
  outgoing: 'en' | 'as-typed'
  replyLanguage: 'pt' | 'en' | 'unchanged'
  sidebarScope: 'repo' | 'all'
  /** Home screen: repo roots pinned to the top / hidden, and where `gh repo clone` lands. */
  homePinned: string[]
  homeHidden: string[]
  cloneBase: string | null
}

export const DEFAULTS: Settings = { outgoing: 'en', replyLanguage: 'unchanged', sidebarScope: 'repo', homePinned: [], homeHidden: [], cloneBase: null }

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
      const { outgoing, replyLanguage, sidebarScope, homePinned, homeHidden, cloneBase } = get()
      try {
        await client.write({ outgoing, replyLanguage, sidebarScope, homePinned, homeHidden, cloneBase })
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
  if (v.sidebarScope === 'repo' || v.sidebarScope === 'all') out.sidebarScope = v.sidebarScope
  const strs = (x: unknown): string[] | null => (Array.isArray(x) && x.every((s) => typeof s === 'string') ? (x as string[]) : null)
  const pinned = strs(v.homePinned)
  if (pinned) out.homePinned = pinned
  const hidden = strs(v.homeHidden)
  if (hidden) out.homeHidden = hidden
  if (typeof v.cloneBase === 'string' && v.cloneBase) out.cloneBase = v.cloneBase
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

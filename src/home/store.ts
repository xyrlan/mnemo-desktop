import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import type { HomeClient } from './client'
import { cloneDest, EMPTY, whatClickDoes, type HomeRepo, type HomeSession, type HomeSnapshot } from './types'

export type HomeSettings = { homePinned: string[]; homeHidden: string[]; cloneBase: string | null }
export type SetSetting = (key: 'homePinned' | 'homeHidden', value: string[]) => Promise<void>
/** The slice of the layout store Home drives. Injected so tests never touch Tauri. */
export type LayoutLike = {
  readonly panes: Record<number, { id: number; sessionId?: string }>
  openCommandTab(cwd: string | undefined, cmd: string, sessionId?: string): Promise<void>
  newTab(cwd?: string): Promise<void>
  focusPane(id: number): void
}

export type HomeState = {
  snapshot: HomeSnapshot
  loading: boolean
  selected: string | null
  filter: string
  showHidden: boolean
  cloneSpec: string
  /** Roots opened or cloned this run that history does not know yet. */
  extraRoots: string[]
  notice: string | null
}
export type HomeActions = {
  load(): Promise<void>
  select(root: string): void
  setFilter(q: string): void
  setShowHidden(v: boolean): void
  setCloneSpec(s: string): void
  togglePin(root: string): Promise<void>
  toggleHidden(root: string): Promise<void>
  openSession(repo: HomeRepo, s: HomeSession): void
  newSession(root: string): void
  shell(root: string): void
  openFolder(): Promise<void>
  clone(): Promise<void>
  dismiss(): void
}
export type HomeStore = StoreApi<HomeState & HomeActions>

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function createHomeStore(client: HomeClient, settings: () => HomeSettings, setSetting: SetSetting, layout: LayoutLike): HomeStore {
  return createZustand<HomeState & HomeActions>((set, get) => ({
    snapshot: EMPTY,
    loading: false,
    selected: null,
    filter: '',
    showHidden: false,
    cloneSpec: '',
    extraRoots: [],
    notice: null,

    async load() {
      set({ loading: true })
      const s = settings()
      const here = Object.values(layout.panes).map((p) => p.sessionId).filter((x): x is string => !!x)
      try {
        const snapshot = await client.snapshot({ here, pinned: s.homePinned, hidden: s.homeHidden, extraRoots: get().extraRoots })
        const selected = get().selected
        const keep = selected !== null && snapshot.repos.some((r) => r.root === selected)
        set({ snapshot, loading: false, selected: keep ? selected : (snapshot.repos.find((r) => !r.hidden)?.root ?? null) })
      } catch (e) {
        set({ loading: false, notice: String(e) })
      }
    },
    select: (root) => set({ selected: root }),
    setFilter: (filter) => set({ filter }),
    setShowHidden: (showHidden) => set({ showHidden }),
    setCloneSpec: (cloneSpec) => set({ cloneSpec }),
    async togglePin(root) {
      await setSetting('homePinned', toggle(settings().homePinned, root))
      await get().load()
    },
    async toggleHidden(root) {
      await setSetting('homeHidden', toggle(settings().homeHidden, root))
      await get().load()
    },
    openSession(repo, s) {
      const c = whatClickDoes(s, layout.panes)
      if (c.kind === 'focus') layout.focusPane(c.pane)
      else if (c.kind === 'command') void layout.openCommandTab(repo.root, c.cmd, c.sessionId)
      else set({ notice: c.why })
    },
    newSession: (root) => void layout.openCommandTab(root, 'claude'),
    shell: (root) => void layout.newTab(root),
    async openFolder() {
      const picked = await client.pickFolder()
      if (!picked) return
      try {
        const root = await client.registerRepo(picked)
        set((st) => ({ extraRoots: st.extraRoots.includes(root) ? st.extraRoots : [...st.extraRoots, root], selected: root }))
        await get().load()
      } catch (e) {
        set({ notice: String(e) })
      }
    },
    async clone() {
      const base = settings().cloneBase ?? get().snapshot.clone_base
      const spec = get().cloneSpec.trim()
      const dest = cloneDest(base, spec)
      if (!dest) return
      await layout.openCommandTab(base, `gh repo clone ${spec} ${dest}`)
      set((st) => ({ extraRoots: [...st.extraRoots, dest], cloneSpec: '' }))
    },
    dismiss: () => set({ notice: null }),
  }))
}

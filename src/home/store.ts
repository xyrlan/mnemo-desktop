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

/** Home's backend: the snapshot client plus the GitHub read, which only the lens triggers. */
export type LensClient = HomeClient & { refreshGithub(): Promise<void> }

/** `idle`: GitHub not read by this lens yet; `loading`: a read is running. */
export type GithubRead = 'idle' | 'loading' | 'ready'

export type HomeState = {
  snapshot: HomeSnapshot
  loading: boolean
  selected: string | null
  filter: string
  showHidden: boolean
  /** Unresolved protected folders listed without a filter. */
  showProtected: boolean
  cloneSpec: string
  /** Roots opened or cloned this run that history does not know yet. */
  extraRoots: string[]
  notice: string | null
  github: GithubRead
  /** When the last GitHub read finished; null before one did. */
  githubAt: number | null
}
export type HomeActions = {
  load(): Promise<void>
  /** A user's pick. Resolves an unresolved repo; `load` never does, so launch stays quiet. */
  select(root: string): Promise<void>
  /** Read every listed repo's issues and PRs through `gh`, then reload the snapshot that
   *  carries them. Only on the lens showing and its refresh control, never on a timer; a
   *  call while one runs is dropped. */
  refreshGithub(): Promise<void>
  setFilter(q: string): void
  setShowHidden(v: boolean): void
  setShowProtected(v: boolean): void
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

/** `sort_repos` in `src-tauri/src/home.rs`: pinned first, then by last activity, then by name. */
const byRepo = (a: HomeRepo, b: HomeRepo) =>
  Number(b.pinned) - Number(a.pinned) || b.last_at - a.last_at || a.name.localeCompare(b.name)

/** One repo's `pinned` or `hidden` set, and the list put back in the backend's order. The next
 *  snapshot carries the same answer; this is only so a toggle does not wait for one, since that
 *  read walks the session history, asks `claude agents` and probes git per working directory. */
function withFlag(snapshot: HomeSnapshot, root: string, flag: 'pinned' | 'hidden', on: boolean): HomeSnapshot {
  const repos = snapshot.repos.map((r) => (r.root === root ? { ...r, [flag]: on } : r))
  repos.sort(byRepo)
  return { ...snapshot, repos }
}

export function createHomeStore(client: LensClient, settings: () => HomeSettings, setSetting: SetSetting, layout: LayoutLike): HomeStore {
  return createZustand<HomeState & HomeActions>((set, get) => ({
    snapshot: EMPTY,
    loading: false,
    selected: null,
    filter: '',
    showHidden: false,
    showProtected: false,
    cloneSpec: '',
    extraRoots: [],
    notice: null,
    github: 'idle',
    githubAt: null,

    async load() {
      set({ loading: true })
      const s = settings()
      const here = Object.values(layout.panes).map((p) => p.sessionId).filter((x): x is string => !!x)
      try {
        const snapshot = await client.snapshot({ here, pinned: s.homePinned, hidden: s.homeHidden, extraRoots: get().extraRoots })
        const selected = get().selected
        const keep = selected !== null && snapshot.repos.some((r) => r.root === selected)
        // Never an unresolved repo: it may be folded out of the list, and selecting one is a
        // user's act (it runs git where macOS may ask).
        const first = snapshot.repos.find((r) => !r.hidden && !r.unresolved)
        set({ snapshot, loading: false, selected: keep ? selected : (first?.root ?? null) })
      } catch (e) {
        set({ loading: false, notice: String(e) })
      }
    },
    async select(root) {
      set({ selected: root })
      if (!get().snapshot.repos.find((r) => r.root === root)?.unresolved) return
      try {
        set({ selected: await client.resolveRepo(root) })
      } catch (e) {
        set({ notice: String(e) })
      }
      await get().load()
    },
    async refreshGithub() {
      if (get().github === 'loading') return
      set({ github: 'loading' })
      try {
        await client.refreshGithub()
        await get().load()
        set({ github: 'ready', githubAt: Date.now() })
      } catch (e) {
        set({ github: get().githubAt === null ? 'idle' : 'ready', notice: String(e) })
      }
    },
    setFilter: (filter) => set({ filter }),
    setShowHidden: (showHidden) => set({ showHidden }),
    setShowProtected: (showProtected) => set({ showProtected }),
    setCloneSpec: (cloneSpec) => set({ cloneSpec }),
    async togglePin(root) {
      const next = toggle(settings().homePinned, root)
      set({ snapshot: withFlag(get().snapshot, root, 'pinned', next.includes(root)) })
      await setSetting('homePinned', next)
      await get().load()
    },
    async toggleHidden(root) {
      const next = toggle(settings().homeHidden, root)
      set({ snapshot: withFlag(get().snapshot, root, 'hidden', next.includes(root)) })
      await setSetting('homeHidden', next)
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

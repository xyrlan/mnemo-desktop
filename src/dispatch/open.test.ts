import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { createStore, type Store } from '../layout/store'
import { groupIds } from '../layout/groups'
import type { PtyClient } from '../pty/client'
import { child } from '../mission/fixtures'
import type { ChildSession, Snapshot } from '../mission/types'
import { dispatchPane, placeDispatch, VIEW } from './open'
import { arrivals, GRACE_MS, watchDispatches } from './watch'
import { issueKey, waveKey } from './model'
import { seenStore, STORAGE_KEY } from './seen'
import { uiStore } from './store'

function fakePty(): PtyClient {
  let next = 1
  return {
    spawn: async () => next++,
    write: async () => {},
    resize: async () => {},
    kill: async () => {},
    onExit: async () => () => {},
  }
}

const WT = '/code/app-wt-parent'
const OTHER = '/code/app'

/** A layout showing `WT` with one terminal tab (pane 1), and `OTHER` open behind it. */
async function workspace(): Promise<Store> {
  const s = createStore(fakePty())
  await s.getState().switchWorktree(OTHER)
  await s.getState().switchWorktree(WT)
  await s.getState().newTab()
  return s
}

/** Each group's tabs' views, left to right. */
const views = (s: Store) => groupIds(s.getState().groupRoot).map((g) => s.getState().groups[g].tabs.map((t) => s.getState().panes[s.getState().tabs.find((x) => x.id === t)!.focused].view))
const shownView = (s: Store) => {
  const st = s.getState()
  const t = st.tabs.find((x) => x.id === st.activeTab)
  return t ? st.panes[t.focused].view : null
}

describe('placeDispatch', () => {
  it("opens to the right of the parent's terminal and leaves the terminal the tab you are in", async () => {
    const s = await workspace()
    const pane = placeDispatch(s, WT, { beside: 1, focus: false })
    expect(pane).not.toBeNull()
    expect(views(s)).toEqual([['terminal'], [VIEW]])
    expect(shownView(s)).toBe('terminal')
    const st = s.getState()
    // The new group shows the tab, the terminal's group keeps the keys.
    const right = groupIds(st.groupRoot)[1]
    expect(st.groups[right].activeTab).toBe(dispatchPane(st, WT)!.tab)
    expect(st.activeGroup).toBe(groupIds(st.groupRoot)[0])
    expect(st.panes[pane!].props).toEqual({ parent: WT })
  })

  it("goes beside the parent's terminal even while you are in another group", async () => {
    const s = await workspace()
    await s.getState().split('row') // a terminal tab splits inside itself: make a second group instead
    s.getState().openView('editor', { path: '/code/app-wt-parent/a.ts' }, 'split-row')
    const editorGroup = s.getState().activeGroup
    placeDispatch(s, WT, { beside: 1, focus: false })
    const st = s.getState()
    expect(st.activeGroup).toBe(editorGroup)
    expect(shownView(s)).toBe('editor')
    // The editor's group was to the right of the terminal's: the tab joins it, behind the editor.
    expect(views(s)).toEqual([['terminal'], ['editor', VIEW]])
    expect(st.groups[editorGroup].activeTab).toBe(st.activeTab)
  })

  it('takes the focus when asked to (a click)', async () => {
    const s = await workspace()
    placeDispatch(s, WT, { beside: 1, focus: true })
    expect(shownView(s)).toBe(VIEW)
  })

  it('opens one tab per parent: a second ask shows the one there, brought up in its own group', async () => {
    const s = await workspace()
    const first = placeDispatch(s, WT, { beside: 1, focus: false })
    const right = groupIds(s.getState().groupRoot)[1]
    s.getState().focusGroup(right)
    s.getState().openView('editor', { path: '/x.ts' }, 'tab')
    s.getState().focusGroup(groupIds(s.getState().groupRoot)[0])
    expect(placeDispatch(s, WT, { beside: 1, focus: false })).toBe(first)
    expect(views(s)).toEqual([['terminal'], [VIEW, 'editor']])
    expect(s.getState().groups[right].activeTab).toBe(dispatchPane(s.getState(), WT)!.tab)
    expect(shownView(s)).toBe('terminal')
    expect(placeDispatch(s, `${WT}/`, { focus: true })).toBe(first)
    expect(shownView(s)).toBe(VIEW)
  })

  it('does not cover what you look at when the tab shares your group', async () => {
    const s = await workspace()
    s.getState().openView(VIEW, { parent: WT }, 'tab')
    s.getState().activateTab(s.getState().tabs[0].id)
    placeDispatch(s, WT, { beside: 1, focus: false })
    expect(shownView(s)).toBe('terminal')
  })

  it('does nothing for a workspace that is not shown', async () => {
    const s = await workspace()
    expect(placeDispatch(s, OTHER, { focus: true })).toBeNull()
    expect(views(s)).toEqual([['terminal']])
  })

  it('leaves Home shown', async () => {
    const s = await workspace()
    s.getState().showHome()
    placeDispatch(s, WT, { beside: 1, focus: false })
    expect(s.getState().activeTab).toBe('')
    expect(views(s)).toEqual([['terminal'], [VIEW]])
  })
})

const ROOT = '/code/app'
const kid = (id: string, over: Partial<ChildSession> = {}) => child({ id, parent_session: 'p1', cwd: `/code/app-wt-${id}`, ...over })

function snap(missions: [string, ChildSession[]][], children: ChildSession[] = [], over: Partial<Snapshot> = {}): Snapshot {
  return {
    repos: [
      {
        root: ROOT,
        name: 'app',
        parents: [],
        missions: missions.map(([feature, kids]) => ({ feature, contract_path: '', landable: false, pieces: kids.map((c) => ({ name: c.id, branch: `feat/${feature}/${c.id}`, child: c, pr: null })) })),
        children,
      },
    ],
    errors: [],
    at: new Date().toISOString(),
    ...over,
  }
}

describe('arrivals', () => {
  it('names each wave once, by its first child, and each child of no wave on its own', () => {
    const got = arrivals(snap([['w', [kid('a'), kid('b')]]], [kid('i')]), {})
    expect(got.map((g) => [g.key, g.child.id])).toEqual([
      [waveKey(ROOT, 'w'), 'a'],
      [issueKey(ROOT, 'i'), 'i'],
    ])
  })
  it('leaves out what was seen', () => {
    expect(arrivals(snap([['w', [kid('a')]]], [kid('i')]), { [waveKey(ROOT, 'w')]: 0, [issueKey(ROOT, 'i')]: 5 })).toEqual([])
  })
})

describe('watchDispatches', () => {
  let layout: Store
  let mission: StoreApi<{ snapshot: Snapshot }>
  let parentPane: number | null
  let now: number
  let stop: () => void
  const EMPTY: Snapshot = { repos: [], errors: [], at: '' }

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY)
    seenStore.setState({ seen: {} })
    uiStore.setState({ selected: {}, detail: {}, folds: {}, reveal: {} })
    layout = await workspace()
    mission = createZustand<{ snapshot: Snapshot }>(() => ({ snapshot: EMPTY }))
    parentPane = 1
    now = 1234
    stop = watchDispatches({ layout, mission, parentOf: () => WT, paneOf: () => parentPane, now: () => now })
  })
  afterEach(() => stop())

  const dispatchTabs = () => views(layout).flat().filter((v) => v === VIEW).length

  it('opens nothing for what the first snapshot lists, and remembers it as old', () => {
    mission.setState({ snapshot: snap([['old', [kid('a')]]]) })
    expect(dispatchTabs()).toBe(0)
    expect(seenStore.getState().seen).toEqual({ [waveKey(ROOT, 'old')]: 0 })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ [waveKey(ROOT, 'old')]: 0 })
  })

  it("opens beside the parent's terminal when a wave arrives, once, and leaves the keys where they were", () => {
    mission.setState({ snapshot: snap([]) })
    mission.setState({ snapshot: snap([['new', [kid('a')]]]) })
    expect(views(layout)).toEqual([['terminal'], [VIEW]])
    expect(shownView(layout)).toBe('terminal')
    expect(seenStore.getState().seen[waveKey(ROOT, 'new')]).toBe(1234)
    expect(uiStore.getState().reveal[WT]?.target).toBe('a')

    // Closed, it stays closed while the wave goes on.
    void layout.getState().closeTab(dispatchPane(layout.getState(), WT)!.tab)
    mission.setState({ snapshot: snap([['new', [kid('a'), kid('b')]]]) })
    expect(dispatchTabs()).toBe(0)
    // The next wave opens it again.
    mission.setState({ snapshot: snap([['new', [kid('a'), kid('b')]], ['next', [kid('c')]]]) })
    expect(dispatchTabs()).toBe(1)
  })

  it('opens for a child of no wave too', () => {
    mission.setState({ snapshot: snap([]) })
    mission.setState({ snapshot: snap([], [kid('i')]) })
    expect(dispatchTabs()).toBe(1)
  })

  it('opens nothing for a child that is not running', () => {
    mission.setState({ snapshot: snap([]) })
    mission.setState({ snapshot: snap([['ended', [kid('b', { live: false, state: 'done' })]]]) })
    expect(dispatchTabs()).toBe(0)
  })

  it("waits a while for the parent's terminal to be found, then gives up", () => {
    mission.setState({ snapshot: snap([]) })
    parentPane = null
    mission.setState({ snapshot: snap([['late', [kid('a')]], ['never', [kid('b')]]]) })
    expect(dispatchTabs()).toBe(0)
    // Its pane learnt the session a poll later: the wave that arrived opens it.
    parentPane = 1
    now += 3000
    mission.setState({ snapshot: snap([['late', [kid('a')]]]) })
    expect(dispatchTabs()).toBe(1)
    expect(uiStore.getState().reveal[WT]?.target).toBe('a')
    void layout.getState().closeTab(dispatchPane(layout.getState(), WT)!.tab)
    // Past the grace, a terminal found at last opens nothing.
    now += GRACE_MS
    mission.setState({ snapshot: snap([['late', [kid('a')]], ['never', [kid('b')]]]) })
    expect(dispatchTabs()).toBe(0)
  })

  it('opens it when the workspace is shown next, for a parent in one that is not', async () => {
    mission.setState({ snapshot: snap([]) })
    await layout.getState().switchWorktree(OTHER)
    mission.setState({ snapshot: snap([['new', [kid('a')]]]) })
    expect(dispatchTabs()).toBe(0)
    await layout.getState().switchWorktree(WT)
    expect(views(layout)).toEqual([['terminal'], [VIEW]])
    expect(shownView(layout)).toBe('terminal')
  })

  it('does not take a snapshot that failed to list the children for the first one', () => {
    mission.setState({ snapshot: snap([], [], { errors: ['mnemo sessions: not found'] }) })
    mission.setState({ snapshot: snap([['old', [kid('a')]]]) })
    expect(dispatchTabs()).toBe(0)
    expect(seenStore.getState().seen[waveKey(ROOT, 'old')]).toBe(0)
  })
})

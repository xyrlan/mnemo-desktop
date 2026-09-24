import { createOnboardingStore } from './store'

/** A tab strip with just what `stepAside` watches. */
function tabs(start = 'home') {
  let active = start
  const fns = new Set<() => void>()
  return {
    set(id: string) {
      active = id
      fns.forEach((f) => f())
    },
    activeTab: () => active,
    subscribe(fn: () => void) {
      fns.add(fn)
      return () => void fns.delete(fn)
    },
    get watchers() {
      return fns.size
    },
  }
}

test('show opens at setup unless told a step; close closes', () => {
  const s = createOnboardingStore()
  expect(s.getState()).toMatchObject({ open: false, step: 'setup', aside: false })
  s.getState().show()
  expect(s.getState()).toMatchObject({ open: true, step: 'setup' })
  s.getState().show('learned')
  expect(s.getState()).toMatchObject({ open: true, step: 'learned' })
  s.getState().close()
  expect(s.getState().open).toBe(false)
})

test('offer opens a closed dialog, and never moves one the user is in', () => {
  const s = createOnboardingStore()
  s.getState().offer('learned')
  expect(s.getState()).toMatchObject({ open: true, step: 'learned' })

  s.getState().show('setup')
  s.getState().offer('learned')
  expect(s.getState()).toMatchObject({ open: true, step: 'setup' })
})

test('stepAside closes for as long as the installer tab is in front, then comes back at setup', async () => {
  const s = createOnboardingStore()
  const t = tabs()
  s.getState().show('setup')
  await s.getState().stepAside({ open: async () => t.set('install'), activeTab: t.activeTab, subscribe: t.subscribe })
  expect(s.getState()).toMatchObject({ open: false, aside: true })

  // The review's launch check waits while the user is away.
  s.getState().offer('learned')
  expect(s.getState().open).toBe(false)

  t.set('install')
  expect(s.getState().open).toBe(false)
  t.set('home')
  expect(s.getState()).toMatchObject({ open: true, step: 'setup', aside: false })
  expect(t.watchers).toBe(0)
})

test('stepAside stops watching when the dialog is shown or closed by hand meanwhile', async () => {
  const s = createOnboardingStore()
  const t = tabs()
  await s.getState().stepAside({ open: async () => t.set('install'), activeTab: t.activeTab, subscribe: t.subscribe })
  s.getState().close()
  expect(t.watchers).toBe(0)
  t.set('home')
  expect(s.getState().open).toBe(false)

  // Shown by hand while the tab was still coming up: nothing is left watching.
  let opened = () => {}
  const pending = s.getState().stepAside({
    open: () => new Promise<void>((r) => (opened = r)),
    activeTab: t.activeTab,
    subscribe: t.subscribe,
  })
  s.getState().show('learned')
  t.set('install')
  opened()
  await pending
  expect(t.watchers).toBe(0)
  expect(s.getState()).toMatchObject({ open: true, step: 'learned' })
})

test('stepAside comes straight back when no tab came up', async () => {
  const s = createOnboardingStore()
  const t = tabs()
  await s.getState().stepAside({ open: () => Promise.reject(new Error('no pty')), activeTab: t.activeTab, subscribe: t.subscribe })
  expect(s.getState()).toMatchObject({ open: true, step: 'setup', aside: false })
})

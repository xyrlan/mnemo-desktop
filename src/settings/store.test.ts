import { createSettingsStore, replyLanguageFooter, DEFAULTS } from './store'

test('loads persisted values over defaults and ignores junk', async () => {
  const s = createSettingsStore({ read: async () => ({ outgoing: 'as-typed', replyLanguage: 'bogus' as never }), write: async () => {} })
  await s.getState().load()
  expect(s.getState().outgoing).toBe('as-typed')
  expect(s.getState().replyLanguage).toBe(DEFAULTS.replyLanguage)
  expect(s.getState().loaded).toBe(true)
})

test('set persists the whole settings object', async () => {
  const written: unknown[] = []
  const s = createSettingsStore({ read: async () => ({}), write: async (v) => { written.push(v) } })
  await s.getState().set('replyLanguage', 'pt')
  expect(written).toEqual([{ outgoing: 'en', replyLanguage: 'pt', sidebarScope: 'repo', homePinned: [], homeHidden: [], cloneBase: null, issueLabels: {} }])
})

test('sidebarScope defaults to this repo, loads, and persists alongside the rest', async () => {
  const written: unknown[] = []
  const s = createSettingsStore({ read: async () => ({ sidebarScope: 'all', outgoing: 'as-typed' }), write: async (v) => { written.push(v) } })
  expect(s.getState().sidebarScope).toBe('repo')
  await s.getState().load()
  expect(s.getState().sidebarScope).toBe('all')
  await s.getState().set('sidebarScope', 'repo')
  expect(written).toEqual([{ outgoing: 'as-typed', replyLanguage: 'unchanged', sidebarScope: 'repo', homePinned: [], homeHidden: [], cloneBase: null, issueLabels: {} }])
})

test('a junk sidebarScope falls back to the default', async () => {
  const s = createSettingsStore({ read: async () => ({ sidebarScope: 'everything' as never }), write: async () => {} })
  await s.getState().load()
  expect(s.getState().sidebarScope).toBe('repo')
})

test('a failing read still marks loaded', async () => {
  const s = createSettingsStore({ read: async () => { throw new Error('x') }, write: async () => {} })
  await s.getState().load()
  expect(s.getState().loaded).toBe(true)
})

test('reply footers', () => {
  expect(replyLanguageFooter('pt')).toContain('Portuguese')
  expect(replyLanguageFooter('en')).toContain('English')
  expect(replyLanguageFooter('unchanged')).toBe('')
})

test('home keys round-trip and reject junk', async () => {
  let written: unknown = null
  const s = createSettingsStore({
    read: async () => ({ homePinned: ['/a'], homeHidden: 'nope' as unknown as string[], cloneBase: '/gh' }),
    write: async (v) => { written = v },
  })
  await s.getState().load()
  expect(s.getState().homePinned).toEqual(['/a'])
  expect(s.getState().homeHidden).toEqual([])
  expect(s.getState().cloneBase).toBe('/gh')
  await s.getState().set('homeHidden', ['/b'])
  expect((written as { homeHidden: string[] }).homeHidden).toEqual(['/b'])
})

test('issueLabels round-trips per repo and drops junk entries', async () => {
  let written: unknown = null
  const s = createSettingsStore({
    read: async () => ({ issueLabels: { '/gh/a': ['bug', 'ui'], '/gh/b': 'bug' as unknown as string[], '/gh/c': [1] as unknown as string[] } }),
    write: async (v) => { written = v },
  })
  expect(s.getState().issueLabels).toEqual({})
  await s.getState().load()
  expect(s.getState().issueLabels).toEqual({ '/gh/a': ['bug', 'ui'] })
  await s.getState().set('issueLabels', { ...s.getState().issueLabels, '/gh/b': ['feature'] })
  expect((written as { issueLabels: Record<string, string[]> }).issueLabels).toEqual({ '/gh/a': ['bug', 'ui'], '/gh/b': ['feature'] })
  const junk = createSettingsStore({ read: async () => ({ issueLabels: ['bug'] as unknown as Record<string, string[]> }), write: async () => {} })
  await junk.getState().load()
  expect(junk.getState().issueLabels).toEqual({})
})

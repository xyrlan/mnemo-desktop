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
  expect(written).toEqual([{ outgoing: 'en', replyLanguage: 'pt', homePinned: [], homeHidden: [], cloneBase: null, issueLabels: {}, skipPermissions: true, repoSetup: {}, projects: [], quickCommands: {} }])
})

test('a sidebarScope left in an old settings file is dropped, not written back', async () => {
  const written: unknown[] = []
  const s = createSettingsStore({ read: async () => ({ sidebarScope: 'all', outgoing: 'as-typed' }) as never, write: async (v) => { written.push(v) } })
  await s.getState().load()
  expect('sidebarScope' in s.getState()).toBe(false)
  await s.getState().set('outgoing', 'en')
  expect(written).toEqual([{ outgoing: 'en', replyLanguage: 'unchanged', homePinned: [], homeHidden: [], cloneBase: null, issueLabels: {}, skipPermissions: true, repoSetup: {}, projects: [], quickCommands: {} }])
})

const WHOLE = { outgoing: 'en', replyLanguage: 'unchanged', homePinned: [], homeHidden: [], cloneBase: null, issueLabels: {}, skipPermissions: true, repoSetup: {}, projects: [], quickCommands: {} }
const WHY = '/home/u/.mnemo-desktop/settings.json: trailing comma at line 3 column 1'

// #336, expected 1: what `settings_read` now answers for a file that is there and does not parse.
test('a settings file that cannot be read is never written over, and the store says which file and why', async () => {
  const written: unknown[] = []
  let file: 'broken' | 'mended' = 'broken'
  const s = createSettingsStore({
    read: async () => {
      if (file === 'broken') throw WHY
      return { skipPermissions: false, projects: ['/gh/a'] }
    },
    write: async (v) => void written.push(v),
  })
  await s.getState().load()
  expect(s.getState().loaded).toBe(true)
  expect(s.getState().unreadable).toBe(WHY)
  await expect(s.getState().set('outgoing', 'as-typed')).rejects.toThrow(WHY)
  await expect(s.getState().set('skipPermissions', true)).rejects.toThrow(WHY)
  expect(written).toEqual([])
  // Mended by hand while the app runs: the next change reads it, and what was in it is kept.
  file = 'mended'
  await s.getState().set('outgoing', 'as-typed')
  expect(s.getState().unreadable).toBeNull()
  expect(written).toEqual([{ ...WHOLE, outgoing: 'as-typed', skipPermissions: false, projects: ['/gh/a'] }])
})

// #336, expected 2.
test('a set made before the load has returned waits for it, so the defaults never reach the file', async () => {
  const written: unknown[] = []
  let answer!: (v: object) => void
  const s = createSettingsStore({ read: () => new Promise((r) => (answer = r)), write: async (v) => void written.push(v) })
  const loading = s.getState().load()
  const setting = s.getState().set('replyLanguage', 'pt')
  await new Promise((r) => setTimeout(r, 5))
  expect(written).toEqual([])
  answer({ skipPermissions: false, quickCommands: { '/gh/a': [{ label: 'Dev', command: 'pnpm dev' }] } })
  await Promise.all([loading, setting])
  expect(written).toEqual([{ ...WHOLE, replyLanguage: 'pt', skipPermissions: false, quickCommands: { '/gh/a': [{ label: 'Dev', command: 'pnpm dev' }] } }])
})

test('a set with no load made yet loads first', async () => {
  const written: unknown[] = []
  const s = createSettingsStore({ read: async () => ({ skipPermissions: false }), write: async (v) => void written.push(v) })
  await s.getState().set('replyLanguage', 'pt')
  expect(written).toEqual([{ ...WHOLE, replyLanguage: 'pt', skipPermissions: false }])
})

// #336, expected 3.
test('a save that fails is an error the caller sees', async () => {
  let refuse = true
  const written: unknown[] = []
  const s = createSettingsStore({
    read: async () => ({}),
    write: async (v) => {
      if (refuse) throw new Error('settings.json: Access is denied. (os error 5)')
      written.push(v)
    },
  })
  await s.getState().load()
  await expect(s.getState().set('skipPermissions', false)).rejects.toThrow('Access is denied')
  // Kept for this run, and the next save that works carries it.
  expect(s.getState().skipPermissions).toBe(false)
  refuse = false
  await s.getState().set('outgoing', 'as-typed')
  expect(written).toEqual([{ ...WHOLE, skipPermissions: false, outgoing: 'as-typed' }])
})

// #336, expected 4: `settings_read` answers `{}` for a file that is not there.
test('a missing settings file is a first run: the defaults, no complaint, and the first change is saved', async () => {
  const written: unknown[] = []
  const s = createSettingsStore({ read: async () => ({}), write: async (v) => void written.push(v) })
  await s.getState().load()
  expect(s.getState()).toMatchObject({ ...WHOLE, loaded: true, unreadable: null })
  await s.getState().set('skipPermissions', false)
  expect(written).toEqual([{ ...WHOLE, skipPermissions: false }])
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

test('skipPermissions is on unless the file turned it off, and only a boolean turns it off', async () => {
  const on = createSettingsStore({ read: async () => ({ skipPermissions: 'no' as unknown as boolean }), write: async () => {} })
  await on.getState().load()
  expect(on.getState().skipPermissions).toBe(true)
  let written: unknown = null
  const off = createSettingsStore({ read: async () => ({ skipPermissions: false }), write: async (v) => { written = v } })
  await off.getState().load()
  expect(off.getState().skipPermissions).toBe(false)
  await off.getState().set('skipPermissions', true)
  expect((written as { skipPermissions: boolean }).skipPermissions).toBe(true)
})

test('repoSetup keeps a command per repo and drops junk and blank ones', async () => {
  let written: unknown = null
  const s = createSettingsStore({
    read: async () => ({ repoSetup: { '/gh/a': 'pnpm install', '/gh/b': 3 as unknown as string, '/gh/c': '  ' } }),
    write: async (v) => { written = v },
  })
  expect(s.getState().repoSetup).toEqual({})
  await s.getState().load()
  expect(s.getState().repoSetup).toEqual({ '/gh/a': 'pnpm install' })
  await s.getState().set('repoSetup', { ...s.getState().repoSetup, '/gh/b': 'make' })
  expect((written as { repoSetup: Record<string, string> }).repoSetup).toEqual({ '/gh/a': 'pnpm install', '/gh/b': 'make' })
  const junk = createSettingsStore({ read: async () => ({ repoSetup: ['pnpm i'] as unknown as Record<string, string> }), write: async () => {} })
  await junk.getState().load()
  expect(junk.getState().repoSetup).toEqual({})
})

test('projects round-trip, deduped, and junk is dropped', async () => {
  let written: unknown = null
  const s = createSettingsStore({ read: async () => ({ projects: ['/gh/a', '/gh/b', '/gh/a', ''] }), write: async (v) => { written = v } })
  expect(s.getState().projects).toEqual([])
  await s.getState().load()
  expect(s.getState().projects).toEqual(['/gh/a', '/gh/b'])
  await s.getState().set('projects', ['/gh/b'])
  expect((written as { projects: string[] }).projects).toEqual(['/gh/b'])
  const junk = createSettingsStore({ read: async () => ({ projects: ['/gh/a', 3] as unknown as string[] }), write: async () => {} })
  await junk.getState().load()
  expect(junk.getState().projects).toEqual([])
})

test('quickCommands keep each repo\'s valid commands in order and drop junk', async () => {
  let written: unknown = null
  const s = createSettingsStore({
    read: async () => ({
      quickCommands: {
        '/gh/a': [{ label: 'test', command: 'pnpm test', extra: 1 }, { label: 'blank', command: '  ' }, { label: 2, command: 'x' }, { label: 'dev', command: 'pnpm dev' }],
        '/gh/b': 'pnpm test',
        '/gh/c': [null, { command: 'ls' }],
      } as unknown as Record<string, Array<{ label: string; command: string }>>,
    }),
    write: async (v) => { written = v },
  })
  expect(s.getState().quickCommands).toEqual({})
  await s.getState().load()
  expect(s.getState().quickCommands).toEqual({ '/gh/a': [{ label: 'test', command: 'pnpm test' }, { label: 'dev', command: 'pnpm dev' }] })
  await s.getState().set('quickCommands', { ...s.getState().quickCommands, '/gh/b': [{ label: 'up', command: 'make up' }] })
  expect((written as { quickCommands: unknown }).quickCommands).toEqual({
    '/gh/a': [{ label: 'test', command: 'pnpm test' }, { label: 'dev', command: 'pnpm dev' }],
    '/gh/b': [{ label: 'up', command: 'make up' }],
  })
  const junk = createSettingsStore({ read: async () => ({ quickCommands: [] as unknown as Record<string, never> }), write: async () => {} })
  await junk.getState().load()
  expect(junk.getState().quickCommands).toEqual({})
})

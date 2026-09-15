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
  expect(written).toEqual([{ outgoing: 'en', replyLanguage: 'pt' }])
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

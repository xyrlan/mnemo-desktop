import { createMissionStore, foldsOpen } from './store'
import type { MissionClient } from './client'
import type { Snapshot } from './types'

const snap: Snapshot = { repos: [{ root: '/r', name: 'r', parents: [], missions: [], children: [] }], errors: [], at: '1' }

function fake(over: Partial<MissionClient> = {}): MissionClient & { replies: [string, string][]; typed: [string, string][]; lookedMap: Record<string, number> } {
  const replies: [string, string][] = []
  const typed: [string, string][] = []
  const lookedMap: Record<string, number> = { a: 2 }
  return {
    replies,
    typed,
    lookedMap,
    looked: async () => ({ ...lookedMap }),
    snapshot: async () => snap,
    timeline: async () => ({ lines: [], total: 0 }),
    reply: async (id, text) => { replies.push([id, text]) },
    typeAsMe: async (id, text) => { typed.push([id, text]) },
    markLooked: async (id, n) => { lookedMap[id] = n },
    translate: async (t) => `EN(${t})`,
    ...over,
  } as MissionClient & { replies: [string, string][]; typed: [string, string][]; lookedMap: Record<string, number> }
}

test('refresh stores the snapshot and clears the error', async () => {
  const s = createMissionStore(fake())
  await s.getState().refresh(undefined, false)
  expect(s.getState().snapshot.repos[0].name).toBe('r')
  expect(s.getState().lastError).toBeNull()
})

test('refresh failure keeps the previous snapshot and records the error', async () => {
  const c = fake()
  const s = createMissionStore(c)
  await s.getState().refresh(undefined, false)
  c.snapshot = async () => { throw new Error('mnemo missing') }
  await s.getState().refresh(undefined, false)
  expect(s.getState().snapshot.repos).toHaveLength(1)
  expect(s.getState().lastError).toContain('mnemo missing')
})

test('markLooked updates locally and persists', async () => {
  const c = fake()
  const s = createMissionStore(c)
  await s.getState().loadLooked()
  expect(s.getState().looked.a).toBe(2)
  await s.getState().markLooked('b', 5)
  expect(s.getState().looked.b).toBe(5)
  expect(c.lookedMap.b).toBe(5)
})

test('sendReply sends the trimmed draft and clears it; failure keeps the draft', async () => {
  const c = fake()
  const s = createMissionStore(c)
  s.getState().setDraft('x', '  yes  ')
  expect(await s.getState().sendReply('x')).toBe(true)
  expect(c.replies).toEqual([['x', 'yes']])
  expect(s.getState().drafts.x).toBe('')
  expect(await s.getState().sendReply('x')).toBe(false)
  c.reply = async () => { throw new Error('no socket') }
  s.getState().setDraft('x', 'again')
  expect(await s.getState().sendReply('x')).toBe(false)
  expect(s.getState().drafts.x).toBe('again')
  expect(s.getState().replyErrors.x).toContain('no socket')
})

test('sidebar width clamps', () => {
  const s = createMissionStore(fake())
  s.getState().setSidebarWidth(10)
  expect(s.getState().sidebarWidth).toBe(240)
  s.getState().setSidebarWidth(9999)
  expect(s.getState().sidebarWidth).toBe(720)
})

test('sendReply records what was sent so the UI can show it immediately', async () => {
  const s = createMissionStore(fake())
  s.getState().setDraft('x', 'go')
  await s.getState().sendReply('x')
  expect(s.getState().sent.x).toHaveLength(1)
  expect(s.getState().sent.x[0]).toMatchObject({ text: 'go', original: 'go' })
})

test('outgoing=en translates silently and the reply language adds a footer', async () => {
  const c = fake()
  const s = createMissionStore(c, () => ({ outgoing: 'en', replyLanguage: 'pt' }))
  s.getState().setDraft('x', 'pode seguir')
  await s.getState().sendReply('x')
  expect(c.replies[0][1]).toBe('EN(pode seguir)\n\n(Please answer in Portuguese.)')
  expect(s.getState().sent.x[0].original).toBe('pode seguir')
})

test('a failed translation sends the original instead of nothing', async () => {
  const c = fake()
  c.translate = async () => { throw new Error('claude missing') }
  const s = createMissionStore(c, () => ({ outgoing: 'en', replyLanguage: 'unchanged' }))
  s.getState().setDraft('x', 'oi')
  expect(await s.getState().sendReply('x')).toBe(true)
  expect(c.replies[0][1]).toBe('oi')
})

test('translateDraft replaces the draft and reports failures inline', async () => {
  const c = fake()
  const s = createMissionStore(c)
  s.getState().setDraft('x', 'pode seguir')
  expect(await s.getState().translateDraft('x')).toBe(true)
  expect(s.getState().drafts.x).toBe('EN(pode seguir)')
  c.translate = async () => { throw new Error('claude missing') }
  expect(await s.getState().translateDraft('x')).toBe(false)
  expect(s.getState().drafts.x).toBe('EN(pode seguir)')
  expect(s.getState().replyErrors.x).toContain('claude missing')
  expect(await s.getState().translateDraft('none')).toBe(false)
})

test('replyAsMe types the draft exactly as written: no English rewrite, no language footer, nothing on the socket', async () => {
  const c = fake()
  const s = createMissionStore(c, () => ({ outgoing: 'en', replyLanguage: 'pt' }))
  s.getState().setDraft('x', '  pode dar push e abrir o PR  ')
  expect(await s.getState().replyAsMe('x', 'yes')).toBe(true)
  expect(c.typed).toEqual([['x', 'pode dar push e abrir o PR']])
  expect(c.replies).toEqual([])
  expect(s.getState().drafts.x).toBe('')
  expect(s.getState().sent.x[0]).toMatchObject({ text: 'pode dar push e abrir o PR', original: 'pode dar push e abrir o PR', asMe: true })
  expect(s.getState().typing.x).toBe(false)
})

test("replyAsMe refuses the child's own suggested reply, unedited: that would be the child approving itself", async () => {
  const c = fake()
  const s = createMissionStore(c)
  s.getState().setDraft('x', 'yes, push it')
  expect(await s.getState().replyAsMe('x', 'yes, push it ')).toBe(false)
  expect(c.typed).toEqual([])
  expect(s.getState().replyErrors.x).toContain('suggested reply')
  s.getState().setDraft('x', 'yes, push it, and open the PR as a draft')
  expect(await s.getState().replyAsMe('x', 'yes, push it')).toBe(true)
  expect(c.typed).toHaveLength(1)
})

test('replyAsMe failure keeps the draft and shows why, without the Error prefix', async () => {
  const c = fake({ typeAsMe: async () => { throw new Error("x's input already holds \"hm\"") } })
  const s = createMissionStore(c)
  s.getState().setDraft('x', 'go')
  expect(await s.getState().replyAsMe('x', null)).toBe(false)
  expect(s.getState().drafts.x).toBe('go')
  expect(s.getState().replyErrors.x).toBe('x\'s input already holds "hm"')
  expect(s.getState().sent.x).toBeUndefined()
  expect(await s.getState().replyAsMe('empty')).toBe(false)
})

test('folds: andando opens by itself only when nothing needs you, feito starts collapsed', () => {
  expect(foldsOpen({}, 0)).toEqual({ working: true, done: false })
  expect(foldsOpen({}, 2)).toEqual({ working: false, done: false })
  // A click wins over the default, either way.
  expect(foldsOpen({ working: false }, 0)).toEqual({ working: false, done: false })
  expect(foldsOpen({ working: true, done: true }, 2)).toEqual({ working: true, done: true })
})

test('setFold keeps one fold state for every surface, and leaves the other fold alone', () => {
  const s = createMissionStore(fake())
  expect(s.getState().folds).toEqual({})
  s.getState().setFold('done', true)
  s.getState().setFold('working', false)
  expect(s.getState().folds).toEqual({ done: true, working: false })
  s.getState().setFold('done', false)
  expect(s.getState().folds).toEqual({ done: false, working: false })
})

import { describe, expect, it } from 'vitest'
import { complete, EMPTY_HISTORY, HISTORY_SIZE, pushHistory, recallNext, recallPrevious, triggerAt } from './draft'

describe('triggerAt', () => {
  it('opens commands for a slash that begins the draft only', () => {
    expect(triggerAt('/comp', 5)).toEqual({ kind: 'slash', query: 'comp', start: 0, key: 'slash:0' })
    expect(triggerAt('/', 1)).toMatchObject({ kind: 'slash', query: '' })
    expect(triggerAt('see /comp', 9)).toBeNull()
    expect(triggerAt('/compact now', 12)).toBeNull()
  })

  it('opens files for an @ that starts a word, anywhere', () => {
    expect(triggerAt('look at @src/Ap', 15)).toEqual({ kind: 'file', query: 'src/Ap', start: 8, key: 'file:8' })
    expect(triggerAt('@', 1)).toMatchObject({ kind: 'file', query: '', start: 0 })
    expect(triggerAt('mail me@example', 15)).toBeNull()
  })

  it('reads the token up to the caret only', () => {
    expect(triggerAt('fix @src/app.ts please', 11)).toMatchObject({ kind: 'file', query: 'src/ap' })
    expect(triggerAt('fix @src/app.ts please', 22)).toBeNull()
  })
})

describe('complete', () => {
  it('replaces the whole token, even past the caret, and puts the caret after a space', () => {
    const t = triggerAt('fix @src/ap now', 9)!
    expect(complete('fix @src/ap now', t, 9, '@src/app.ts')).toEqual({ draft: 'fix @src/app.ts now', caret: 16 })
  })

  it('completes a command', () => {
    const t = triggerAt('/mo', 3)!
    expect(complete('/mo', t, 3, '/model')).toEqual({ draft: '/model ', caret: 7 })
  })

  it('keeps a line break after the token', () => {
    const t = triggerAt('@a\nnext', 2)!
    expect(complete('@a\nnext', t, 2, '@a.ts')).toEqual({ draft: '@a.ts \nnext', caret: 6 })
  })
})

describe('history', () => {
  it('recalls newest first, then back down to an empty draft', () => {
    let h = pushHistory(pushHistory(EMPTY_HISTORY, 'one'), 'two')
    const a = recallPrevious(h)!
    expect(a.draft).toBe('two')
    const b = recallPrevious(a.history)!
    expect(b.draft).toBe('one')
    expect(recallPrevious(b.history)!.draft).toBe('one')
    const c = recallNext(b.history)!
    expect(c.draft).toBe('two')
    const d = recallNext(c.history)!
    expect(d).toEqual({ history: { entries: ['one', 'two'], index: null }, draft: '' })
    expect(recallNext(d.history)).toBeNull()
    h = pushHistory(h, 'two')
    expect(h.entries).toEqual(['one', 'two'])
  })

  it('keeps nothing blank, nothing twice in a row, and only the last ones', () => {
    expect(pushHistory(EMPTY_HISTORY, '  ').entries).toEqual([])
    expect(recallPrevious(EMPTY_HISTORY)).toBeNull()
    let h = EMPTY_HISTORY
    for (let i = 0; i < HISTORY_SIZE + 5; i++) h = pushHistory(h, `p${i}`)
    expect(h.entries).toHaveLength(HISTORY_SIZE)
    expect(h.entries[0]).toBe('p5')
  })
})

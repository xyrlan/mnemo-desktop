import { share, shareBy } from './share'

describe('share', () => {
  test('a value that says the same thing is the old object itself', () => {
    const prev = { id: 'a', calls: [{ tool: 'Bash', at: 1 }], context: { tokens: 10, series: [[1, 2]] } }
    expect(share(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev)
  })

  test('what changed is new, and everything beside it is still the old object', () => {
    const prev = { said: { text: 'one' }, calls: [{ tool: 'Bash' }, { tool: 'Read' }], context: { tokens: 10 } }
    const next = { said: { text: 'two' }, calls: [{ tool: 'Bash' }, { tool: 'Read' }], context: { tokens: 10 } }
    const out = share(prev, next)
    expect(out).toEqual(next)
    expect(out).not.toBe(prev)
    expect(out.said).not.toBe(prev.said)
    expect(out.calls).toBe(prev.calls)
    expect(out.context).toBe(prev.context)
  })

  test('a list that grew keeps the rows it had', () => {
    const prev = [{ n: 1 }, { n: 2 }]
    const out = share(prev, [{ n: 1 }, { n: 2 }, { n: 3 }])
    expect(out).toHaveLength(3)
    expect(out).not.toBe(prev)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(prev[1])
  })

  test('a list that lost a row, or whose row changed, is a new list', () => {
    const prev = [{ n: 1 }, { n: 2 }]
    expect(share(prev, [{ n: 1 }])).toEqual([{ n: 1 }])
    const out = share(prev, [{ n: 1 }, { n: 5 }])
    expect(out).toEqual([{ n: 1 }, { n: 5 }])
    expect(out[0]).toBe(prev[0])
  })

  test('one field in place of another is a change, even when neither holds a value', () => {
    const prev: Record<string, unknown> = { a: 1, gone: undefined }
    const out = share(prev, { a: 1, came: undefined })
    expect(Object.keys(out)).toEqual(['a', 'came'])
  })

  test('a field that came, went, or turned null is a change', () => {
    expect(share({ a: 1 }, { a: 1, b: undefined })).not.toEqual({ a: 1, c: 0 })
    const prev = { a: 1, b: 2 }
    expect(share(prev, { a: 1 })).toEqual({ a: 1 })
    expect(share(prev, { a: 1 })).not.toBe(prev)
    expect(share({ a: 1 } as Record<string, unknown>, { a: 1, b: undefined })).toHaveProperty('b')
    expect(share({ a: null }, { a: {} })).toEqual({ a: {} })
    expect(share({ a: {} }, { a: null })).toEqual({ a: null })
    expect(share({ a: [] as unknown }, { a: {} })).toEqual({ a: {} })
  })

  test('neither side is changed', () => {
    const prev = Object.freeze({ list: Object.freeze([Object.freeze({ n: 1 })]) })
    const next = Object.freeze({ list: Object.freeze([Object.freeze({ n: 1 }), Object.freeze({ n: 2 })]) })
    expect(() => share(prev, next)).not.toThrow()
  })
})

describe('shareBy', () => {
  const id = (row: { id: string }) => row.id

  test('rows that changed places are still the rows they were', () => {
    const a = { id: 'a', n: 1 }
    const b = { id: 'b', n: 2 }
    const out = shareBy([a, b], [{ id: 'b', n: 2 }, { id: 'a', n: 1 }], id)
    expect(out[0]).toBe(b)
    expect(out[1]).toBe(a)
  })

  test('the same rows in the same places are the old list itself', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    expect(shareBy(prev, [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], id)).toBe(prev)
    expect(shareBy(prev, [{ id: 'a', n: 1 }], id)).not.toBe(prev)
    expect(shareBy(prev, [{ id: 'b', n: 2 }, { id: 'a', n: 1 }], id)).not.toBe(prev)
  })

  test('only the row that changed is new', () => {
    const prev = [{ id: 'a', n: 1 }, { id: 'b', n: 2 }]
    const out = shareBy(prev, [{ id: 'a', n: 1 }, { id: 'b', n: 3 }], id)
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toEqual({ id: 'b', n: 3 })
  })
})

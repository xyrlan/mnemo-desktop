import { describe, expect, it } from 'vitest'
import { showsAsSent, unsettled, type Outgoing } from './outbox'
import type { Card } from './types'

const T = Date.parse('2026-09-25T10:00:00Z')
const iso = (ms: number) => new Date(T + ms).toISOString()
const out = (id: number, text: string, at: number, state: Outgoing['state'] = 'sent', kind: Outgoing['kind'] = 'prompt'): Outgoing => ({ id, kind, text, at: T + at, state })
const said = (id: string, text: string, at: number): Card => ({ kind: 'user', id, at: iso(at), text, images: [], rules: [], queued: false })
const ran = (id: string, args: string, at: number): Card => ({ kind: 'command', id, at: iso(at), name: '!', args })
const ids = (o: Outgoing[]) => o.map((x) => x.id)

describe('unsettled', () => {
  it('keeps a message until a record of it made after it was sent', () => {
    const o = [out(1, 'fix the bug', 0)]
    expect(unsettled(o, [[]])).toBe(o)
    expect(ids(unsettled(o, [[said('u1', 'fix  the\nbug', 900)]]))).toEqual([])
  })

  it('is not settled by the same words said before it was sent', () => {
    const o = [out(1, 'ok', 0, 'sending')]
    expect(ids(unsettled(o, [[said('u0', 'ok', -300)]]))).toEqual([1])
  })

  it('settles two sends of the same words one record each, in order', () => {
    const o = [out(1, 'ok', 0), out(2, 'ok', 100)]
    expect(ids(unsettled(o, [[said('u1', 'ok', 500)]]))).toEqual([2])
    expect(ids(unsettled(o, [[said('u1', 'ok', 500), said('u2', 'ok', 700)]]))).toEqual([])
  })

  it('takes a record with other words only for a message that was delivered, and only one not claimed by its own', () => {
    // Claude Code rewrote it (an image, a paste): the next prompt after it is its record.
    expect(ids(unsettled([out(1, 'see [Image #1]', 0)], [[said('u1', 'see', 400)]]))).toEqual([])
    // Still being typed: a prompt from the terminal is not taken for it.
    expect(ids(unsettled([out(1, 'mine', 0, 'sending')], [[said('u1', 'typed by hand', 400)]]))).toEqual([1])
    // Its words beat order: the second send's record is not taken by the first.
    expect(ids(unsettled([out(1, 'one', 0), out(2, 'two', 100)], [[said('u2', 'two', 400)]]))).toEqual([])
  })

  it('drops a delivered message once a later one is recorded: it never will be', () => {
    const o = [out(1, 'blocked by a hook', 0), out(2, 'next', 100, 'sending')]
    expect(ids(unsettled(o, [[said('u2', 'next', 400)]]))).toEqual([])
  })

  it('keeps a failed message, which no record settles', () => {
    const o = [out(1, 'lost', 0, 'failed')]
    expect(unsettled(o, [[said('u1', 'lost', 400)]])).toBe(o)
    expect(ids(unsettled([...o, out(2, 'again', 100)], [[said('u1', 'again', 400)]]))).toEqual([1])
  })

  it('settles a shell command by its `!` record only', () => {
    const cmd = out(1, 'git status', 0, 'sent', 'bash')
    expect(ids(unsettled([cmd], [[said('u1', 'git status', 400)]]))).toEqual([1])
    expect(ids(unsettled([cmd], [[ran('b1', 'git status', 400)]]))).toEqual([])
    expect(ids(unsettled([out(1, 'hi', 0)], [[ran('b1', 'hi', 400)]]))).toEqual([1])
  })

  it('reads every followed transcript: a record before a /clear still counts', () => {
    const o = [out(1, 'before the clear', 0)]
    expect(ids(unsettled(o, [[said('u1', 'before the clear', 300)], []]))).toEqual([])
  })
})

it('draws prompts and shell commands, not slash commands', () => {
  expect(showsAsSent('prompt', 'fix it')).toBe(true)
  expect(showsAsSent('prompt', '  /config')).toBe(false)
  expect(showsAsSent('bash', '/bin/ls')).toBe(true)
})

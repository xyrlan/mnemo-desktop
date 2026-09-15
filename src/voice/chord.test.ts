import { afterEach, describe, expect, it, vi } from 'vitest'
import { installChord, isDictationChord } from './chord'

const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit) =>
  new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init })

let uninstall = () => {}
afterEach(() => uninstall())

describe('dictation chord', () => {
  it('matches ⌥Space by code, whatever character it types', () => {
    expect(isDictationChord(key('keydown', { code: 'Space', key: ' ', altKey: true }))).toBe(true)
    expect(isDictationChord(key('keydown', { code: 'Space', key: ' ' }))).toBe(false)
    expect(isDictationChord(key('keydown', { code: 'Space', altKey: true, metaKey: true }))).toBe(false)
    expect(isDictationChord(key('keydown', { code: 'KeyA', altKey: true }))).toBe(false)
  })

  it('press begins once, releasing Space or ⌥ ends, and the terminal never sees the chord', () => {
    const voice = { begin: vi.fn(), end: vi.fn() }
    uninstall = installChord(voice)
    const seen = vi.fn()
    document.body.addEventListener('keydown', seen)

    const press = key('keydown', { code: 'Space', altKey: true })
    document.body.dispatchEvent(press)
    document.body.dispatchEvent(key('keydown', { code: 'Space', altKey: true, repeat: true }))
    expect(voice.begin).toHaveBeenCalledOnce()
    expect(press.defaultPrevented).toBe(true)
    expect(seen).not.toHaveBeenCalled()

    document.body.dispatchEvent(key('keyup', { key: 'Alt', code: 'AltLeft' }))
    expect(voice.end).toHaveBeenCalledOnce()
    document.body.dispatchEvent(key('keyup', { code: 'Space', key: ' ' }))
    expect(voice.end).toHaveBeenCalledOnce()

    document.body.dispatchEvent(key('keydown', { code: 'Space', altKey: true }))
    document.body.dispatchEvent(key('keyup', { code: 'Space', altKey: true }))
    expect(voice.begin).toHaveBeenCalledTimes(2)
    expect(voice.end).toHaveBeenCalledTimes(2)
    document.body.removeEventListener('keydown', seen)
  })

  it('leaving the window mid-take ends it', () => {
    const voice = { begin: vi.fn(), end: vi.fn() }
    uninstall = installChord(voice)
    window.dispatchEvent(new Event('blur'))
    expect(voice.end).not.toHaveBeenCalled()
    document.body.dispatchEvent(key('keydown', { code: 'Space', altKey: true }))
    window.dispatchEvent(new Event('blur'))
    expect(voice.end).toHaveBeenCalledOnce()
  })
})

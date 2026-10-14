import { describe, expect, it, vi } from 'vitest'

// A plain recorder, not vi.fn(): the controller's rejections are strings.
// Hoisted with the mocks: `./view` calls invoke as it is imported.
const { calls, languages } = vi.hoisted(() => ({ calls: [] as string[], languages: [] as string[] }))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args?: { language?: string }) => {
    calls.push(cmd)
    if (cmd === 'voice_set_language') languages.push(args!.language!)
    return cmd === 'voice_stop' ? '' : null
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { all, run } from '../actions/registry'
import { slotEntries } from '../shell/slots'
import './view'

describe('voice view', () => {
  it('registers dictation.toggle: the first run starts listening, the second stops', async () => {
    expect(all().filter((a) => a.id === 'dictation.toggle')).toHaveLength(1)
    run('dictation.toggle')
    await vi.waitFor(() => expect(calls).toContain('voice_start'))
    expect(calls).not.toContain('voice_stop')
    run('dictation.toggle')
    await vi.waitFor(() => expect(calls).toContain('voice_stop'))
  })

  it('names the hold chord where dictation is offered', () => {
    const title = all().find((a) => a.id === 'dictation.toggle')!.title
    expect(title).toMatch(/hold (⌥Space|Alt\+Space)/)
  })

  it('offers each dictation language by name; a first run starts on the system language, unsaved', async () => {
    // jsdom's navigator.languages is ['en-US'].
    expect(navigator.languages[0]).toMatch(/^en/)
    const titles = () => all().filter((a) => a.id.startsWith('voice.language.')).map((a) => a.title)
    expect(titles()).toEqual([
      'Dictation language: Portuguese',
      'Dictation language: English (current)',
      'Dictation language: any (detected per take)',
    ])
    await vi.waitFor(() => expect(languages).toEqual(['en']))
    expect(localStorage.getItem('mnemo.voice.language')).toBeNull()

    run('voice.language.pt')
    await vi.waitFor(() => expect(languages).toEqual(['en', 'pt']))
    expect(localStorage.getItem('mnemo.voice.language')).toBe('pt')
    await vi.waitFor(() => expect(titles()[0]).toBe('Dictation language: Portuguese (current)'))
  })

  it('mounts the indicator in the overlay slot', () => {
    expect(slotEntries('overlay').map((e) => e.component.name)).toContain('DictationIndicator')
  })
})

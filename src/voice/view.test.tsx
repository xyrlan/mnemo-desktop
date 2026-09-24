import { describe, expect, it, vi } from 'vitest'

// A plain recorder, not vi.fn(): the controller's rejections are strings.
const calls: string[] = []
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => {
    calls.push(cmd)
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

  it('mounts the indicator in the overlay slot', () => {
    expect(slotEntries('overlay').map((e) => e.component.name)).toContain('DictationIndicator')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceClient } from './client'
import { createVoice, nextLanguage, type VoiceDeps } from './controller'
import type { Target } from './route'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

const PTY: Target = { kind: 'pty', pane: 1 }

function setup(overrides: Partial<VoiceClient> = {}, landed = true) {
  const client: VoiceClient = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => 'hello world'),
    setLanguage: vi.fn(async () => {}),
    onProgress: vi.fn(async () => () => {}),
    ...overrides,
  }
  const deps: VoiceDeps = { client, target: vi.fn(() => PTY), insert: vi.fn(async () => landed), linger: 2000 }
  const voice = createVoice(deps)
  return { voice, client, deps, phase: () => voice.store.getState().phase }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('voice controller', () => {
  it('press listens, release transcribes into the target resolved at press, then fades', async () => {
    const { voice, client, deps, phase } = setup()
    voice.begin()
    expect(phase()).toEqual({ kind: 'listening' })
    expect(deps.target).toHaveBeenCalledOnce()
    await voice.end()
    expect(client.stop).toHaveBeenCalledOnce()
    expect(deps.insert).toHaveBeenCalledWith(PTY, 'hello world')
    expect(phase()).toEqual({ kind: 'done', text: 'hello world', landed: true })
    vi.advanceTimersByTime(2000)
    expect(phase()).toEqual({ kind: 'idle' })
  })

  it('a release before the microphone opens still stops after it does', async () => {
    const opening = deferred<void>()
    const { voice, client, phase } = setup({ start: vi.fn(() => opening.promise) })
    voice.begin()
    const ending = voice.end()
    expect(client.stop).not.toHaveBeenCalled()
    opening.resolve()
    await ending
    expect(client.stop).toHaveBeenCalledOnce()
    expect(phase().kind).toBe('done')
  })

  it('ignores a second press while a take is open or transcribing', async () => {
    const stopping = deferred<string>()
    const { voice, client, deps } = setup({ stop: vi.fn(() => stopping.promise) })
    voice.begin()
    voice.begin()
    const ending = voice.end()
    await vi.waitFor(() => expect(client.stop).toHaveBeenCalled())
    voice.begin()
    expect(client.start).toHaveBeenCalledOnce()
    stopping.resolve('ok')
    await ending
    expect(deps.insert).toHaveBeenCalledOnce()
    voice.begin()
    expect(client.start).toHaveBeenCalledTimes(2)
  })

  it('shows a failed start and lets the next press try again', async () => {
    const start = vi.fn().mockRejectedValueOnce('no microphone found').mockResolvedValue(undefined)
    const { voice, client, phase } = setup({ start })
    voice.begin()
    await vi.waitFor(() => expect(phase()).toEqual({ kind: 'error', message: 'no microphone found' }))
    await voice.end()
    expect(client.stop).not.toHaveBeenCalled()
    voice.begin()
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('discards a take a reloaded webview left open', async () => {
    const start = vi.fn().mockRejectedValueOnce('already recording').mockResolvedValue(undefined)
    const { voice, client, phase } = setup({ start })
    voice.begin()
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(client.stop).toHaveBeenCalledOnce()
    expect(phase()).toEqual({ kind: 'listening' })
  })

  it('reports silence and failures without inserting', async () => {
    const quiet = setup({ stop: vi.fn(async () => '') })
    quiet.voice.begin()
    await quiet.voice.end()
    expect(quiet.deps.insert).not.toHaveBeenCalled()
    expect(quiet.phase()).toEqual({ kind: 'note', text: 'no speech heard' })

    const broken = setup({ stop: vi.fn(async () => Promise.reject(new Error('whisper: boom'))) })
    broken.voice.begin()
    await broken.voice.end()
    expect(broken.phase()).toEqual({ kind: 'error', message: 'whisper: boom' })
  })

  it('says so when the transcript had nowhere to land', async () => {
    const { voice, phase } = setup({}, false)
    voice.begin()
    await voice.end()
    expect(phase()).toEqual({ kind: 'done', text: 'hello world', landed: false })
  })

  it('toggle starts, then stops (the palette action)', async () => {
    const { voice, client, phase } = setup()
    await voice.toggle()
    expect(phase().kind).toBe('listening')
    await voice.toggle()
    expect(client.stop).toHaveBeenCalledOnce()
    expect(phase().kind).toBe('done')
  })

  it('tracks the model download fraction', () => {
    const { voice } = setup()
    voice.progress({ downloaded: 25, total: 100 })
    expect(voice.store.getState().download).toBe(0.25)
    voice.progress({ downloaded: 100, total: 100 })
    expect(voice.store.getState().download).toBeNull()
  })

  it('clears a download bar when the take ends, even if the download failed', async () => {
    const { voice } = setup({
      stop: vi.fn(async () => {
        voice.progress({ downloaded: 10, total: 100 })
        throw 'model download: offline'
      }),
    })
    voice.begin()
    await voice.end()
    expect(voice.store.getState()).toEqual({ phase: { kind: 'error', message: 'model download: offline' }, download: null })
  })

  it('cycles languages auto → pt → en → auto', () => {
    expect(nextLanguage('auto')).toBe('pt')
    expect(nextLanguage('pt')).toBe('en')
    expect(nextLanguage('en')).toBe('auto')
  })
})

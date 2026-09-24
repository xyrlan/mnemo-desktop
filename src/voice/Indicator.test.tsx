import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/ui'
import { createVoice, type Phase, type Voice } from './controller'
import type { VoiceClient } from './client'
import { Indicator } from './Indicator'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let voice: Voice
let stop: () => Promise<string>
const onStop = vi.fn()

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  stop = async () => 'hello world'
  const client: VoiceClient = {
    start: async () => {},
    stop: () => stop(),
    setLanguage: async () => {},
    onProgress: async () => () => {},
  }
  // The real controller's live zustand store: a selector that built a new object each read
  // would loop here (#212).
  voice = createVoice({ client, target: () => ({ kind: 'pty', pane: 1 }), insert: async () => true, linger: 60_000 })
  onStop.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function draw() {
  const errors: unknown[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a))
  await act(async () => {
    root.render(
      <TooltipProvider>
        <Indicator store={voice.store} shortcut={['⌘', 'E']} onStop={onStop} />
      </TooltipProvider>,
    )
  })
  spy.mockRestore()
  expect(errors).toEqual([])
}

const indicator = () => host.querySelector<HTMLElement>('[data-testid="dictation-indicator"]')
const stopButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Stop dictation"]')
const status = () => host.querySelector('[role="status"]')?.textContent
const set = (phase: Phase, download: number | null = null) => act(() => voice.store.setState({ phase, download }))

describe('dictation indicator', () => {
  it('draws nothing while idle', async () => {
    await draw()
    expect(indicator()).toBeNull()
  })

  it('follows a take through the real controller: starting, listening, then the transcript', async () => {
    await draw()
    await act(async () => voice.begin())
    expect(indicator()?.dataset.phase).toBe('listening')
    expect(status()).toBe('Listening')
    expect(indicator()!.className).toContain('rounded-full')
    expect(indicator()!.hasAttribute('data-ui')).toBe(true)

    await act(async () => voice.end())
    expect(status()).toBe('Dictated')
    expect(stopButton()).toBeNull()
    expect(host.querySelector('p')?.textContent).toBe('hello world')
    expect(indicator()!.className).toContain('rounded-xl')
  })

  it('shows Starting mic… with Stop, and Stop calls back without moving focus', async () => {
    await draw()
    set({ kind: 'starting' })
    expect(status()).toBe('Starting mic…')
    const button = stopButton()!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => button.click())
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('has no Stop while processing, and says when it waits for the model', async () => {
    await draw()
    set({ kind: 'transcribing' })
    expect(status()).toBe('Processing…')
    expect(stopButton()).toBeNull()
    set({ kind: 'transcribing' }, 0.42)
    expect(status()).toBe('Waiting for the model…')
    expect(host.textContent).toContain('Downloading speech model 42%')
  })

  it('says when the text had nowhere to land, and shows notes and errors', async () => {
    await draw()
    set({ kind: 'done', text: 'lost words', landed: false })
    expect(status()).toBe('No text field focused')
    expect(host.querySelector('p')?.textContent).toBe('lost words')

    set({ kind: 'note', text: 'no speech heard' })
    expect(status()).toBe('no speech heard')
    expect(indicator()!.className).not.toContain('text-destructive')

    set({ kind: 'error', message: 'no microphone found' })
    expect(status()).toBe('no microphone found')
    expect(indicator()!.className).toContain('text-destructive')
  })
})

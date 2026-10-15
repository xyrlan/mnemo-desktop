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
const onDismiss = vi.fn()
const client = (): VoiceClient => ({
  start: async () => 'MacBook Pro Microphone',
  stop: () => stop(),
  setLanguage: async () => {},
  onProgress: async () => () => {},
  onLost: async () => () => {},
})

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  stop = async () => 'hello world'
  // The real controller's live zustand store: a selector that built a new object each read
  // would loop here (#212).
  voice = createVoice({ client: client(), target: () => ({ kind: 'pty', pane: 1 }), insert: async () => true, linger: 60_000 })
  onStop.mockReset()
  onDismiss.mockReset()
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
        <Indicator store={voice.store} shortcut={['⌘', 'E']} hold={['⌥', 'Space']} onStop={onStop} onDismiss={onDismiss} />
      </TooltipProvider>,
    )
  })
  spy.mockRestore()
  expect(errors).toEqual([])
}

const indicator = () => host.querySelector<HTMLElement>('[data-testid="dictation-indicator"]')
const stopButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Stop dictation"]')
const status = () => host.querySelector('[role="status"]')?.textContent
const alert = () => host.querySelector('[role="alert"]')?.textContent
const dismissButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')
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
    expect(status()).toBe('Listening: MacBook Pro Microphone')
    expect(host.querySelector('[data-testid="dictation-device"]')?.textContent).toBe('MacBook Pro Microphone')
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
    expect(status()).toBe('Not typed: the field it was for is gone')
    expect(host.querySelector('p')?.textContent).toBe('lost words')

    set({ kind: 'note', text: 'no speech heard' })
    expect(status()).toBe('no speech heard')
    expect(indicator()!.className).not.toContain('text-destructive')

    set({ kind: 'error', message: 'no microphone found' })
    expect(alert()).toBe('no microphone found')
    expect(indicator()!.className).toContain('text-destructive')
  })

  it('a listening take with no device name says only Listening', async () => {
    await draw()
    set({ kind: 'listening', device: null })
    expect(status()).toBe('Listening')
    expect(host.querySelector('[data-testid="dictation-device"]')).toBeNull()
  })

  it('shows an error whole, wrapped, with a Dismiss that keeps focus', async () => {
    const long = 'microphone Realtek(R) Audio: Failed to initialize audio client: The audio endpoint device has been unplugged'
    await draw()
    set({ kind: 'error', message: long })
    const text = host.querySelector<HTMLElement>('[data-testid="dictation-text"]')!
    expect(text.textContent).toBe(long)
    expect(text.className).not.toContain('truncate')
    expect(text.className).toContain('whitespace-normal')
    expect(indicator()!.className).toContain('rounded-xl')
    expect(stopButton()).toBeNull()
    const button = dismissButton()!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => button.click())
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('has no Dismiss but on an error', async () => {
    await draw()
    set({ kind: 'note', text: 'no speech heard' })
    expect(dismissButton()).toBeNull()
    set({ kind: 'done', text: 'x', landed: true })
    expect(dismissButton()).toBeNull()
  })

  it('an error from the real controller stays past the linger and goes on Dismiss', async () => {
    stop = async () => Promise.reject('model download: stalled, nothing arrived in 30 s')
    voice = createVoice({ client: client(), target: () => ({ kind: 'pty', pane: 1 }), insert: async () => true, linger: 10 })
    await draw()
    await act(async () => voice.begin())
    await act(async () => voice.end())
    await act(() => new Promise((r) => setTimeout(r, 50)))
    expect(alert()).toBe('model download: stalled, nothing arrived in 30 s')
    await act(async () => voice.dismiss())
    expect(indicator()).toBeNull()
  })

  it("draws over every window, confirmation, menu and Triage, under its own tooltip", async () => {
    await draw()
    set({ kind: 'listening', device: null })
    const z = Number(/(?:^|\s)z-\[(\d+)\]/.exec(indicator()!.className)?.[1])
    // Read from the sheets that set them, so a layer raised there fails here. `node:` is put
    // together so tsc does not resolve a package the project has no types for.
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as { readFileSync(path: string, encoding: string): string }
    const read = (file: string) => fs.readFileSync(file, 'utf8')
    const ui = read('src/nexus/ui/ui.css')
    const theme = read('src/theme.css')
    const rule = (selector: string) => Number(new RegExp(`\\${selector}\\s*\\{[^}]*?z-index:\\s*(\\d+)`).exec(ui)?.[1])
    const token = (name: string) => Number(new RegExp(`--z-index-${name}:\\s*(\\d+)`).exec(theme)?.[1])
    const below = { window: rule('.nx-backdrop'), confirmation: rule('.nx-confirm-layer'), menu: rule('.nx-menu'), triage: token('modal') }
    for (const [layer, under] of Object.entries(below)) {
      expect(under, layer).toBeGreaterThan(0)
      expect(z, layer).toBeGreaterThan(under)
    }
    expect(z).toBeLessThan(token('tooltip'))
  })
})

import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AddressBar, barReducer, initialBar, type AddressBarProps, type Bar } from './address'
import type { DataStore } from './client'

const at = (url: string): Bar => ({ ...initialBar(url), loading: false })

test('starts on the given url, loading unless blank', () => {
  expect(initialBar('https://x.dev/')).toEqual({ url: 'https://x.dev/', input: 'https://x.dev/', editing: false, loading: true })
  expect(initialBar('about:blank')).toMatchObject({ input: '', loading: false })
})

test('submit normalises the typed text and navigates', () => {
  let b = barReducer(at('about:blank'), { type: 'edit', input: 'localhost:3000' })
  b = barReducer(b, { type: 'submit' })
  expect(b).toEqual({ url: 'http://localhost:3000/', input: 'http://localhost:3000/', editing: false, loading: true })
})

test('submitting nothing changes nothing', () => {
  const b = barReducer(at('https://x.dev/'), { type: 'edit', input: '  ' })
  expect(barReducer(b, { type: 'submit' })).toBe(b)
})

test('page loads update the field when not editing', () => {
  const b = barReducer(at('https://x.dev/'), { type: 'page', url: 'https://x.dev/next', loading: true })
  expect(b).toEqual({ url: 'https://x.dev/next', input: 'https://x.dev/next', editing: false, loading: true })
})

test('page loads while editing keep the typed text', () => {
  let b = barReducer(at('https://x.dev/'), { type: 'edit', input: 'githu' })
  b = barReducer(b, { type: 'page', url: 'https://x.dev/redirected', loading: false })
  expect(b.input).toBe('githu')
  expect(b.url).toBe('https://x.dev/redirected')
  expect(barReducer(b, { type: 'cancel' }).input).toBe('https://x.dev/redirected')
})

test('blur stops editing so the next load wins', () => {
  let b = barReducer(at('https://x.dev/'), { type: 'edit', input: 'half' })
  b = barReducer(b, { type: 'blur' })
  expect(b.input).toBe('half')
  expect(barReducer(b, { type: 'page', url: 'https://x.dev/', loading: false }).input).toBe('https://x.dev/')
})

describe('AddressBar', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function fakeClient(store: DataStore = 'persistent') {
    return {
      back: vi.fn(async () => {}),
      forward: vi.fn(async () => {}),
      reload: vi.fn(async () => {}),
      openExternal: vi.fn(async (_url: string) => {}),
      dataStore: vi.fn(async () => store),
    }
  }

  async function render(props: Partial<AddressBarProps> & Pick<AddressBarProps, 'client'>) {
    const all: AddressBarProps = {
      id: -1,
      bar: at('https://github.com/o/r/pull/4'),
      dispatch: () => {},
      input: createRef<HTMLInputElement>(),
      onSubmit: (e) => e.preventDefault(),
      onError: () => {},
      ...props,
    }
    await act(async () => root.render(createElement(AddressBar, all)))
  }
  const chrome = () => host.querySelector<HTMLButtonElement>('button[aria-label="Open in Chrome"]')!

  test('"Open in Chrome" hands the loaded page, not the half-typed text, to Chrome', async () => {
    const client = fakeClient()
    const bar = barReducer(at('https://github.com/o/r/pull/4'), { type: 'edit', input: 'githu' })
    await render({ client, bar })
    await act(async () => chrome().click())
    expect(client.openExternal).toHaveBeenCalledWith('https://github.com/o/r/pull/4')
  })

  test('a blank page has nothing to open', async () => {
    const client = fakeClient()
    await render({ client, bar: at('about:blank') })
    expect(chrome().disabled).toBe(true)
  })

  test('a failed launch reaches the pane error line', async () => {
    const client = fakeClient()
    client.openExternal.mockRejectedValueOnce('could not open a browser')
    const onError = vi.fn()
    await render({ client, onError })
    await act(async () => chrome().click())
    expect(onError).toHaveBeenCalledWith('could not open a browser')
  })

  test('persistent logins show nothing; ephemeral ones say so', async () => {
    await render({ client: fakeClient('persistent') })
    expect(host.querySelector('.browser-store')).toBeNull()
    await act(async () => root.unmount())
    root = createRoot(host)
    await render({ client: fakeClient('ephemeral') })
    expect(host.querySelector('.browser-store')?.textContent).toBe('no saved login')
  })

  test('navigation buttons and Escape still work from the bar', async () => {
    const client = fakeClient()
    const dispatch = vi.fn()
    await render({ client, dispatch })
    const buttons = host.querySelectorAll('button')
    await act(async () => {
      buttons[0].click()
      buttons[1].click()
      buttons[2].click()
    })
    expect([client.back, client.forward, client.reload].map((f) => f.mock.calls)).toEqual([[[-1]], [[-1]], [[-1]]])
    const field = host.querySelector('input')!
    await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(dispatch).toHaveBeenCalledWith({ type: 'cancel' })
  })

  test("the pane's tools sit after the field, before Chrome", async () => {
    await render({ client: fakeClient(), tools: createElement('button', { className: 'tool' }, 'T') })
    const order = [...host.querySelectorAll('input, button')].map((e) => e.className || e.tagName.toLowerCase())
    expect(order.slice(3)).toEqual(['input', 'tool', 'browser-external'])
  })
})

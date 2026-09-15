import { makeBrowserClient, type Invoke } from './client'
import { externalUrl, makeDataStore, openInChrome } from './open'

function recorder(answer: (cmd: string) => unknown = () => undefined) {
  const calls: { cmd: string; args?: Record<string, unknown> }[] = []
  const invoke = (async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    return answer(cmd)
  }) as Invoke
  return { calls, client: makeBrowserClient(invoke, async () => () => {}) }
}

test('only loaded web pages go to Chrome', () => {
  expect(externalUrl('https://github.com/o/r/pull/4')).toBe('https://github.com/o/r/pull/4')
  expect(externalUrl('http://localhost:3000')).toBe('http://localhost:3000/')
  expect(externalUrl('about:blank')).toBeNull()
  expect(externalUrl('')).toBeNull()
  expect(externalUrl('github.com')).toBeNull()
  expect(externalUrl('file:///etc/passwd')).toBeNull()
  expect(externalUrl('javascript:alert(1)')).toBeNull()
})

test('opening calls the Rust command with the page url, and skips blank pages', async () => {
  const r = recorder()
  expect(await openInChrome(r.client, 'https://x.dev/a?b=1&c=2')).toBe(true)
  expect(await openInChrome(r.client, 'about:blank')).toBe(false)
  expect(r.calls).toEqual([{ cmd: 'browser_open_external', args: { url: 'https://x.dev/a?b=1&c=2' } }])
})

test('a launch failure reaches the caller', async () => {
  const invoke = (async () => {
    throw 'could not open a browser'
  }) as Invoke
  const client = makeBrowserClient(invoke, async () => () => {})
  await expect(openInChrome(client, 'https://x.dev/')).rejects.toBe('could not open a browser')
})

test('the data store is asked once and shared', async () => {
  const r = recorder(() => 'persistent')
  const store = makeDataStore(r.client)
  expect(await Promise.all([store(), store()])).toEqual(['persistent', 'persistent'])
  expect(await store()).toBe('persistent')
  expect(r.calls).toEqual([{ cmd: 'browser_data_store', args: undefined }])
})

test('a failed data store ask is retried by the next caller', async () => {
  let fail = true
  const client = {
    dataStore: async () => {
      if (fail) throw 'not ready'
      return 'ephemeral' as const
    },
  }
  const store = makeDataStore(client)
  await expect(store()).rejects.toBe('not ready')
  fail = false
  expect(await store()).toBe('ephemeral')
})

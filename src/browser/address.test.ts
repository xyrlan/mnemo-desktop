import { barReducer, initialBar, type Bar } from './address'

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

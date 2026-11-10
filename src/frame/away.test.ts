import { AWAY_EVENT, watchAway } from './away'

describe('away', () => {
  let root: HTMLElement
  let focused: boolean
  let said: boolean[]
  const hear = (e: Event) => said.push((e as CustomEvent<boolean>).detail)

  beforeEach(() => {
    vi.useFakeTimers()
    root = document.createElement('div')
    focused = true
    said = []
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
    window.addEventListener(AWAY_EVENT, hear)
  })
  afterEach(() => {
    window.removeEventListener(AWAY_EVENT, hear)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('a window out of focus goes still only after the wait, and says so once', () => {
    const stop = watchAway(root, 1000)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(999)
    expect(root.hasAttribute('data-away')).toBe(false)
    vi.advanceTimersByTime(1)
    expect(root.hasAttribute('data-away')).toBe(true)
    expect(said).toEqual([true])
    stop()
  })

  test('focus, a key or a click brings it back at once', () => {
    const stop = watchAway(root, 1000)
    for (const back of ['focus', 'keydown', 'pointerdown']) {
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(1000)
      expect(root.hasAttribute('data-away')).toBe(true)
      window.dispatchEvent(new Event(back))
      expect(root.hasAttribute('data-away')).toBe(false)
    }
    expect(said).toEqual([true, false, true, false, true, false])
    stop()
  })

  test('coming back before the wait is over never goes still', () => {
    const stop = watchAway(root, 1000)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(500)
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(5000)
    expect(root.hasAttribute('data-away')).toBe(false)
    expect(said).toEqual([])
    stop()
  })

  test('a window that starts out of focus is watched from the start, and stopping clears the mark', () => {
    focused = false
    const stop = watchAway(root, 1000)
    vi.advanceTimersByTime(1000)
    expect(root.hasAttribute('data-away')).toBe(true)
    stop()
    expect(root.hasAttribute('data-away')).toBe(false)
    expect(said).toEqual([true, false])
  })
})

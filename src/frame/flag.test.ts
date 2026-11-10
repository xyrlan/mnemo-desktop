import { frontOf, nextFront, showClassic, showFront } from './flag'

afterEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
})

describe('which front a build shows', () => {
  test('the new front, unless the flag asks for the ship', () => {
    // a build: nothing kept, nothing on the URL
    expect(frontOf(null, false, true)).toBe(true)
    expect(frontOf('0', false, true)).toBe(false)
    // anything that is not `0` leaves the default alone
    expect(frontOf('', false, true)).toBe(true)
    expect(frontOf('no', false, true)).toBe(true)
  })

  test('`1`, or `?next` on the URL, asks for the new front whatever the default is', () => {
    expect(frontOf('1', false, false)).toBe(true)
    expect(frontOf(null, true, false)).toBe(true)
    // the URL outranks a kept `0`: it is how a build is told for one launch
    expect(frontOf('0', true, true)).toBe(true)
  })

  test('under vitest the default is the ship, so the ship’s own tests mean what they meant', () => {
    expect(nextFront()).toBe(false)
    localStorage.setItem('mnemo.next', '1')
    expect(nextFront()).toBe(true)
    localStorage.setItem('mnemo.next', '0')
    expect(nextFront()).toBe(false)
    history.replaceState(null, '', '/?next')
    expect(nextFront()).toBe(true)
  })
})

describe('the switch', () => {
  test('Classic interface keeps the choice and loads the app again', () => {
    localStorage.setItem('mnemo.next', '1')
    let reloads = 0
    expect(showClassic(() => reloads++)).toBeNull()
    expect(localStorage.getItem('mnemo.next')).toBe('0')
    expect(reloads).toBe(1)
    expect(nextFront()).toBe(false)
  })

  test('New interface is the same switch, the other way', () => {
    localStorage.setItem('mnemo.next', '0')
    let reloads = 0
    expect(showFront(true, () => reloads++)).toBeNull()
    expect(localStorage.getItem('mnemo.next')).toBe('1')
    expect(reloads).toBe(1)
    expect(nextFront()).toBe(true)
  })

  test('a `?next` on the URL would bring the new front straight back, so it goes with the switch', () => {
    history.replaceState(null, '', '/?next&world=sample#v=console')
    showClassic(() => {})
    expect(new URLSearchParams(location.search).has('next')).toBe(false)
    // and nothing else of the URL is touched
    expect(new URLSearchParams(location.search).get('world')).toBe('sample')
    expect(location.hash).toBe('#v=console')
    expect(nextFront()).toBe(false)
  })

  test('a choice that cannot be kept says so, and the app is not loaded again', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('the disk is full')
    })
    let reloads = 0
    expect(showClassic(() => reloads++)).toBe('The choice could not be kept: the disk is full')
    expect(reloads).toBe(0)
    set.mockRestore()
  })
})

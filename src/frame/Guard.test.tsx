import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Broken, guarded } from './Guard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement
let errors: ReturnType<typeof vi.spyOn>

const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  // React says what a boundary caught; here that is the point of the test, not noise.
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  errors.mockRestore()
})

/** Draws what `view.tsx` mounts, over a frame that `load` fetches. */
async function draw(load: () => Promise<{ Frame: () => React.JSX.Element }>, props: { classic?: () => string | null; again?: () => void } = {}) {
  const Front = guarded(load, props)
  await act(async () => root.render(<Front />))
  // the frame is fetched apart from the app's start: let that settle
  await act(async () => {})
}

describe('the new front, behind its guard', () => {
  test('a frame that loads and draws is all there is', async () => {
    await draw(async () => ({ Frame: () => <main data-testid="frame">the frame</main> }))
    expect(host.querySelector('[data-testid="frame"]')!.textContent).toBe('the frame')
    expect(host.querySelector('[data-frame-broken]')).toBeNull()
  })

  test('a frame that fails to draw is replaced by what says so, with the reason', async () => {
    await draw(async () => ({
      Frame: () => {
        throw new Error('the roster has no session to draw')
      },
    }))
    expect(host.querySelector('[data-testid="frame"]')).toBeNull()
    const broken = host.querySelector('[data-frame-broken]')!
    expect(broken.getAttribute('role')).toBe('alert')
    expect(broken.querySelector('h1')!.textContent).toBe('The new interface could not be drawn.')
    expect(broken.querySelector('[data-frame-broken-why]')!.textContent).toBe('the roster has no session to draw')
  })

  test('a frame that cannot even be loaded is replaced the same way', async () => {
    await draw(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    expect(host.querySelector('[data-frame-broken-why]')!.textContent).toBe('Failed to fetch dynamically imported module')
  })

  test('it offers the same switch: Classic interface shows the ship', async () => {
    let classic = 0
    let again = 0
    await draw(
      async () => ({
        Frame: () => {
          throw new Error('broken')
        },
      }),
      { classic: () => (classic++, null), again: () => again++ },
    )
    await act(async () => button('Classic interface').click())
    expect([classic, again]).toEqual([1, 0])
    await act(async () => button('Try again').click())
    expect([classic, again]).toEqual([1, 1])
  })

  test('what broke is said as it is, whatever was thrown', () => {
    act(() => root.render(<Broken error="a string, not an Error" classic={() => null} again={() => {}} />))
    expect(host.querySelector('[data-frame-broken-why]')!.textContent).toBe('a string, not an Error')
  })
})

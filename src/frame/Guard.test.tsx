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
async function draw(load: () => Promise<{ Frame: () => React.JSX.Element }>, props: { again?: () => void } = {}) {
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
    expect(broken.querySelector('h1')!.textContent).toBe('The interface could not be drawn.')
    expect(broken.querySelector('[data-frame-broken-why]')!.textContent).toBe('the roster has no session to draw')
  })

  test('a frame that cannot even be loaded is replaced the same way', async () => {
    await draw(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    expect(host.querySelector('[data-frame-broken-why]')!.textContent).toBe('Failed to fetch dynamically imported module')
  })

  test('it offers one way on: Try again loads the app again', async () => {
    let again = 0
    await draw(
      async () => ({
        Frame: () => {
          throw new Error('broken')
        },
      }),
      { again: () => again++ },
    )
    expect([...host.querySelectorAll('[data-frame-broken] button')].map((b) => b.textContent?.trim())).toEqual(['Try again'])
    await act(async () => button('Try again').click())
    expect(again).toBe(1)
  })

  test('what broke is said as it is, whatever was thrown', () => {
    act(() => root.render(<Broken error="a string, not an Error" again={() => {}} />))
    expect(host.querySelector('[data-frame-broken-why]')!.textContent).toBe('a string, not an Error')
  })
})

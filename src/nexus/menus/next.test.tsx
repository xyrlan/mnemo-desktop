import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { windowDef, windowsIn } from '../ui/windows'
import { NEXT_WINDOW, NewInterface } from './next'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  localStorage.clear()
})

describe('SYSTEMS › New interface, the way back from the ship', () => {
  test('it is a window of the SYSTEMS group, by that name', () => {
    expect(windowDef(NEXT_WINDOW.id)).toMatchObject({ title: 'New interface', group: 'systems' })
  })

  test('it comes after every window the ship has: it is the one that leaves', () => {
    const order = (id: string) => windowDef(id)?.order ?? 0
    expect(order(NEXT_WINDOW.id)).toBeGreaterThan(50)
    const systems = windowsIn('systems')
    expect(systems[systems.length - 1].id).toBe(NEXT_WINDOW.id)
  })

  test('chosen, it shows the new front: once, and says it is on its way', async () => {
    let shown = 0
    await act(async () => root.render(<NewInterface show={() => (shown++, null)} />))
    expect(shown).toBe(1)
    expect(host.querySelector('[data-nx-next]')!.textContent).toBe('Opening the new interface…')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  test('a switch that could not be kept is said where it was asked', async () => {
    await act(async () => root.render(<NewInterface show={() => 'The choice could not be kept: storage is full'} />))
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('The choice could not be kept: storage is full')
  })

  test('what the window draws by itself is the app’s own switch: the flag says the new front', async () => {
    localStorage.setItem('mnemo.next', '0')
    // jsdom cannot load a page again and says so; the choice is what is looked at here
    // (that the app is loaded again is `src/frame/flag.test.ts`'s)
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    await act(async () => root.render(<>{windowDef(NEXT_WINDOW.id)!.render({}, () => {}, { open: () => false })}</>))
    quiet.mockRestore()
    expect(localStorage.getItem('mnemo.next')).toBe('1')
  })
})

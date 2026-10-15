import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { mountInSlot, resetSlots, slotEntries, SLOTS, type ShellSlot } from './slots'
import { SlotOutlet } from './Slot'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const A = () => <span>a</span>
const B = () => <span>b</span>
const C = () => <span>c</span>

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  resetSlots()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const drawn = (slot: ShellSlot) => {
  act(() => root.render(<SlotOutlet slot={slot} />))
  return host.textContent
}

test('the one slot is the overlay: the workbench’s columns, bars and rows went with it (#459)', () => {
  expect(SLOTS).toEqual(['overlay'])
})

test('a slot draws what is mounted in it, in mount order', () => {
  mountInSlot('overlay', B)
  mountInSlot('overlay', A)
  mountInSlot('overlay', C)
  expect(drawn('overlay')).toBe('bac')
})

test('the returned function takes the component out, once', () => {
  const offA = mountInSlot('overlay', A)
  mountInSlot('overlay', B)
  expect(drawn('overlay')).toBe('ab')
  act(() => offA())
  expect(host.textContent).toBe('b')
  offA()
  expect(slotEntries('overlay').map((e) => e.component)).toEqual([B])
})

test('the same component mounted twice draws once, until both mounts are undone', () => {
  const first = mountInSlot('overlay', A)
  const second = mountInSlot('overlay', A)
  expect(drawn('overlay')).toBe('a')
  act(() => first())
  expect(host.textContent).toBe('a')
  // Undoing the first mount again must not take the second one's place.
  first()
  expect(host.textContent).toBe('a')
  act(() => second())
  expect(host.textContent).toBe('')
})

test('a slot that does not exist is refused, not silently dropped', () => {
  expect(() => mountInSlot('status-bar' as ShellSlot, A)).toThrow(/no slot named "status-bar"/)
})

test('a component that throws is replaced by a line saying so; its neighbours keep drawing', () => {
  let broken = true
  function Boom(): React.ReactNode {
    if (broken) throw new Error('kaput')
    return <span>fixed</span>
  }
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  mountInSlot('overlay', A)
  mountInSlot('overlay', Boom)
  mountInSlot('overlay', B)
  drawn('overlay')
  const alert = host.querySelector('[role="alert"]')!
  expect(alert.textContent).toContain('overlay · Boom crashed')
  expect(host.textContent).toMatch(/^a.*b$/)
  broken = false
  act(() => (alert.querySelector('button') as HTMLButtonElement).click())
  expect(host.textContent).toBe('afixedb')
  error.mockRestore()
})

test('an overlay that throws says so in a corner, not over the whole window', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  mountInSlot('overlay', () => {
    throw new Error('kaput')
  })
  drawn('overlay')
  const alert = host.querySelector('[role="alert"]')!
  expect(alert.className).toContain('fixed')
  expect(alert.className).not.toContain('inset-0')
  error.mockRestore()
})

// What a hot reload does to a `view.tsx`: runs it again, which makes the same-named component anew.
const reloaded = (name: string, text: string) => {
  const c = () => <span>{text}</span>
  Object.defineProperty(c, 'name', { value: name })
  return c
}

test('a hot-reloaded mount replaces its earlier one, in its place, instead of drawing a second copy', () => {
  const firstOff = mountInSlot('overlay', reloaded('Indicator', 'old'))
  mountInSlot('overlay', C)
  const again = reloaded('Indicator', 'new')
  mountInSlot('overlay', again)
  mountInSlot('overlay', reloaded('Indicator', 'newer'))
  expect(drawn('overlay')).toBe('newerc')
  // The earlier run's undo no longer names anything drawn.
  act(() => firstOff())
  expect(host.textContent).toBe('newerc')
  expect(slotEntries('overlay')).toHaveLength(2)
})

test('the undo of the mount that replaced it still takes it out', () => {
  mountInSlot('overlay', reloaded('Nexus', 'old'))
  const off = mountInSlot('overlay', reloaded('Nexus', 'new'))
  act(() => off())
  expect(slotEntries('overlay')).toEqual([])
})

test('components without a name, or named differently, are never taken for a reload', () => {
  mountInSlot('overlay', reloaded('', 'x'))
  mountInSlot('overlay', reloaded('', 'y'))
  mountInSlot('overlay', reloaded('Other', 'z'))
  expect(drawn('overlay')).toBe('xyz')
})

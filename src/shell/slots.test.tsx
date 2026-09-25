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

test('the five slots are the contract’s: the tab rows are the workbench’s own, one per group', () => {
  expect(SLOTS).toEqual(['left-sidebar', 'right-sidebar', 'status-bar', 'titlebar-right', 'overlay'])
})

test('a slot draws what is mounted in it, in mount order, and nothing of the others', () => {
  mountInSlot('overlay', B)
  mountInSlot('overlay', A)
  mountInSlot('status-bar', C)
  expect(drawn('overlay')).toBe('ba')
  expect(drawn('status-bar')).toBe('c')
  expect(drawn('left-sidebar')).toBe('')
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

test('the same component may sit in two slots', () => {
  const off = mountInSlot('titlebar-right', A)
  mountInSlot('status-bar', A)
  off()
  expect(slotEntries('titlebar-right')).toEqual([])
  expect(slotEntries('status-bar').map((e) => e.component)).toEqual([A])
})

test('a slot that does not exist is refused, not silently dropped', () => {
  expect(() => mountInSlot('left' as ShellSlot, A)).toThrow(/no slot named "left"/)
})

test('a component that throws is replaced by a line saying so; its neighbours keep drawing', () => {
  let broken = true
  function Boom(): React.ReactNode {
    if (broken) throw new Error('kaput')
    return <span>fixed</span>
  }
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  mountInSlot('status-bar', A)
  mountInSlot('status-bar', Boom)
  mountInSlot('status-bar', B)
  drawn('status-bar')
  const alert = host.querySelector('[role="alert"]')!
  expect(alert.textContent).toContain('status-bar · Boom crashed')
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
  const firstOff = mountInSlot('status-bar', reloaded('StatusBar', 'old'))
  mountInSlot('status-bar', C)
  const again = reloaded('StatusBar', 'new')
  mountInSlot('status-bar', again)
  mountInSlot('status-bar', reloaded('StatusBar', 'newer'))
  expect(drawn('status-bar')).toBe('newerc')
  // The earlier run's undo no longer names anything drawn.
  act(() => firstOff())
  expect(host.textContent).toBe('newerc')
  expect(slotEntries('status-bar')).toHaveLength(2)
})

test('the undo of the mount that replaced it still takes it out', () => {
  mountInSlot('overlay', reloaded('Pet', 'old'))
  const off = mountInSlot('overlay', reloaded('Pet', 'new'))
  act(() => off())
  expect(slotEntries('overlay')).toEqual([])
})

test('components without a name, or named differently, are never taken for a reload', () => {
  mountInSlot('overlay', reloaded('', 'x'))
  mountInSlot('overlay', reloaded('', 'y'))
  mountInSlot('overlay', reloaded('Other', 'z'))
  expect(drawn('overlay')).toBe('xyz')
})

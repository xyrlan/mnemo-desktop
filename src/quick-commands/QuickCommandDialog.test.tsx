import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QuickCommandDialog } from './QuickCommandDialog'
import type { QuickCommand } from './commands'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

type Props = Partial<React.ComponentProps<typeof QuickCommandDialog>>
function render(p: Props = {}) {
  const saved: QuickCommand[] = []
  const events: string[] = []
  const props = {
    open: true,
    mode: 'add' as const,
    command: { label: '', command: '' },
    repoName: 'app',
    onOpenChange: (o: boolean) => void events.push(`open ${o}`),
    onSave: (c: QuickCommand) => void saved.push(c),
    ...p,
  }
  act(() => root.render(<QuickCommandDialog {...props} />))
  return { saved, events, rerender: (q: Props) => act(() => root.render(<QuickCommandDialog {...props} {...q} />)) }
}

const labelInput = () => document.querySelector<HTMLInputElement>('#quick-command-label')!
const commandInput = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Command"]')!
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith(name))!

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('adding: Save stays off until there is a label and a command, then saves them cleaned and closes', () => {
  const { saved, events } = render()
  expect(document.body.textContent).toContain('Add Quick Command')
  expect(document.body.textContent).toContain('Saved for app')
  expect(button('Save').disabled).toBe(true)
  type(labelInput(), ' Dev ')
  expect(button('Save').disabled).toBe(true)
  type(commandInput(), 'pnpm dev\n')
  expect(button('Save').disabled).toBe(false)
  act(() => button('Save').click())
  expect(saved).toEqual([{ label: 'Dev', command: 'pnpm dev' }])
  expect(events).toEqual(['open false'])
  expect(button('Remove')).toBeUndefined()
})

test('Mod+Enter saves from inside the fields', () => {
  const { saved } = render()
  type(labelInput(), 'Dev')
  type(commandInput(), 'pnpm dev')
  act(() => {
    commandInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, ctrlKey: true, bubbles: true }))
  })
  expect(saved).toEqual([{ label: 'Dev', command: 'pnpm dev' }])
})

test('editing starts from the command, and can remove it', () => {
  const removed: string[] = []
  const { saved, events } = render({ mode: 'edit', command: { label: 'Dev', command: 'pnpm dev' }, onRemove: () => void removed.push('x') })
  expect(document.body.textContent).toContain('Edit Quick Command')
  expect(labelInput().value).toBe('Dev')
  expect(commandInput().value).toBe('pnpm dev')
  act(() => button('Remove').click())
  expect(removed).toEqual(['x'])
  expect(events).toEqual(['open false'])
  expect(saved).toEqual([])
})

test('opening again, or on another command, drops the unsaved draft', () => {
  const a = { label: 'A', command: 'a' }
  const { rerender } = render({ mode: 'edit', command: a })
  type(labelInput(), 'changed')
  rerender({ mode: 'edit', command: a, open: false })
  rerender({ mode: 'edit', command: a, open: true })
  expect(labelInput().value).toBe('A')
  type(labelInput(), 'changed')
  rerender({ mode: 'edit', command: { label: 'B', command: 'b' } })
  expect(labelInput().value).toBe('B')
})

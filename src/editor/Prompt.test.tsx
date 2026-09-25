import { act } from 'react'
import { promptPath } from './Prompt'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const field = () => document.querySelector<HTMLInputElement>('input[aria-label="File path"]')
const key = (k: string, init: KeyboardEventInit = {}) => act(() => void field()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })))

/** Opens the prompt; `done` is what it resolves to once answered. */
async function open() {
  let done!: Promise<unknown>
  await act(async () => {
    done = promptPath({ initial: '/code/app/', hint: 'Enter: split right' })
  })
  return { done }
}

test('the field starts at the tree root, focused, with its hint under it', async () => {
  const { done } = await open()
  expect(field()?.value).toBe('/code/app/')
  expect(document.activeElement).toBe(field())
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Enter: split right')
  await key('Escape')
  await done
})

test('Enter opens beside, ⌘Enter in a tab; either way the prompt goes', async () => {
  const beside = await open()
  await key('Enter')
  expect(await beside.done).toEqual({ value: '/code/app/', place: 'split-row' })
  expect(field()).toBeNull()

  const tab = await open()
  await key('Enter', { metaKey: true })
  expect(await tab.done).toEqual({ value: '/code/app/', place: 'tab' })
})

test('Escape, or a press outside the surface, dismisses it', async () => {
  const escaped = await open()
  await key('Escape')
  expect(await escaped.done).toBeNull()

  const outside = await open()
  // A press inside the surface keeps it.
  await act(() => void document.querySelector('[role="dialog"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(field()).not.toBeNull()
  await act(() => void document.querySelector('[data-palette]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(await outside.done).toBeNull()
  expect(document.querySelector('[data-palette]')).toBeNull()
})

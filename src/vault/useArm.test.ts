import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createElement } from 'react'
import { ARM_MS, useArm } from './useArm'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let hook: ReturnType<typeof useArm>

function Harness() {
  hook = useArm()
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(createElement(Harness)))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

function press(key: string) {
  let result = false
  act(() => {
    result = hook.press(key)
  })
  return result
}

function disarm() {
  act(() => hook.disarm())
}

test('first press arms without firing', () => {
  expect(press('delete')).toBe(false)
  expect(hook.armed).toBe('delete')
})

test('second press of the same key within the window fires and clears', () => {
  press('delete')
  expect(press('delete')).toBe(true)
  expect(hook.armed).toBeNull()
})

test('pressing a different key re-arms on the new key', () => {
  press('delete')
  expect(press('rename')).toBe(false)
  expect(hook.armed).toBe('rename')
})

test('arming expires after ARM_MS', () => {
  press('delete')
  act(() => vi.advanceTimersByTime(ARM_MS))
  expect(hook.armed).toBeNull()
  expect(press('delete')).toBe(false)
})

test('disarm clears an armed key before its second press', () => {
  press('delete')
  disarm()
  expect(hook.armed).toBeNull()
  expect(press('delete')).toBe(false)
})

test('disarm after expiry is a no-op', () => {
  expect(hook.armed).toBeNull()
  disarm()
  expect(hook.armed).toBeNull()
})

test('disarm cancels the pending timeout so it cannot fire later', () => {
  press('delete')
  disarm()
  act(() => vi.advanceTimersByTime(ARM_MS))
  expect(hook.armed).toBeNull()
})

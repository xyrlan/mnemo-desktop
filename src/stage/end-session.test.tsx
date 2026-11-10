import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NO_ACTIONS, setActions, type Outcome } from '../world/actions'
import { EndSession } from './index'

describe('closing the session on stage', () => {
  let host: HTMLElement
  let root: Root
  let closed: string[]
  let answer: Outcome
  let undo: () => void
  const button = () => host.querySelector<HTMLButtonElement>('[data-stage-close]')!

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.body.appendChild(document.createElement('div'))
    root = createRoot(host)
    closed = []
    answer = { ok: true }
    undo = setActions({
      ...NO_ACTIONS,
      close: async (id) => {
        closed.push(id)
        return answer
      },
    })
    act(() => root.render(<EndSession id="abc" />))
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    undo()
  })

  test('the first press only asks; the second closes that session, once', async () => {
    expect(button().textContent).toBe('close session')
    await act(async () => button().click())
    expect(closed).toEqual([])
    expect(button().textContent).toBe('close it, and end what runs in it?')
    await act(async () => button().click())
    expect(closed).toEqual(['abc'])
    expect(button().textContent).toBe('close session')
  })

  test('looking away after the question takes it back', async () => {
    await act(async () => button().click())
    await act(async () => {
      button().focus()
      button().blur()
    })
    expect(button().textContent).toBe('close session')
    expect(closed).toEqual([])
  })

  test('a refusal is said beside the button, in the words given', async () => {
    answer = { ok: false, why: 'It runs in another terminal.' }
    await act(async () => button().click())
    await act(async () => button().click())
    expect(host.querySelector('[role="status"]')?.textContent).toBe('not closed: It runs in another terminal.')
  })
})

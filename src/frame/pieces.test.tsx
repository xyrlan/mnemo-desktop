import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { setActions } from '../world/actions'
import { HOME, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { pendingInOrder, worldStore } from '../world/store'
import { WaitingCount, answerArmed, replyArmed } from './pieces'

// What the pending piece will export, as a module the test can switch on and off: the seam's
// placeholder has none of the three, the landed piece has all of them.
const theirs = vi.hoisted(() => ({ on: false, answered: [] as number[], replied: 0, takes: true }))
vi.mock('../pending', async (original) => {
  const real = await original<typeof import('../pending')>()
  return {
    armedPending: real.armedPending,
    nextPending: real.nextPending,
    get WaitingCount() {
      return theirs.on ? () => <b data-testid="theirs">theirs</b> : undefined
    },
    get answerArmed() {
      return theirs.on ? async (key: number) => (theirs.answered.push(key), { ok: true as const }) : undefined
    },
    get replyArmed() {
      return theirs.on ? () => (theirs.replied++, theirs.takes) : undefined
    },
  }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let did: string[]
let undo: () => void

beforeEach(() => {
  theirs.on = false
  theirs.answered.length = 0
  theirs.replied = 0
  theirs.takes = true
  did = []
  worldStore.getState().set(sampleWorld())
  undo = setActions(
    sampleActions(
      () => worldStore.getState().world,
      (w) => worldStore.getState().set(w),
      did,
    ),
  )
})
afterEach(() => {
  undo()
  document.body.innerHTML = ''
})

const open = (n: number) => {
  const item = pendingInOrder(worldStore.getState().world)[n]
  routeStore.setState({ route: { ...HOME, view: 'console', session: item.session, pending: item.id }, recent: [] })
  return item
}

describe('until the pending piece lands, the frame answers with what the seam has', () => {
  test('a digit answers the item whose card is open, with that choice', async () => {
    const item = open(1)
    expect(await answerArmed(2)).toMatchObject({ ok: true })
    expect(did).toEqual([`answer ${item.id} 2`])
  })

  test('a digit that is not one of its choices answers nothing', async () => {
    const item = open(0)
    expect(await answerArmed(item.choices.length + 1)).toBeNull()
    expect(did).toEqual([])
  })

  test('with no card open, the digit answers what waits on the selected session', async () => {
    const item = pendingInOrder(worldStore.getState().world)[2]
    routeStore.setState({ route: { ...HOME, session: item.session }, recent: [] })
    await answerArmed(1)
    expect(did).toEqual([`answer ${item.id} 1`])
  })

  test('with nothing armed, a digit does nothing', async () => {
    routeStore.setState({ route: { ...HOME }, recent: [] })
    expect(await answerArmed(1)).toBeNull()
    expect(did).toEqual([])
  })

  test('R opens the armed item’s card', () => {
    const item = pendingInOrder(worldStore.getState().world).find((p) => p.reply)!
    routeStore.setState({ route: { ...HOME, session: item.session }, recent: [] })
    expect(replyArmed()).toBe(true)
    expect(routeStore.getState().route.pending).toBe(item.id)
  })

  test('R on an item that takes no reply, or with nothing armed, is not spent', () => {
    const merge = pendingInOrder(worldStore.getState().world).find((p) => !p.reply)!
    routeStore.setState({ route: { ...HOME, session: merge.session }, recent: [] })
    expect(replyArmed()).toBe(false)
    expect(routeStore.getState().route.pending).toBeNull()
    routeStore.setState({ route: { ...HOME }, recent: [] })
    expect(replyArmed()).toBe(false)
  })
})

describe('once the pending piece exports them, its own are the ones used', () => {
  test('the digit and R go to the piece', async () => {
    theirs.on = true
    open(0)
    expect(await answerArmed(3)).toEqual({ ok: true })
    expect(replyArmed()).toBe(true)
    expect(theirs.answered).toEqual([3])
    expect(theirs.replied).toBe(1)
    expect(did).toEqual([])
    // the piece says when the key was not spent, and the frame passes that on
    theirs.takes = false
    expect(replyArmed()).toBe(false)
  })

  test('the top bar draws the piece’s count, not the stand-in', async () => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<WaitingCount />))
    expect(host.querySelector('.frame-waiting')).not.toBeNull()
    expect(host.querySelector('[data-testid="theirs"]')).toBeNull()

    theirs.on = true
    await act(async () => root.render(<WaitingCount />))
    expect(host.querySelector('[data-testid="theirs"]')).not.toBeNull()
    expect(host.querySelector('.frame-waiting')).toBeNull()
    act(() => root.unmount())
  })
})

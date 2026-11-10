import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setActions, type Outcome } from '../world/actions'
import { HOME, go, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { sessionOf, worldStore } from '../world/store'
import type { Session, World } from '../world/types'
import { Stage, focusTerminal, walkFamily } from './index'
import { saidStore } from './said'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The stage on the sample world. The runtime and the waiting card are other pieces: here they
// are stand-ins, so these tests say the same thing before and after those pieces land.
const { hosted } = vi.hoisted(() => ({ hosted: new Set<string>() }))

vi.mock('../runtime', () => ({
  useCanHost: (s: Session | null | undefined) => !!s && hosted.has(s.id),
  // no terminal that is not a session: `terminal.test.tsx` has those, on the real runtime module
  useHosted: () => [],
  LiveTerminal: ({ sessionId, active }: { sessionId: string; active: boolean }) => <textarea data-fake-terminal={sessionId} data-active={String(active)} />,
}))
vi.mock('../pending', async (original) => ({
  ...(await original<typeof import('../pending')>()),
  PendingCard: ({ pending, armed }: { pending: { id: string }; armed: boolean }) => <div data-fake-card={pending.id} data-armed={String(armed)} />,
}))

let host: HTMLElement
let root: Root
let said: string[]
let undo: () => void

const world = (): World => worldStore.getState().world
const titled = (start: string): Session => {
  const hit = world().sessions.find((s) => s.title.startsWith(start))
  if (!hit) throw new Error(`no session titled ${start}`)
  return hit
}
const staged = (): string | undefined => sessionOf(world(), routeStore.getState().route.session)?.title.split(' ')[0]
const stage = () => host.querySelector<HTMLElement>('[data-stage]') as HTMLElement
const box = () => host.querySelector<HTMLInputElement>('[data-stage-reply]') as HTMLInputElement
const lines = () => [...host.querySelectorAll<HTMLElement>('.stage-log > [data-line]')]

function mount(session: string | null, route: Partial<typeof HOME> = {}) {
  act(() => {
    go({ ...HOME, view: 'console', session: session && titled(session).id, ...route })
    root.render(<Stage />)
  })
}

/** What `fn` answers, with everything it set in motion already drawn. */
function doing<T>(fn: () => T): T {
  let out!: T
  act(() => void (out = fn()))
  return out
}

function press(on: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => void on.dispatchEvent(e))
  return e
}

function type(text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(box(), text)
    box().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Enter in the reply box: what a browser does with it is submit the form. */
async function enter() {
  await act(async () => {
    box().form?.requestSubmit()
  })
}

beforeEach(() => {
  hosted.clear()
  said = []
  saidStore.setState({ sent: {}, drafts: {} })
  worldStore.getState().set(sampleWorld())
  undo = setActions(sampleActions(world, (w) => worldStore.getState().set(w), said))
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  undo()
})

describe('left and right on the stage', () => {
  test('walk the family, parent then each child, and wrap', () => {
    mount('Idempotent retries')
    act(() => stage().focus())
    const walked = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft'].map((key) => {
      press(document.activeElement as Element, key)
      return staged()
    })
    expect(walked).toEqual(['Webhook', 'Forward-only', 'Cursor', 'Tenant', 'Idempotent', 'Tenant', 'Cursor'])
    expect(routeStore.getState().route.view).toBe('console')
  })

  test('the focus goes with the walk, to the chip of the session now on stage', () => {
    mount('Idempotent retries')
    act(() => stage().focus())
    press(stage(), 'ArrowRight')
    const chip = document.activeElement as HTMLElement
    expect(chip.getAttribute('aria-current')).toBe('true')
    expect(chip.textContent).toContain('Webhook signature check')
    expect(stage().contains(chip)).toBe(true)
  })

  test('the key is taken, so nothing above the stage acts on it too', () => {
    mount('Idempotent retries')
    const above = vi.fn()
    window.addEventListener('keydown', above)
    const e = press(stage(), 'ArrowRight')
    window.removeEventListener('keydown', above)
    expect(e.defaultPrevented).toBe(true)
    expect(above).not.toHaveBeenCalled()
  })

  test('a key something above already took is left alone', () => {
    mount('Idempotent retries')
    const first = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', first, true)
    press(stage(), 'ArrowRight')
    window.removeEventListener('keydown', first, true)
    expect(staged()).toBe('Idempotent')
  })

  test('do nothing while words are being typed, with a modifier, or when the session is alone', () => {
    mount('Idempotent retries')
    press(box(), 'ArrowRight')
    press(stage(), 'ArrowRight', { altKey: true })
    press(stage(), 'ArrowRight', { ctrlKey: true })
    expect(staged()).toBe('Idempotent')
    mount('Order status history')
    expect(press(stage(), 'ArrowRight').defaultPrevented).toBe(false)
    expect(staged()).toBe('Order')
  })

  test('are the terminal\'s own while it is hosted live', () => {
    hosted.add(titled('Idempotent retries').id)
    mount('Idempotent retries')
    press(host.querySelector('[data-fake-terminal]') as Element, 'ArrowRight')
    expect(staged()).toBe('Idempotent')
  })

  test('the frame walks the same family through walkFamily', () => {
    mount('Idempotent retries')
    expect(doing(() => walkFamily(-1))).toBe(true)
    expect(staged()).toBe('Tenant')
    expect(doing(() => walkFamily(1))).toBe(true)
    expect(staged()).toBe('Idempotent')
    mount('Order status history')
    expect(doing(() => walkFamily(1))).toBe(false)
    mount(null)
    expect(doing(() => walkFamily(1))).toBe(false)
  })
})

describe('the family across the top', () => {
  test('a chip puts its session on stage, and a child links to its parent', () => {
    mount('Idempotent retries')
    const chips = [...host.querySelectorAll<HTMLElement>('.stage-chip')]
    expect(chips.map((c) => c.querySelector('.stage-chip-title')?.textContent?.split(' ')[0])).toEqual(['Idempotent', 'Webhook', 'Forward-only', 'Cursor', 'Tenant'])
    // the three children with something waiting say so; the parent and the working child do not
    expect(chips.map((c) => !!c.querySelector('.stage-chip-waits'))).toEqual([false, true, true, true, false])
    act(() => chips[3].click())
    expect(staged()).toBe('Cursor')
    act(() => host.querySelector<HTMLElement>('.stage-link')?.click())
    expect(staged()).toBe('Idempotent')
  })

  test('a session with no children says so instead of drawing a family of one', () => {
    mount('Order status history')
    expect(host.querySelectorAll('.stage-chip')).toHaveLength(0)
    expect(host.querySelector('.stage-family')?.textContent).toContain('No children')
  })
})

describe('the terminal', () => {
  test('is the live one when the runtime can host the session, and takes the keys on Console only', () => {
    const s = titled('Idempotent retries')
    hosted.add(s.id)
    mount('Idempotent retries')
    const term = host.querySelector<HTMLElement>('[data-fake-terminal]')
    expect(term?.dataset.fakeTerminal).toBe(s.id)
    expect(term?.dataset.active).toBe('true')
    expect(box()).toBeNull()
    expect(lines()).toHaveLength(0)
    act(() => go({ view: 'score' }))
    expect(host.querySelector<HTMLElement>('[data-fake-terminal]')?.dataset.active).toBe('false')
  })

  test('is the transcript drawn from the world when it cannot, for that session alone', () => {
    hosted.add(titled('Idempotent retries').id)
    mount('Webhook signature check')
    expect(host.querySelector('[data-fake-terminal]')).toBeNull()
    expect(box()).not.toBeNull()
    expect(lines().length).toBeGreaterThan(10)
    press(stage(), 'ArrowLeft')
    expect(host.querySelector('[data-fake-terminal]')).not.toBeNull()
  })

  test('what waits is the last thing in the transcript, armed while its session is on stage', () => {
    mount('Order status history')
    const last = lines().at(-1)?.querySelector<HTMLElement>('[data-fake-card]')
    const question = world().pending.find((p) => p.kind === 'question')
    expect(last?.dataset.fakeCard).toBe(question?.id)
    expect(last?.dataset.armed).toBe('true')
    // another item's card is open: this one is no longer what a digit answers
    act(() => go({ pending: world().pending.find((p) => p.kind === 'merge')?.id }))
    expect(lines().at(-1)?.querySelector<HTMLElement>('[data-fake-card]')?.dataset.armed).toBe('false')
  })

  test('Enter on the stage puts the keys in it, through focusTerminal', () => {
    mount('Idempotent retries')
    act(() => stage().focus())
    expect(press(stage(), 'Enter').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(box())
    act(() => stage().focus())
    expect(doing(() => focusTerminal())).toBe(true)
    expect(document.activeElement).toBe(box())
  })

  test('Enter on a chip is the chip\'s, not the terminal\'s', () => {
    mount('Idempotent retries')
    const chip = host.querySelector('.stage-chip') as HTMLElement
    act(() => chip.focus())
    expect(press(chip, 'Enter').defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(chip)
  })

  test('focusTerminal reaches the live terminal, and says no when nothing is on stage', () => {
    hosted.add(titled('Idempotent retries').id)
    mount('Idempotent retries')
    expect(doing(() => focusTerminal())).toBe(true)
    expect(document.activeElement).toBe(host.querySelector('[data-fake-terminal]'))
    mount(null)
    expect(doing(() => focusTerminal())).toBe(false)
  })
})

describe('the reply box', () => {
  test('speaks through actions().reply; the words leave the box and stand last in the transcript', async () => {
    mount('Optimistic updates')
    const s = titled('Optimistic updates')
    type('  show me the empty state first  ')
    await enter()
    expect(said).toEqual([`reply ${s.id} show me the empty state first`])
    expect(box().value).toBe('')
    const last = lines().at(-2) as HTMLElement
    expect(last.dataset.tag).toBe('you')
    expect(last.textContent).toContain('show me the empty state first')
    // the sample moved the session on, and the head says so
    expect(stage().dataset.state).toBe('working')
    expect(lines().at(-1)?.dataset.line).toBe('working')
    // its last prompt is now those words: they are not drawn a second time
    expect(lines().filter((l) => l.dataset.line === 'prompt' && l.textContent?.includes('show me the empty state first'))).toHaveLength(1)
  })

  test('a refusal is said under the box and the words stay in it', async () => {
    const refuse = vi.fn(async (): Promise<Outcome> => ({ ok: false, why: 'Its input box holds a draft.' }))
    const back = setActions({ ...sampleActions(world, () => {}), reply: refuse })
    mount('Optimistic updates')
    type('ship it')
    await enter()
    back()
    expect(refuse).toHaveBeenCalledWith(titled('Optimistic updates').id, 'ship it')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Its input box holds a draft.')
    expect(box().value).toBe('ship it')
    expect(lines().some((l) => l.dataset.tag === 'you')).toBe(false)
    // typing again takes the refusal away
    type('ship it now')
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  test('an action that throws is a refusal too, in its own words', async () => {
    const back = setActions({ ...sampleActions(world, () => {}), reply: async () => Promise.reject(new Error('the core is gone')) })
    mount('Optimistic updates')
    type('hello')
    await enter()
    back()
    expect(host.querySelector('[role="status"]')?.textContent).toContain('the core is gone')
    expect(box().value).toBe('hello')
  })

  test('Enter on an empty box gives the terminal the room, and again gives it back; nothing is sent', async () => {
    mount('Idempotent retries')
    type('   ')
    await enter()
    expect(routeStore.getState().route.wide).toBe(true)
    await enter()
    expect(routeStore.getState().route.wide).toBe(false)
    expect(said).toEqual([])
  })

  test('the button on the terminal\'s bar does the same', () => {
    mount('Idempotent retries')
    const room = () => host.querySelector<HTMLElement>('[data-room]') as HTMLElement
    expect(room().textContent).toBe('take the room')
    act(() => room().click())
    expect(routeStore.getState().route.wide).toBe(true)
    expect(room().textContent).toBe('give the room back')
  })

  test('a draft stays with its session through a walk to another and back', () => {
    mount('Idempotent retries')
    type('half a thought')
    press(stage(), 'ArrowRight')
    expect(box().value).toBe('')
    type('for the child')
    press(stage(), 'ArrowLeft')
    expect(box().value).toBe('half a thought')
    press(stage(), 'ArrowRight')
    expect(box().value).toBe('for the child')
  })

  test('Esc leaves the box and keeps the keys on the stage', () => {
    mount('Idempotent retries')
    act(() => box().focus())
    press(box(), 'Escape')
    expect(document.activeElement).toBe(stage())
    press(stage(), 'ArrowRight')
    expect(staged()).toBe('Webhook')
  })
})

describe('what is drawn', () => {
  test('nothing enters on the first draw; a change of session does', () => {
    mount('Idempotent retries')
    expect(host.querySelector('.stage-enter')).toBeNull()
    press(stage(), 'ArrowRight')
    expect(host.querySelector('.stage-enter')).not.toBeNull()
    // a new world for the same session does not start the entrance again, or end it
    const before = host.querySelector('.stage-in')
    act(() => worldStore.getState().set({ ...world(), at: world().at + 1000 }))
    expect(host.querySelector('.stage-enter')).toBe(before)
  })

  test('with no session on stage it says so, and how many wait', () => {
    mount(null)
    expect(stage().textContent).toContain('No session on stage')
    expect(stage().textContent).toContain('the next of 5 that wait')
    act(() => go({ session: 'not-a-session' }))
    expect(stage().textContent).toContain('No session on stage')
  })

  test('the head says the context as a number, and the now line what is running', () => {
    mount('Idempotent retries')
    expect(host.querySelector('.stage-figure')?.getAttribute('aria-label')).toBe('context 31%')
    const now = host.querySelector('.stage-now')
    expect(now?.textContent).toContain('running')
    expect(now?.textContent).toContain('Edit src/lib/cache.ts')
    expect(now?.textContent).toContain('4m ago')
  })
})

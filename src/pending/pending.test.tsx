import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { actions, setActions, type Actions, type Outcome } from '../world/actions'
import { HOME, routeStore, type Route } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { pendingInOrder, sessionOf, worldStore } from '../world/store'
import type { Pending, World } from '../world/types'
import { PendingCard, WaitingCount, answerArmed, armedPending, replyArmed } from '.'
import { STILL_WAITS_MS, pendingStore } from './state'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let said: string[]
let undo: () => void

const world = (): World => worldStore.getState().world
const route = (): Route => routeStore.getState().route
const at = (patch: Partial<Route>) => act(() => routeStore.setState({ route: { ...HOME, ...patch } }))
const of = (kind: Pending['kind'], ci?: string): Pending => world().pending.find((p) => p.kind === kind && (!ci || p.pr?.ci === ci))!

/** The sample's actions with some of them replaced: what a runtime's guard or a slow core does. */
const acting = (over: Partial<Actions>) => {
  undo()
  undo = setActions({ ...sampleActions(world, worldStore.getState().set, said), ...over })
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  said = []
  worldStore.setState({ world: sampleWorld(), ready: true })
  routeStore.setState({ route: { ...HOME }, recent: [] })
  pendingStore.setState({ cards: {}, focus: null, last: null })
  undo = setActions(sampleActions(world, worldStore.getState().set, said))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  undo()
  vi.useRealTimers()
})

/** Every item that waits, drawn as a view draws it: armed when it is the armed one. */
function Listed() {
  const w = worldStore((s) => s.world)
  const r = routeStore((s) => s.route)
  const armed = armedPending(w, r)
  return (
    <>
      <WaitingCount />
      {w.pending.map((p) => (
        <PendingCard key={p.id} pending={p} armed={armed?.id === p.id} />
      ))}
    </>
  )
}

const draw = (node = <Listed />) => act(() => root.render(node))
const $ = <T extends Element = HTMLElement>(sel: string, within: ParentNode = host) => within.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string, within: ParentNode = host) => [...within.querySelectorAll<T>(sel)]
const card = (p: Pending) => $$('[data-pending-id]').find((el) => el.dataset.pendingId === p.id)!
const choices = (p: Pending) => $$<HTMLButtonElement>('.pending-choice:not(.pending-own)', card(p))
const click = (el: Element | null | undefined) => act(async () => void (el as HTMLElement).click())
const field = (p: Pending) => $<HTMLTextAreaElement>('textarea', card(p))
const type = (el: HTMLTextAreaElement, value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const press = async (el: Element, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  await act(async () => void el.dispatchEvent(event))
  return event
}
/** Put another item in place of one that waits (or add it). */
const swap = (p: Pending) => act(() => worldStore.getState().set({ ...world(), pending: world().pending.some((x) => x.id === p.id) ? world().pending.map((x) => (x.id === p.id ? p : x)) : [...world().pending, p] }))
/** What an element says, one space between its parts, as a reader takes it in. */
function text(el: Element | null | undefined): string {
  if (!el) return ''
  const parts: string[] = []
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walk.nextNode()) parts.push(walk.currentNode.textContent ?? '')
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

describe('a digit', () => {
  test('answers the item on the selected session through actions().answer, and the world moves on', async () => {
    const q = of('question')
    at({ session: q.session })
    const out = await answerArmed(2)
    expect(out).toEqual({ ok: true, note: q.choices[1].label })
    expect(said).toEqual([`answer ${q.id} 2`])
    expect(world().pending.some((p) => p.id === q.id)).toBe(false)
    expect(sessionOf(world(), q.session)?.state).toBe('working')
  })

  test('answers the open card before the selected session', async () => {
    const q = of('question')
    const merge = of('merge', 'green')
    at({ session: q.session, pending: merge.id })
    await answerArmed(1)
    expect(said).toEqual([`answer ${merge.id} 1`])
  })

  test('that is no choice of the armed item, or with nothing armed, sends nothing', async () => {
    expect(await answerArmed(1)).toBeNull()
    at({ session: of('stalled').session })
    expect(await answerArmed(3)).toBeNull()
    expect(said).toEqual([])
  })

  test('pressed again while the first is on its way is not sent', async () => {
    const q = of('question')
    let land!: (out: Outcome) => void
    const answer = vi.fn(() => new Promise<Outcome>((resolve) => (land = resolve)))
    acting({ answer })
    at({ session: q.session })
    draw()
    let first!: Promise<Outcome | null>
    await act(async () => void (first = answerArmed(1)))
    expect(await answerArmed(2)).toBeNull()
    expect(choices(q).every((b) => b.disabled)).toBe(true)
    expect(text(choices(q)[0])).toContain('sending')
    await act(async () => land({ ok: false, why: 'Too late.' }))
    expect(await first).toEqual({ ok: false, why: 'Too late.' })
    expect(answer).toHaveBeenCalledTimes(1)
    expect(choices(q).every((b) => !b.disabled)).toBe(true)
  })
})

describe('the card', () => {
  test('says the kind, the text, how long it waited and its choices as digits, in order', () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    expect(text($('.pending-kind', card(q)))).toBe('question')
    expect(text($('.pending-text', card(q)))).toBe(q.text)
    expect(text($('.pending-age', card(q)))).toBe('waiting 14m')
    expect(choices(q).map((b) => text(b))).toEqual(q.choices.map((c) => `${c.key} ${c.label} ${c.hint}`))
  })

  test('counts the wait on the world’s clock', () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    act(() => worldStore.getState().set({ ...world(), at: world().at + 3_600_000 }))
    expect(text($('.pending-age', card(q)))).toBe('waiting 74m')
  })

  test('a permission says what the terminal printed, without its kind twice', () => {
    const p = of('permission')
    at({ session: p.session })
    draw()
    expect(p.text).toMatch(/^permission: /)
    expect(text($('.pending-text', card(p)))).toBe(p.text.replace('permission: ', ''))
  })

  test('a click on a choice answers with that choice’s digit', async () => {
    const p = of('permission')
    at({ session: p.session })
    draw()
    await click(choices(p)[2])
    expect(said).toEqual([`answer ${p.id} 3`])
  })

  test('listed, it is one line that says how many choices it has; a click arms it', async () => {
    const p = of('permission')
    draw()
    expect(card(p).tagName).toBe('BUTTON')
    expect(text($('.pending-count', card(p)))).toBe('3 choices')
    const one = { ...of('stalled'), choices: of('stalled').choices.slice(0, 1) }
    swap(one)
    expect(text($('.pending-count', card(one)))).toBe('1 choice')
    expect(choices(p)).toEqual([])
    await click(card(p))
    expect(route().pending).toBe(p.id)
    expect(route().session).toBe(p.session)
    expect(choices(p).length).toBe(3)
  })

  test('a merge names its pull request and its checks, and opens it outside', async () => {
    const m = of('merge', 'running')
    at({ pending: m.id })
    draw()
    expect(text($('.pending-detail', card(m)))).toBe(`${m.pr!.repo}#${m.pr!.number} checks running`)
    await click($('.pending-link', card(m)))
    expect(said).toEqual([`external ${m.pr!.url}`])
    swap({ ...m, detail: null, pr: { ...m.pr!, ci: null } })
    expect(text($('.pending-detail', card(m)))).toBe(`#${m.pr!.number} no checks`)
  })

  test('says the line under the text when the item has one and no pull request', () => {
    const p = { ...of('permission'), detail: 'Bash · git push origin fix/issue-412' }
    swap(p)
    at({ session: p.session })
    draw()
    expect(text($('.pending-detail', card(p)))).toBe('Bash · git push origin fix/issue-412')
    expect($('.pending-link', card(p))).toBeNull()
  })

  test('wears the signal of its kind: a need, a merge that is ready, a stop', () => {
    const blocked: Pending = { ...of('stalled'), id: 'x:blocked', kind: 'blocked' }
    swap(blocked)
    draw()
    const tone = (p: Pending) => card(p).dataset.tone
    expect([of('question'), of('permission'), of('merge'), of('stalled'), blocked].map(tone)).toEqual(['need', 'need', 'ready', 'stalled', 'stalled'])
  })

  test('plays its entrance when a listed card is armed, never when it is first drawn armed', () => {
    const q = of('question')
    const p = of('permission')
    at({ session: q.session })
    draw()
    expect(card(q).dataset.entered).toBeUndefined()
    at({ session: p.session })
    expect(card(p).dataset.entered).toBe('true')
    expect(card(q).dataset.entered).toBeUndefined()
  })
})

describe('a refusal', () => {
  test('is said on the card as the action said it, and the choices still answer', async () => {
    const q = of('question')
    const answer = vi.fn(async (): Promise<Outcome> => ({ ok: false, why: 'The prompt on screen is not the one this card shows.' }))
    acting({ answer })
    at({ session: q.session })
    draw()
    await click(choices(q)[0])
    expect(text($('[role="alert"]', card(q)))).toBe('✕ The prompt on screen is not the one this card shows.')
    expect($('.pending-settled', card(q))).toBeNull()
    await click(choices(q)[1])
    expect(answer.mock.calls).toEqual([
      [q.id, 1],
      [q.id, 2],
    ])
  })

  test('an action that throws is said the same way', async () => {
    const q = of('question')
    acting({ answer: async () => Promise.reject(new Error('The core did not answer.')) })
    at({ session: q.session })
    draw()
    expect(await act(() => answerArmed(1))).toEqual({ ok: false, why: 'The core did not answer.' })
    expect(text($('[role="alert"]', card(q)))).toBe('✕ The core did not answer.')
  })

  test('is gone as soon as the next answer is on its way', async () => {
    const q = of('question')
    let land: ((out: Outcome) => void) | null = null
    acting({ answer: () => (land ? new Promise<Outcome>(() => {}) : new Promise<Outcome>((resolve) => (land = resolve))) })
    at({ session: q.session })
    draw()
    await click(choices(q)[0])
    await act(async () => land!({ ok: false, why: 'No.' }))
    expect(text($('[role="alert"]', card(q)))).toBe('✕ No.')
    await click(choices(q)[0])
    expect($('[role="alert"]', card(q))).toBeNull()
  })
})

describe('an answer that was taken, for an item the world still lists', () => {
  const taken = async () => {
    const q = of('question')
    const answer = vi.fn(async (): Promise<Outcome> => ({ ok: true, note: 'Sent to the session.' }))
    acting({ answer })
    at({ session: q.session })
    draw()
    vi.useFakeTimers()
    await click(choices(q)[0])
    return { q, answer }
  }

  test('settles the card: it says what was answered and takes no second digit', async () => {
    const { q, answer } = await taken()
    expect(text($('.pending-settled', card(q)))).toBe(`✓ answered ${q.choices[0].label} Sent to the session.`)
    expect(choices(q)).toEqual([])
    expect(await answerArmed(2)).toBeNull()
    expect(replyArmed()).toBe(false)
    expect(answer).toHaveBeenCalledTimes(1)
  })

  test('does not say twice what the action only repeated', async () => {
    const q = of('question')
    acting({ answer: async () => ({ ok: true, note: q.choices[0].label }) })
    at({ session: q.session })
    draw()
    await click(choices(q)[0])
    expect(text($('.pending-settled', card(q)))).toBe(`✓ answered ${q.choices[0].label}`)
  })

  test('says so on the line too, when the card is no longer the armed one', async () => {
    const { q } = await taken()
    at({ session: of('stalled').session })
    expect(text($('.pending-count', card(q)))).toBe('answered')
  })

  test('gives the choices back when it still waits half a minute later', async () => {
    const { q, answer } = await taken()
    await act(async () => void vi.advanceTimersByTime(STILL_WAITS_MS - 1))
    expect(choices(q)).toEqual([])
    await act(async () => void vi.advanceTimersByTime(1))
    expect(text($('[role="alert"]', card(q)))).toBe(`✕ Answered "${q.choices[0].label}", and it still waits.`)
    await click(choices(q)[1])
    expect(answer).toHaveBeenCalledTimes(2)
  })

  test('is forgotten once the item left the world, so the same id asks anew', async () => {
    const { q } = await taken()
    act(() => worldStore.getState().set({ ...world(), pending: world().pending.filter((p) => p.id !== q.id) }))
    await act(async () => void vi.advanceTimersByTime(STILL_WAITS_MS))
    expect(pendingStore.getState().cards[q.id]).toBeUndefined()
  })

  test('does not stand for another question behind the same id', async () => {
    const { q } = await taken()
    const again: Pending = { ...q, text: 'And the index: build it now, or after the backfill?', since: world().at }
    act(() => worldStore.getState().set({ ...world(), pending: world().pending.map((p) => (p.id === q.id ? again : p)) }))
    expect($('.pending-settled', card(again))).toBeNull()
    expect(choices(again).length).toBe(3)
  })

  test('its half minute does not undo an answer to the next question behind the same id', async () => {
    const { q, answer } = await taken()
    await act(async () => void vi.advanceTimersByTime(10_000))
    const again: Pending = { ...q, text: 'And the index: build it now, or after the backfill?', since: world().at }
    swap(again)
    await click(choices(again)[1])
    await act(async () => void vi.advanceTimersByTime(STILL_WAITS_MS - 10_000))
    expect(text($('.pending-settled', card(again)))).toContain(`answered ${again.choices[1].label}`)
    await act(async () => void vi.advanceTimersByTime(10_000))
    expect(text($('[role="alert"]', card(again)))).toBe(`✕ Answered "${again.choices[1].label}", and it still waits.`)
    expect(answer).toHaveBeenCalledTimes(2)
  })
})

describe('in your words', () => {
  test('R opens the field on the armed card with the caret in it, and Enter sends it through actions().reply', async () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    expect(field(q)).toBeNull()
    let opened = false
    act(() => void (opened = replyArmed()))
    expect(opened).toBe(true)
    expect(document.activeElement).toBe(field(q))
    type(field(q)!, '  Online, but pause it during the nightly export.  ')
    const enter = await press(field(q)!, 'Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(said).toEqual([`reply ${q.session} Online, but pause it during the nightly export.`])
    expect(sessionOf(world(), q.session)?.lastPrompt).toBe('Online, but pause it during the nightly export.')
  })

  test('R is not spent when nothing armed takes a reply', () => {
    expect(replyArmed()).toBe(false)
    const merge = of('merge', 'green')
    expect(merge.reply).toBe(false)
    at({ pending: merge.id })
    draw()
    expect(replyArmed()).toBe(false)
    expect($('.pending-own', card(merge))).toBeNull()
    expect(field(merge)).toBeNull()
  })

  test('Enter with nothing typed, and Shift+Enter, send nothing', async () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    act(() => void replyArmed())
    await press(field(q)!, 'Enter')
    type(field(q)!, 'One line')
    const newline = await press(field(q)!, 'Enter', { shiftKey: true })
    expect(newline.defaultPrevented).toBe(false)
    await press(field(q)!, 'Enter', { isComposing: true })
    expect(said).toEqual([])
    expect(field(q)).not.toBeNull()
  })

  test('Esc closes the field, keeps what was typed, and is not passed on to the frame', async () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    const heard: string[] = []
    const frame = (e: KeyboardEvent) => void heard.push(e.key)
    window.addEventListener('keydown', frame)
    act(() => void replyArmed())
    type(field(q)!, 'Half a thought')
    await press(field(q)!, 'a')
    await press(field(q)!, 'Escape')
    window.removeEventListener('keydown', frame)
    expect(heard).toEqual(['a'])
    expect(field(q)).toBeNull()
    expect(text($('.pending-own', card(q)))).toBe('R in your words Half a thought')
    expect(document.activeElement).toBe($('.pending-own', card(q)))
    await click($('.pending-own', card(q)))
    expect(field(q)!.value).toBe('Half a thought')
  })

  test('walking on to another item closes the field and keeps what was typed', () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    act(() => void replyArmed())
    type(field(q)!, 'Half a thought')
    at({ session: of('stalled').session })
    at({ session: q.session })
    expect(field(q)).toBeNull()
    expect(text($('.pending-own', card(q)))).toBe('R in your words Half a thought')
  })

  test('a refused reply keeps the field and the words', async () => {
    const q = of('question')
    acting({ reply: async () => ({ ok: false, why: 'Its input box holds a draft.' }) })
    at({ session: q.session })
    draw()
    act(() => void replyArmed())
    type(field(q)!, 'Use batches')
    await press(field(q)!, 'Enter')
    expect(text($('[role="alert"]', card(q)))).toBe('✕ Its input box holds a draft.')
    expect(field(q)!.value).toBe('Use batches')
  })

  test('a reply that was taken settles the card with the words', async () => {
    const q = of('question')
    acting({ reply: async () => ({ ok: true }) })
    at({ session: q.session })
    draw()
    act(() => void replyArmed())
    type(field(q)!, 'Use batches')
    await press(field(q)!, 'Enter')
    expect(text($('.pending-settled', card(q)))).toBe('✓ answered in your words Use batches')
    expect(field(q)).toBeNull()
    expect(text($('.pending-echo'))).toBe('✓ in your words')
  })

  test('a reply that was taken leaves no field and no draft behind when the item still waits', async () => {
    const q = of('question')
    acting({ reply: async () => ({ ok: true }) })
    at({ session: q.session })
    draw()
    act(() => void replyArmed())
    type(field(q)!, 'Use batches')
    vi.useFakeTimers()
    await press(field(q)!, 'Enter')
    await act(async () => void vi.advanceTimersByTime(STILL_WAITS_MS))
    expect(text($('[role="alert"]', card(q)))).toBe('✕ Answered "Use batches", and it still waits.')
    expect(field(q)).toBeNull()
    expect(text($('.pending-own', card(q)))).toBe('R in your words')
  })

  test('starts from mnemo’s suggestion when the item has one', () => {
    const s: Pending = { ...of('stalled'), suggestedReply: 'Run only the route tests.' }
    act(() => worldStore.getState().set({ ...world(), pending: world().pending.map((p) => (p.id === s.id ? s : p)) }))
    at({ session: s.session })
    draw()
    act(() => void replyArmed())
    expect(field(s)!.value).toBe('Run only the route tests.')
    expect([field(s)!.selectionStart, field(s)!.selectionEnd]).toEqual([0, 'Run only the route tests.'.length])
    expect(text($('.pending-words-keys', card(s)))).toContain("mnemo's suggestion")
  })

  test('drawn twice, the first drawing takes the caret from the key and the clicked one from a click', async () => {
    const q = of('question')
    at({ session: q.session })
    draw(
      <>
        <PendingCard pending={q} armed />
        <PendingCard pending={q} armed />
      </>,
    )
    const fields = () => $$<HTMLTextAreaElement>('textarea')
    act(() => void replyArmed())
    expect(fields().length).toBe(2)
    expect(document.activeElement).toBe(fields()[0])
    await press(fields()[0], 'Escape')
    await click($$('.pending-own')[1])
    expect(document.activeElement).toBe(fields()[1])
  })

  test('drawn twice with the first one out of sight, the key puts the caret in the one that shows', () => {
    const q = of('question')
    at({ session: q.session })
    draw(
      <>
        <PendingCard pending={q} armed />
        <PendingCard pending={q} armed />
      </>,
    )
    const hidden = $$('[data-pending-id]')[0]
    // jsdom lays nothing out, so it has no `checkVisibility`: this one says what a browser would
    Object.defineProperty(Element.prototype, 'checkVisibility', {
      configurable: true,
      value(this: Element) {
        return this !== hidden
      },
    })
    try {
      act(() => void replyArmed())
      expect(document.activeElement).toBe($$<HTMLTextAreaElement>('textarea')[1])
    } finally {
      Reflect.deleteProperty(Element.prototype, 'checkVisibility')
    }
  })
})

describe('the count in the top bar', () => {
  const count = () => $('.pending-waiting')!
  const lit = () => $$('.pending-marks > *').map((m) => m.dataset.on === 'true')

  test('says how many wait, and one fewer after an answer', async () => {
    draw()
    expect(text(count())).toBe('5 wait for you N')
    at({ session: of('question').session })
    await act(() => answerArmed(1))
    expect(text($('.pending-waiting > b'))).toBe('4')
  })

  test('walks what waits in roster order on a click, and wraps', async () => {
    draw()
    const order = pendingInOrder(world()).map((p) => p.id)
    const seen: (string | null)[] = []
    for (let i = 0; i < order.length + 1; i++) {
      await click(count())
      seen.push(route().pending)
      expect(route().session).toBe(world().pending.find((p) => p.id === route().pending)!.session)
    }
    expect(seen).toEqual([...order, order[0]])
  })

  test('has a mark per item in that order, and lights the armed one', () => {
    draw()
    const order = pendingInOrder(world())
    expect($$('.pending-marks > *').map((m) => m.dataset.tone)).toEqual(order.map((p) => (p.kind === 'merge' ? 'ready' : p.kind === 'stalled' ? 'stalled' : 'need')))
    expect(lit()).toEqual(order.map(() => false))
    expect($('.pending-marks')!.getAttribute('aria-label')).toBeNull()
    at({ pending: order[3].id })
    expect(lit()).toEqual(order.map((_, i) => i === 3))
    expect($('.pending-marks')!.getAttribute('aria-label')).toBe('on 4 of 5')
  })

  test('says "waits" for one, and that nothing waits for none, which is not a button', () => {
    draw()
    act(() => worldStore.getState().set({ ...world(), pending: world().pending.slice(0, 1) }))
    expect(text(count())).toBe('1 waits for you N')
    act(() => worldStore.getState().set({ ...world(), pending: [] }))
    expect(text(count())).toBe('nothing waits for you')
    expect(count().tagName).toBe('SPAN')
  })

  test('keeps to nine marks and counts the rest', () => {
    const one = of('question')
    const many = Array.from({ length: 12 }, (_, i): Pending => ({ ...one, id: `${one.id}~${i}` }))
    act(() => worldStore.getState().set({ ...world(), pending: many }))
    draw()
    expect($$('.pending-marks > svg').length).toBe(9)
    expect(text($('.pending-more'))).toBe('+3')
  })

  test('says the answer that was just taken, and nothing after a refusal', async () => {
    const q = of('question')
    at({ session: q.session })
    draw()
    expect($('.pending-echo')).toBeNull()
    acting({ answer: async () => ({ ok: false, why: 'No.' }) })
    await act(() => answerArmed(1))
    expect($('.pending-echo')).toBeNull()
    acting({})
    await act(() => answerArmed(3))
    expect(text($('.pending-echo'))).toBe(`✓ ${q.choices[2].label}`)
    // once it has played it is gone for good: a top bar drawn again does not say it twice
    act(() => void $('.pending-echo')!.dispatchEvent(new Event('animationend', { bubbles: true })))
    expect($('.pending-echo')).toBeNull()
    expect(pendingStore.getState().last).toBeNull()
  })
})

test('actions are read at the moment of acting, never kept', async () => {
  const q = of('question')
  at({ session: q.session })
  draw()
  const later = vi.fn(async (): Promise<Outcome> => ({ ok: false, why: 'Later.' }))
  undo()
  undo = setActions({ ...actions(), answer: later })
  await click(choices(q)[0])
  expect(later).toHaveBeenCalledWith(q.id, 1)
})

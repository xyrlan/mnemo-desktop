import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setActions, type Actions, type Outcome } from '../world/actions'
import { HOME, routeStore, useRoute } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { worldStore } from '../world/store'
import type { Session, World } from '../world/types'
import { Instruments, READINGS, showReading, stepReading } from './index'
import { reason } from './read'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sample = sampleWorld()
const titled = (start: string): Session => sample.sessions.find((s) => s.title.startsWith(start))!
const retries = titled('Idempotent retries')
const pagination = titled('Cursor pagination')
const roadmap = titled('Notes for the 2.5 roadmap')

let root: Root
let host: HTMLElement
/** What the sample's actions did, in order. */
let said: string[]
let undo: () => void
/** The column's width in px, as the layout measures it; jsdom lays nothing out. */
let columnPx = 0

const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

beforeEach(() => {
  columnPx = 0
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => columnPx })
  worldStore.getState().set(sampleWorld())
  said = []
  undo = setActions(sampleActions(() => worldStore.getState().world, worldStore.getState().set, said))
  routeStore.setState({ route: { ...HOME, view: 'console', session: retries.id }, recent: [] })
  host = document.createElement('div')
  host.className = 'mn'
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  undo()
  if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
})

const mount = (node: ReactNode) => act(() => root.render(node))
/** Lets what was asked of the actions answer. */
const settle = () => act(async () => {})

/** As the frame does: the instruments of the selected session. */
function OfSelected({ at }: { at?: number | null }) {
  const session = useRoute((r) => r.session)
  return session ? <Instruments sessionId={session} at={at} /> : null
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const hit = host.querySelector<T>(selector)
  if (!hit) throw new Error(`nothing matches ${selector}`)
  return hit
}
const $$ = (selector: string): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(selector)]
/** Words with no white space: what is said, whatever elements say it. */
const t = (words: string): string => words.replace(/\s+/g, '')
const text = (el: Element): string => t(el.textContent ?? '')
const head = (reading: string) => $<HTMLButtonElement>(`[data-inst="${reading}"] .instruments-head`)
const open = () => $$('.instruments-body').map((b) => b.closest<HTMLElement>('[data-inst]')!.dataset.inst)
const reading = () => routeStore.getState().route.reading
const click = (el: HTMLElement) => act(() => el.click())
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => void el.dispatchEvent(event))
  return event
}
const section = (title: string) => $(`[data-sec="${title}"]`)

describe('the three headers', () => {
  test('each says its headline numbers, whichever is open', () => {
    mount(<Instruments sessionId={retries.id} />)
    expect(text(head('context'))).toBe(t('Context and tokens 31% full · 67M spent'))
    expect(text(head('memory'))).toBe(t('Memory 4 given · 10 held back'))
    expect(text(head('sight'))).toBe(t('Sight 7 on the web · 3 edited · 0 PRs'))
  })

  test("another session's are its own", () => {
    mount(<Instruments sessionId={pagination.id} />)
    expect(text(head('context'))).toBe(t('Context and tokens 71% full · 16M spent'))
    expect(text(head('sight'))).toBe(t('Sight 0 on the web · 3 edited · 1 PR'))
  })

  test('a session by its short id is the same session', () => {
    mount(<Instruments sessionId={retries.short} />)
    expect($('[data-instruments]').dataset.session).toBe(retries.id)
  })

  test('a session the world does not have draws nothing', () => {
    mount(<Instruments sessionId="no-such-session" />)
    expect(host.innerHTML).toBe('')
  })
})

describe('a narrow column', () => {
  test('opens one reading at a time: the one the route has in front', () => {
    mount(<Instruments sessionId={retries.id} />)
    expect($('[data-instruments]').dataset.layout).toBe('one')
    expect(open()).toEqual(['context'])
    expect(head('context').getAttribute('aria-expanded')).toBe('true')
    expect(head('memory').getAttribute('aria-expanded')).toBe('false')
    // a header names the reading it opens, and two instruments on one page do not share names
    expect(head('context').getAttribute('aria-controls')).toBe($('.instruments-body').id)
    expect($$('.instruments-head').length).toBe(3)
  })

  test('a header puts its reading in front', () => {
    mount(<Instruments sessionId={retries.id} />)
    click(head('memory'))
    expect(reading()).toBe('memory')
    expect(open()).toEqual(['memory'])
    expect(text(section('Held back'))).toContain(t('below the bar to speak'))
    click(head('sight'))
    expect(reading()).toBe('sight')
    expect(open()).toEqual(['sight'])
  })

  test('the frame puts a reading in front through the route', () => {
    mount(<Instruments sessionId={retries.id} />)
    act(() => showReading('sight'))
    expect(open()).toEqual(['sight'])
    act(() => stepReading(1))
    expect(open()).toEqual(['context'])
    act(() => stepReading(-1))
    expect(open()).toEqual(['sight'])
    expect(READINGS).toEqual(['context', 'memory', 'sight'])
  })
})

describe('a wide column', () => {
  test('opens all three from 46em, whatever the route has in front', async () => {
    columnPx = 61 * 16
    routeStore.getState().go({ reading: 'sight' })
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    expect($('[data-instruments]').dataset.layout).toBe('pair')
    expect(open()).toEqual(['context', 'memory', 'sight'])
    expect($$('.instruments-head').every((h) => h.getAttribute('aria-expanded') === 'true')).toBe(true)
  })

  test('lays them three across from 84em', async () => {
    columnPx = 90 * 16
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    expect($('[data-instruments]').dataset.layout).toBe('three')
    expect(open()).toEqual(['context', 'memory', 'sight'])
  })

  test('one too narrow for all three opens one', () => {
    columnPx = 45 * 16
    mount(<Instruments sessionId={retries.id} />)
    expect($('[data-instruments]').dataset.layout).toBe('one')
    expect(open()).toEqual(['context'])
  })
})

describe('keys', () => {
  test('] and [ walk the readings while focus is inside, wrapping, and focus follows', () => {
    mount(<Instruments sessionId={retries.id} />)
    head('context').focus()
    const first = press(head('context'), ']')
    expect(reading()).toBe('memory')
    expect(first.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(head('memory'))
    press(document.activeElement!, ']')
    press(document.activeElement!, ']')
    expect(reading()).toBe('context')
    expect(document.activeElement).toBe(head('context'))
    press(document.activeElement!, '[')
    expect(reading()).toBe('sight')
    expect(document.activeElement).toBe(head('sight'))
  })

  test('a key pressed from inside an open reading works too, and keeps focus inside', () => {
    mount(<Instruments sessionId={retries.id} />)
    const body = $('.instruments-body')
    body.focus()
    press(body, ']')
    expect(reading()).toBe('memory')
    expect($('[data-instruments]').contains(document.activeElement)).toBe(true)
  })

  test('are not taken outside the instruments, with a modifier, or from a field', () => {
    mount(
      <>
        <button id="elsewhere" type="button" />
        <Instruments sessionId={retries.id} />
      </>,
    )
    const outside = press($('#elsewhere'), ']')
    expect(reading()).toBe('context')
    expect(outside.defaultPrevented).toBe(false)
    press(document.body, ']')
    expect(reading()).toBe('context')
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      const chord = press(head('context'), ']', mod)
      expect(reading()).toBe('context')
      expect(chord.defaultPrevented).toBe(false)
    }
    // a field inside the instruments keeps its keys
    const field = document.createElement('input')
    $('.instruments-body').appendChild(field)
    const typed = press(field, ']')
    expect(reading()).toBe('context')
    expect(typed.defaultPrevented).toBe(false)
    field.remove()
  })

  test('other keys pass through untouched', () => {
    mount(<Instruments sessionId={retries.id} />)
    for (const key of ['ArrowDown', 'ArrowLeft', 'n', '1', 'Enter', 'Escape', 'c']) {
      const e = press(head('context'), key)
      expect(e.defaultPrevented).toBe(false)
    }
    expect(reading()).toBe('context')
  })
})

describe('context and tokens', () => {
  test('says how full, what is free, and the compactions', () => {
    mount(<Instruments sessionId={retries.id} />)
    const body = text($('.instruments-body'))
    expect(body).toContain(t('31% 310k of a 1.0M window 690k free'))
    expect(body).toContain(t('1 compaction. The last, 3h ago, took 784k down to 22k (auto).'))
    expect(text(section('Spent by this session'))).toContain(t('61M its own calls 6.8M 2 sub-agents'))
    expect(text(section('Spent by this session'))).toContain(t('output 371k 145k of it thinking'))
    expect(text(section('Its sub-agents'))).toContain(t('Map the billing module Explore · 36 calls 4.8M'))
  })

  test('a session nearly full says so; one never compacted says so', () => {
    mount(<Instruments sessionId={titled('Dark theme contrast').id} />)
    expect(text($('.instruments-big'))).toBe(t('83% 166k of a 200k window close to full, a compaction is near'))
    expect($('.instruments-big-n').dataset.hot).toBe('true')
    expect(text($('.instruments-body'))).toContain(t('Never compacted.'))
    expect(text(section('Its sub-agents'))).toContain(t('It sent no sub-agent.'))
    expect(text(section('Its tree is itself'))).toContain(t('No children: the tree is this session.'))
  })

  test("a child's cost, as Claude Code recorded it", () => {
    mount(<Instruments sessionId={pagination.id} />)
    const cost = pagination.cost!
    expect(text($('[data-cost]'))).toContain(t(`Claude Code recorded $${cost.usd.toFixed(2)}`))
    expect(text($('[data-cost]'))).toContain(t(`+${cost.linesAdded} −${cost.linesRemoved} lines`))
    mount(<Instruments sessionId={retries.id} />)
    expect(host.querySelector('[data-cost]')).toBeNull()
  })

  test('a row of the tree selects that session, and the instruments follow', () => {
    mount(<OfSelected />)
    const rows = $$('.instruments-tree')
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual(['true', null, null, null, null])
    const child = rows.find((r) => text(r).includes(t('Cursor pagination')))!
    click(child)
    expect(routeStore.getState().route.session).toBe(pagination.id)
    expect($('[data-instruments]').dataset.session).toBe(pagination.id)
    expect(text(head('context'))).toContain(t('71% full'))
    expect($$('.instruments-tree').map((r) => r.getAttribute('aria-current'))).toEqual([null, null, null, 'true', null])
  })

  test("the session's own account leads the plan windows", () => {
    mount(<Instruments sessionId={retries.id} />)
    const plans = $$('.instruments-plan')
    expect(plans.map((p) => [text(p.querySelector('b')!), p.dataset.own])).toEqual([
      ['second', 'true'],
      ['main', undefined],
    ])
    expect(text(plans[0])).toContain(t("this session's account"))
    expect(text(plans[0])).toContain(t('5-hour window 8% resets in 2h 20m'))
  })

  test('a long list keeps its tail one press away', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, description: `Agent ${i}`, agentType: 'Explore', model: null, calls: i + 1, tokens: { input: 0, output: (9 - i) * 1000, cacheRead: 0, cacheCreation: 0, thinking: 0 } }))
    const world: World = { ...sample, sessions: sample.sessions.map((s) => (s.id === retries.id ? { ...s, tokens: { ...s.tokens, subagents: many } } : s)) }
    worldStore.getState().set(world)
    mount(<Instruments sessionId={retries.id} />)
    const rows = () => $$('[data-sec="Its sub-agents"] .instruments-row').map((r) => text(r.querySelector('.instruments-row-m')!))
    expect(rows()).toEqual([t('Agent 0'), t('Agent 1'), t('Agent 2'), t('Agent 3'), t('Agent 4'), t('Agent 5')])
    const more = $<HTMLButtonElement>('[data-sec="Its sub-agents"] .instruments-more')
    expect(text(more)).toBe(t('and 3 more'))
    click(more)
    expect(rows().length).toBe(9)
    expect(rows()[8]).toBe(t('Agent 8'))
  })
})

describe('memory', () => {
  beforeEach(() => routeStore.getState().go({ reading: 'memory' }))

  test('leads with what mnemo held back, newest first, with every candidate and its scores', () => {
    mount(<Instruments sessionId={retries.id} />)
    const sections = $$('.instruments-sec').map((s) => s.dataset.sec)
    expect(sections).toEqual(['Held back', 'Given', 'Asked for', 'Loaded at the start', "Claude Code's memory since", 'Corrections mnemo wrote down'])
    const held = $$('.instruments-held')
    expect(held.length).toBe(10)
    const newest = [...retries.memory.trail.considered].sort((a, b) => b.at - a.at)[0]
    expect(text(held[0].querySelector('.instruments-held-r')!)).toBe(t(reason(newest.reason)))
    expect([...held[0].querySelectorAll('.instruments-slug')].map(text)).toEqual(newest.candidates.map((c) => c.slug))
    expect(text(held[0].querySelector('.instruments-cand')!)).toBe(t(`${newest.candidates[0].slug} ${newest.candidates[0].score.toFixed(2)} ${newest.candidates[0].judge!.toFixed(2).replace(/^0/, '')}`))
  })

  test('the legend counts what the dial marks', () => {
    mount(<Instruments sessionId={retries.id} />)
    expect($$('.instruments-lg').map(text)).toEqual([t('4 given by mnemo'), t('4 asked for'), t('10 held back'), t('15 prompts mnemo read')])
    expect($$('.instruments-dial-given').length).toBe(4)
    expect($$('.instruments-dial-asked').length).toBe(4)
    expect($$('.instruments-dial-held').length).toBe(10)
  })

  test('a session with little says what it lacks in one line, not in empty sections', () => {
    mount(<Instruments sessionId={roadmap.id} />)
    expect($$('.instruments-sec').map((s) => s.dataset.sec)).toEqual(['Held back', 'Loaded at the start', "Claude Code's memory since"])
    expect(text($('.instruments-lacks'))).toBe(t('Also: no rule given, none asked for.'))
  })

  test('says the vault in a line', () => {
    mount(<Instruments sessionId={retries.id} />)
    expect(text($('.instruments-vault'))).toBe(t('The vault holds 4,160 rules. Across every session mnemo read 1,039 prompts, spoke on 219 and stayed silent on 819.'))
  })
})

describe('sight', () => {
  beforeEach(() => routeStore.getState().go({ reading: 'sight' }))

  test('a link opens outside the app, through the actions', async () => {
    mount(<Instruments sessionId={retries.id} />)
    const source = $$('.instruments-src').find((s) => text(s).includes(t('Designing robust retries')))!
    click(source)
    await settle()
    expect(said).toEqual(['external https://example.org/blog/retries'])
    click($$('[data-sec="Files edited"] .instruments-out')[0])
    await settle()
    expect(said[1]).toBe(`external ${retries.files.edited[0].path}`)
    expect(host.querySelector('.instruments-said')).toBeNull()
  })

  test('a pull request opens the same way', async () => {
    mount(<Instruments sessionId={pagination.id} />)
    const pr = pagination.prs[0]
    expect(text($('.instruments-pr'))).toBe(t(`#${pr.number} ${pr.title} ${pr.state} checks ${pr.ci}`))
    click($('.instruments-pr'))
    await settle()
    expect(said).toEqual([`external ${pr.url}`])
  })

  test('what a refused action answered is said in place, until the next one', async () => {
    let answer: Outcome = { ok: false, why: 'No browser is set for links.' }
    const acting: Actions = { ...sampleActions(() => worldStore.getState().world, worldStore.getState().set, said), external: async () => answer }
    const back = setActions(acting)
    mount(<Instruments sessionId={retries.id} />)
    expect(host.querySelector('.instruments-said')).toBeNull()
    click($$('.instruments-src')[0])
    await settle()
    expect(text($('.instruments-said'))).toBe(t('No browser is set for links.'))
    expect($('.instruments-said').getAttribute('role')).toBe('status')
    answer = { ok: true }
    click($$('.instruments-src')[0])
    await settle()
    expect(host.querySelector('.instruments-said')).toBeNull()
    back()
  })

  test('each screenshot is asked of the actions once, by session and shot, and shown', async () => {
    const asked: string[] = []
    const acting: Actions = { ...sampleActions(() => worldStore.getState().world, worldStore.getState().set, said), shot: async (session, shot) => (asked.push(`${session} ${shot}`), `blob:${shot}`) }
    const back = setActions(acting)
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    const ids = retries.web.shots.map((x) => x.id)
    expect(asked).toEqual(ids.map((id) => `${retries.id} ${id}`))
    expect($$('.instruments-shot img').map((img) => img.getAttribute('src'))).toEqual(ids.map((id) => `blob:${id}`))
    // drawn again, and opened large, it is not asked again
    act(() => worldStore.getState().set({ ...worldStore.getState().world }))
    click($$('.instruments-shot')[0])
    await settle()
    expect(asked.length).toBe(2)
    back()
  })

  test('a picture that is gone says so', async () => {
    const back = setActions({ ...sampleActions(() => worldStore.getState().world, worldStore.getState().set, said), shot: async () => null })
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    expect($$('.instruments-shot img').length).toBe(0)
    expect($$('.instruments-shot-gone').map(text)).toEqual([t('the picture is gone'), t('the picture is gone')])
    back()
  })

  test('a screenshot opens large; arrows walk the shots and Esc returns to where it was opened', async () => {
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    const fleet: string[] = []
    const listen = (e: KeyboardEvent) => fleet.push(e.key)
    window.addEventListener('keydown', listen)
    const thumbs = $$('.instruments-shot')
    click(thumbs[1])
    await settle()
    const light = () => host.querySelector<HTMLElement>('.instruments-veil')
    // it is drawn in the frame's root, over the window, and takes focus
    expect(light()!.parentElement).toBe(host)
    expect(document.activeElement).toBe(light())
    expect(text(light()!.querySelector('figcaption')!)).toContain(t('Order 8841 · Lumen http://localhost:5173/orders/8841 2 of 2'))
    press(light()!, 'ArrowRight')
    expect(text(light()!.querySelector('figcaption')!)).toContain(t('Orders · Lumen http://localhost:5173/orders 1 of 2'))
    press(light()!, 'ArrowLeft')
    expect(text(light()!.querySelector('figcaption')!)).toContain(t('2 of 2'))
    // a key that is not the picture's goes on to the fleet, and does not turn the reading under it
    press(light()!, 'n')
    press(light()!, ']')
    expect(reading()).toBe('sight')
    expect(light()).not.toBeNull()
    press(light()!, 'Escape')
    expect(light()).toBeNull()
    expect(document.activeElement).toBe(thumbs[1])
    expect(fleet).toEqual(['n', ']'])
    window.removeEventListener('keydown', listen)
  })

  test('a session that has seen nothing on the web lists what it has and names what it has not', () => {
    mount(<Instruments sessionId={roadmap.id} />)
    expect($$('.instruments-sec').map((s) => s.dataset.sec)).toEqual(['Files edited', 'Files read'])
    expect(text($('.instruments-lacks'))).toBe(t('Also: no page, search, fetch or artifact, no pull request.'))
  })
})

describe('at a moment', () => {
  const at = Date.parse('2026-11-09T18:30:00Z') // three hours before the sample's now, before its compaction

  test('without `at`, and with one that is not in the past, nothing is dimmed', async () => {
    columnPx = 90 * 16
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    expect($('[data-instruments]').dataset.at).toBeUndefined()
    expect($$('[data-later]')).toEqual([])
    expect(host.querySelector('.instruments-asof')).toBeNull()
    mount(<Instruments sessionId={retries.id} at={null} />)
    expect($$('[data-later]')).toEqual([])
    mount(<Instruments sessionId={retries.id} at={sample.at + 60_000} />)
    expect($$('[data-later]')).toEqual([])
    expect(host.querySelector('.instruments-asof')).toBeNull()
  })

  test('the headers count to the moment', () => {
    mount(<Instruments sessionId={retries.id} at={at} />)
    expect($('[data-instruments]').dataset.at).toBe(String(at))
    expect(text(head('context'))).toBe(t('Context and tokens 70% full · ≈ 37M spent'))
    expect(text(head('memory'))).toBe(t('Memory 2 given · 6 held back'))
    expect(text(head('sight'))).toBe(t('Sight 0 on the web · 0 edited · 0 PRs'))
    expect(text($('.instruments-asof'))).toContain(t('3h before now'))
  })

  test('context says what it was then, and that its compaction had not happened', () => {
    mount(<Instruments sessionId={retries.id} at={at} />)
    const body = text($('.instruments-body'))
    expect(body).toContain(t('70% 698k of a 1.0M window 302k free'))
    expect(body).toContain(t('Not compacted yet at this moment; 1 later.'))
    expect(body).toContain(t('An estimate: about 55% of what it has spent to now'))
    expect($('.instruments-chart-mark').dataset.later).toBe('true')
    expect(host.querySelector('.instruments-chart-hand')).not.toBeNull()
  })

  test('memory dims what had not happened yet and keeps what had', () => {
    routeStore.getState().go({ reading: 'memory' })
    mount(<Instruments sessionId={retries.id} at={at} />)
    const held = $$('.instruments-held')
    expect(held.length).toBe(10)
    expect(held.map((h) => h.dataset.later)).toEqual([...Array(6).fill(undefined), ...Array(4).fill('true')])
    expect(text(held[0])).toContain(t('before'))
    expect(text(held[9])).toContain(t('later'))
    expect($$('.instruments-lg').map(text).slice(0, 3)).toEqual([t('2 given by mnemo'), t('4 asked for'), t('6 held back')])
    expect($$('[data-kind="given"]').map((g) => g.dataset.later)).toEqual([undefined, undefined, 'true', 'true'])
    expect(host.querySelector('.instruments-dial-hand')).not.toBeNull()
  })

  test('sight dims the pages it had not opened yet', async () => {
    routeStore.getState().go({ reading: 'sight' })
    mount(<Instruments sessionId={retries.id} at={Date.parse('2026-11-09T20:50:00Z')} />)
    await settle()
    expect($$('.instruments-shot').map((s) => s.dataset.later)).toEqual(['true', 'true'])
    expect($('.instruments-search').dataset.later).toBeUndefined()
    expect(text(head('sight'))).toBe(t('Sight 2 on the web · 3 edited · 0 PRs'))
  })
})

describe('motion', () => {
  test('nothing enters on the first draw; the readings rise when the session changes', () => {
    mount(<OfSelected />)
    expect($('.instruments-body').dataset.enter).toBeUndefined()
    expect(host.querySelector('.instruments-flash')).toBeNull()
    act(() => routeStore.getState().go({ session: pagination.id }))
    expect($('.instruments-body').dataset.enter).toBe('true')
    // the world moving on does not take the entrance back mid-way
    act(() => worldStore.getState().set({ ...worldStore.getState().world }))
    expect($('.instruments-body').dataset.enter).toBe('true')
  })

  test('a reading put in front after the first draw is marked for a moment', async () => {
    columnPx = 61 * 16
    mount(<Instruments sessionId={retries.id} />)
    await settle()
    expect(host.querySelector('.instruments-flash')).toBeNull()
    click(head('sight'))
    expect($$('.instruments-flash').map((f) => f.closest<HTMLElement>('[data-inst]')!.dataset.inst)).toEqual(['sight'])
  })
})

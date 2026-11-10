import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ParentRef } from '../parent'
import { addLine, createJarvisStore, foldParent, foldResearch, type JarvisStore, type ResearchRun } from '../store'
import { presenceHosts } from './james'
import { JarvisPanel } from './Panel'
import { JamesPresence } from './Presence'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root
let store: JarvisStore
const jarvis = { ask: vi.fn(async () => {}), answer: vi.fn(async () => {}), ensure: vi.fn(async () => true), openUrl: vi.fn(async (_url: string) => {}) }
const ref = (sessionId: string, project: string): ParentRef => ({ sessionId, project, root: `/Users/you/code/${project}`, request: 'corrige o login', host: 'claude', startedAt: 0 })

// jsdom plays no clip: what the orb asks of its clip is recorded instead.
const clip = { play: vi.fn(async () => {}), pause: vi.fn() }
let reduced = false

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  store = createJarvisStore()
  clip.play.mockClear()
  clip.pause.mockClear()
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(clip.play)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(clip.pause)
  reduced = false
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduced && query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
  jarvis.ask.mockClear()
  jarvis.answer.mockClear()
  jarvis.ensure.mockClear()
  jarvis.openUrl.mockClear()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const draw = () => act(() => root.render(<JarvisPanel store={store} jarvis={jarvis} shortcut="Ctrl+Shift+J" />))
const $ = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel)
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click())

describe('closed', () => {
  const presence = () => $<HTMLButtonElement>('.jv-dock button')

  test('with no top bar that has him, his presence is docked and opens the panel', () => {
    draw()
    expect($('.jv-panel')).toBeNull()
    expect(presence()!.title).toBe('James (Ctrl+Shift+J)')
    expect(presence()!.getAttribute('aria-expanded')).toBe('false')
    click(presence())
    expect(store.getState().open).toBe(true)
    expect($('[aria-label="James"]')).not.toBeNull()
    expect($('.jv-dock')).toBeNull()
    expect(document.activeElement).toBe($('textarea'))
  })

  test('the docked presence counts the approvals waiting', () => {
    store.setState({ parents: foldParent([], { kind: 'approval', parent: ref('a', 'tasklist'), question: 'Push?' }) })
    draw()
    expect(presence()!.querySelector('.jv-presence-need')!.textContent).toBe('1')
    expect(presence()!.getAttribute('aria-label')).toBe('James: 1 approval waits')
  })

  test('where a top bar has his presence, the panel docks no second one; it comes back when the bar goes', () => {
    const bar = document.body.appendChild(document.createElement('div'))
    const top = createRoot(bar)
    act(() => top.render(<JamesPresence />))
    expect(presenceHosts.getState().hosts).toBe(1)
    draw()
    expect(host.innerHTML).toBe('')

    act(() => top.unmount())
    bar.remove()
    expect(presenceHosts.getState().hosts).toBe(0)
    expect(presence()).not.toBeNull()
  })
})

describe('his orb, in the panel', () => {
  const orb = () => $('[data-asset="james-orb"]')!

  test('is the clip, the WebM first and the MP4 second, with its first frame as poster', () => {
    store.setState({ open: true })
    draw()
    expect(orb().tagName).toBe('VIDEO')
    expect([...orb().querySelectorAll('source')].map((s) => s.type)).toEqual(['video/webm', 'video/mp4'])
    expect(orb().getAttribute('poster')).toMatch(/james-orb-first\.jpg$/)
    expect((orb() as HTMLVideoElement).loop).toBe(true)
  })

  test('at rest it is still: the clip is never played', () => {
    store.setState({ open: true })
    draw()
    expect(clip.play).not.toHaveBeenCalled()
    expect(orb().hasAttribute('data-alive')).toBe(false)
  })

  test.each([
    ['listens', { voice: 'listening' }],
    ['transcribes what he heard', { voice: 'transcribing' }],
    ['works on a request', { busy: true }],
    ['speaks', { voice: 'speaking' }],
  ] as const)('it turns while James %s, and holds when he stops', (_, state) => {
    store.setState({ open: true })
    draw()
    act(() => store.setState(state))
    expect(clip.play).toHaveBeenCalledTimes(1)
    expect(orb().hasAttribute('data-alive')).toBe(true)

    clip.pause.mockClear()
    act(() => store.setState({ voice: 'idle', busy: false }))
    expect(clip.pause).toHaveBeenCalledTimes(1)
    expect(clip.play).toHaveBeenCalledTimes(1)
    expect(orb().hasAttribute('data-alive')).toBe(false)
  })

  test('it holds while he only waits for a follow-up', () => {
    store.setState({ open: true, voice: 'waiting' })
    draw()
    expect(clip.play).not.toHaveBeenCalled()
  })

  test('with motion reduced it is its first frame, and no clip is loaded', () => {
    reduced = true
    store.setState({ open: true, voice: 'speaking' })
    draw()
    expect(orb().tagName).toBe('IMG')
    expect(orb().getAttribute('src')).toMatch(/james-orb-first\.jpg$/)
    expect($('video')).toBeNull()
    expect(clip.play).not.toHaveBeenCalled()
    // Still, it says he is alive as it says it moving: lit, and dim again at rest.
    expect(orb().hasAttribute('data-alive')).toBe(true)
    act(() => store.setState({ voice: 'idle' }))
    expect(orb().hasAttribute('data-alive')).toBe(false)
  })

  test("the frame's motion switch stills it too, and gives it back", async () => {
    const frame = document.body.appendChild(document.createElement('div'))
    frame.className = 'mn'
    frame.dataset.view = 'console'
    frame.dataset.motion = 'reduced'
    store.setState({ open: true, voice: 'speaking' })
    draw()
    expect(orb().tagName).toBe('IMG')
    expect($('.jv-panel')!.getAttribute('data-motion')).toBe('reduced')
    expect(clip.play).not.toHaveBeenCalled()

    // The switch is turned off: the attribute goes, and the orb turns again.
    await act(async () => frame.removeAttribute('data-motion'))
    expect(orb().tagName).toBe('VIDEO')
    expect($('.jv-panel')!.hasAttribute('data-motion')).toBe(false)
    expect(clip.play).toHaveBeenCalledTimes(1)
    frame.remove()
  })
})

test('Enter sends what was typed; Shift+Enter does not', () => {
  store.setState({ open: true })
  draw()
  const field = $<HTMLTextAreaElement>('textarea')!
  const type = (value: string) => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      set.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  type('como está o git do tasklist?')
  act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })))
  expect(jarvis.ask).not.toHaveBeenCalled()
  act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  expect(jarvis.ask).toHaveBeenCalledWith('como está o git do tasklist?')
  expect(field.value).toBe('')
})

test('Esc in the field closes it', () => {
  store.setState({ open: true })
  draw()
  act(() => void $('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(store.getState().open).toBe(false)
})

test('the conversation, by who said it', () => {
  store.setState({ open: true })
  addLine(store, { who: 'you', text: 'abre o PR', spoken: true })
  addLine(store, { who: 'james', text: 'Mandei para o tasklist.' })
  addLine(store, { who: 'parent', project: 'tasklist', sessionId: 'a', text: 'Abri o PR #12.' })
  addLine(store, { who: 'note', text: 'Não deu: offline', error: true })
  draw()
  const rows = [...host.querySelectorAll('.jv-line')].map((l) => [l.getAttribute('data-who'), l.textContent])
  expect(rows).toEqual([
    ['you', 'you (spoken)abre o PR'],
    ['james', 'JamesMandei para o tasklist.'],
    ['parent', 'tasklistAbri o PR #12.'],
    ['note', 'Não deu: offline'],
  ])
  expect($('.jv-line[data-error]')).not.toBeNull()
})

describe("the model's setup", () => {
  test('before the first request, it can be prepared now', () => {
    store.setState({ open: true })
    draw()
    expect($('.jv-setup')!.textContent).toContain('about 7 GB')
    click(button('Prepare now'))
    expect(jarvis.ensure).toHaveBeenCalledTimes(1)
  })

  test('a download shows its progress', () => {
    store.setState({ open: true, setup: { kind: 'download', file: '/Users/you/.mnemo-desktop/models/jarvis/model.gguf', done: 1.5 * 1024 ** 3, total: 6 * 1024 ** 3 } })
    draw()
    expect($('.jv-setup')!.textContent).toBe('Downloading model.gguf: 1.5 GB of 6.0 GB')
    expect($<HTMLElement>('.jv-bar > div')!.style.width).toBe('25%')
    expect($('[data-testid="jv-setup-word"]')!.textContent).toBe('downloading 25%')
  })

  test('a failure says why and tries again', () => {
    store.setState({ open: true, setup: { kind: 'error', message: 'sha256 mismatch' } })
    draw()
    expect($('[role="alert"]')!.textContent).toContain('sha256 mismatch')
    click(button('Try again'))
    expect(jarvis.ensure).toHaveBeenCalledTimes(1)
  })

  test('ready, the card is gone', () => {
    store.setState({ open: true, setup: { kind: 'ready', vision: true } })
    draw()
    expect($('.jv-setup')).toBeNull()
    expect($('[data-testid="jv-setup-word"]')!.textContent).toBe('ready · sees the screen')
  })
})

describe('the brain', () => {
  const word = () => $('[data-testid="jv-setup-word"]')!

  test('with Claude, the bar names it and its model, and no setup card shows', () => {
    store.setState({ open: true, brain: { kind: 'claude', model: 'sonnet', effort: 'low' }, voice: 'speaking' })
    draw()
    expect(word().textContent).toBe('claude · sonnet · speaking')
    expect(word().getAttribute('data-brain')).toBe('claude')
    expect($('.jv-setup')).toBeNull()
  })

  test('with Claude, the local model\'s card shows once the screen starts it', () => {
    store.setState({ open: true, brain: { kind: 'claude', model: 'haiku', effort: 'low' }, setup: { kind: 'starting' } })
    draw()
    expect(word().textContent).toBe('claude · haiku')
    expect($('.jv-setup')!.textContent).toBe('Starting the model')
  })

  test('local, the bar is the local model\'s state, as before it is known', () => {
    store.setState({ open: true, brain: { kind: 'local' }, setup: { kind: 'ready', vision: false } })
    draw()
    expect(word().textContent).toBe('ready')
    expect(word().getAttribute('data-brain')).toBe('local')
  })
})

test("the parents, and a parent's approval answered from the panel", () => {
  let parents = foldParent([], { kind: 'opened', parent: ref('a', 'mnemo-desktop') })
  parents = foldParent(parents, { kind: 'approval', parent: ref('b', 'tasklist'), question: 'Rodar git push origin fix?' })
  store.setState({ open: true, parents })
  draw()
  expect([...host.querySelectorAll('.jv-parent')].map((p) => [p.getAttribute('data-state'), p.querySelector('b')!.textContent])).toEqual([
    ['approval', 'tasklist'],
    ['starting', 'mnemo-desktop'],
  ])
  expect($('.jv-approval')!.textContent).toContain('Rodar git push origin fix?')
  click(button('Allow'))
  expect(jarvis.answer).toHaveBeenCalledWith('b', true)
  click(button('Deny'))
  expect(jarvis.answer).toHaveBeenCalledWith('b', false)
})

describe('research', () => {
  const run = (id: number, state: ResearchRun['state'], more: Partial<ResearchRun> = {}): ResearchRun => ({ id, question: `pergunta ${id}`, spoken: true, at: 0, state, ...more })
  const found = { summary: 'O Piper é o mais leve.', details: 'Piper roda em CPU.\nO XTTS pede GPU.', sources: [{ title: 'Piper', url: 'https://github.com/rhasspy/piper' }, { title: 'XTTS', url: 'https://example.com/xtts' }] }
  const cards = () => [...host.querySelectorAll('.jv-research')]

  test('none asked, no section', () => {
    store.setState({ open: true })
    draw()
    expect($('.jv-researches')).toBeNull()
  })

  test('each research shows its state, a running one its bar', () => {
    let rs = foldResearch([], run(1, 'running'))
    rs = foldResearch(rs, run(2, 'queued'))
    store.setState({ open: true, researches: rs })
    draw()
    expect(cards().map((c) => [c.getAttribute('data-state'), c.querySelector('.jv-research-state')!.textContent, c.querySelector('.jv-research-q')!.textContent])).toEqual([
      ['queued', 'queued', 'pergunta 2'],
      ['running', 'researching', 'pergunta 1'],
    ])
    expect(cards()[1].querySelector('.jv-bar[data-indeterminate]')).not.toBeNull()
    expect(cards()[0].querySelector('.jv-bar')).toBeNull()
  })

  test('the newest one ended shows its whole answer and its sources, which open in the browser', () => {
    let rs = foldResearch([], run(1, 'done', { result: { ...found, summary: 'Antiga.' } }))
    rs = foldResearch(rs, run(2, 'done', { result: found }))
    store.setState({ open: true, researches: rs })
    draw()
    const [newest, older] = cards()
    expect(newest.querySelector('.jv-research-summary')!.textContent).toBe('O Piper é o mais leve.')
    expect(newest.querySelector('details')!.open).toBe(true)
    expect(newest.querySelector('summary')!.textContent).toBe('Answer and 2 sources')
    expect(newest.querySelector('.jv-research-details')!.textContent).toBe('Piper roda em CPU.\nO XTTS pede GPU.')
    expect([...newest.querySelectorAll('.jv-sources li')].map((l) => l.textContent)).toEqual(['Pipergithub.com', 'XTTSexample.com'])
    expect(older.querySelector('details')!.open).toBe(false)
    click(newest.querySelector('.jv-source'))
    expect(jarvis.openUrl).toHaveBeenCalledWith('https://github.com/rhasspy/piper')
  })

  test('a failure says why', () => {
    store.setState({ open: true, researches: foldResearch([], run(1, 'failed', { error: 'the web search gave no answer within 600 s, so it was stopped' })) })
    draw()
    expect(cards()[0].querySelector('[role="alert"]')!.textContent).toBe('the web search gave no answer within 600 s, so it was stopped')
  })
})

test("a quick search's sources are under its line", () => {
  store.setState({ open: true })
  addLine(store, { who: 'web', text: 'versão do Tauri', sources: [{ title: 'Releases', url: 'https://github.com/tauri-apps/tauri/releases' }] })
  draw()
  const line = $('.jv-line[data-who="web"]')!
  expect(line.querySelector('.jv-who')!.textContent).toBe('sources · versão do Tauri')
  click(line.querySelector('.jv-source'))
  expect(jarvis.openUrl).toHaveBeenCalledWith('https://github.com/tauri-apps/tauri/releases')
})

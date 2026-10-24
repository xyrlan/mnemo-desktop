import type { AppEntry, JarvisClient, JarvisProject, LlmSetup } from './client'
import { CANCEL_MS, createJarvis, isFollowUp, MAX_STEPS } from './loop'
import type { OpenParent, ParentEvent, ParentRef, ParentsApi, ParentStatus } from './parent'
import type { Message } from './routing'
import { createJarvisStore, type JarvisStore } from './store'

const projects: JarvisProject[] = [
  { name: 'mnemo-desktop', aliases: ['desktop'], root: '/Users/you/code/mnemo-desktop' },
  { name: 'tasklist', aliases: ['tarefas'], root: '/Users/you/code/tasklist' },
]
const apps: AppEntry[] = [{ name: 'VS Code', project: true }, { name: 'Spotify', project: false }]

type Chunk = unknown
const said = (text: string): Chunk[] => [{ choices: [{ delta: { content: text } }] }]
const calls = (name: string, args: Record<string, unknown>): Chunk[] => [
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { name, arguments: '' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] } }] },
]

const SHOT = 'data:image/png;base64,c2NyZWVu'

function fakeClient(replies: Chunk[][], over: Partial<JarvisClient> = {}) {
  const bodies: { messages: Message[]; tools?: unknown }[] = []
  const tools: [string, Record<string, unknown>][] = []
  const spoken: string[] = []
  const logged: Record<string, unknown>[] = []
  const opened: unknown[][] = []
  const client: JarvisClient = {
    projects: async () => projects,
    log: async (row) => void logged.push(row),
    ensureModel: async (cb) => cb({ kind: 'ready', vision: true }),
    chat: async (body, cb) => {
      bodies.push(body as never)
      const next = replies.shift()
      if (!next) throw new Error('the model was not expected to be asked again')
      next.forEach(cb)
    },
    stopModel: async () => {},
    brain: async () => ({ kind: 'local' }),
    brainAsk: async () => Promise.reject(new Error('Claude was not expected to be asked')),
    brainReset: async () => {},
    tool: async (name, args) => {
      tools.push([name, args])
      return `${name} output`
    },
    focusedWindow: async () => null,
    say: async (t) => void spoken.push(t),
    hush: async () => {},
    onVoice: async () => () => {},
    onHeard: async () => () => {},
    onVoiceError: async () => () => {},
    onLevel: async () => () => {},
    listen: async () => false,
    screenshot: async () => SHOT,
    apps: async () => apps,
    openApp: async (app, project) => (opened.push(['app', app, project]), project ? `${app} no ${project}` : app),
    openInBrowser: async (project, page, num) => (opened.push(['browser', project, page, num]), `https://github.com/you/${project}/${page}/${num ?? ''}`),
    openUrl: async (url) => void opened.push(['url', url]),
    ...over,
  }
  return { client, bodies, tools, spoken, logged, opened }
}

function fakeParents(live: ParentRef[] = []) {
  const opened: OpenParent[] = []
  const sent: [string, string][] = []
  const cancelled: string[] = []
  const answered: [string, boolean][] = []
  let listener: (e: ParentEvent) => void = () => {}
  let n = 0
  const api: ParentsApi = {
    open: async (o) => {
      opened.push(o)
      const ref: ParentRef = { sessionId: `s${++n}`, project: o.project, root: o.root, request: o.request, host: o.host ?? 'claude', startedAt: 0 }
      live.unshift(ref)
      return ref
    },
    send: async (id, text) => void sent.push([id, text]),
    status: async (): Promise<ParentStatus> => ({ state: 'idle', summary: 'Corrigi o teste e abri o PR.', question: null }),
    answer: async (id, allow) => void answered.push([id, allow]),
    cancel: async (id) => void cancelled.push(id),
    running: () => [...live],
    subscribe: (cb) => ((listener = cb), () => {}),
  }
  return { api, opened, sent, cancelled, answered, emit: (e: ParentEvent) => listener(e) }
}

const ref = (sessionId: string, project: string, request = 'corrige o login'): ParentRef => ({
  sessionId,
  project,
  root: `/Users/you/code/${project}`,
  request,
  host: 'claude',
  startedAt: 0,
})

let t = 1_000_000
function setup(replies: Chunk[][], { live = [] as ParentRef[], client: over = {} as Partial<JarvisClient>, focused = true } = {}) {
  const c = fakeClient(replies, over)
  const p = fakeParents(live)
  const store: JarvisStore = createJarvisStore()
  const notes: [string, string][] = []
  const jarvis = createJarvis({
    client: c.client,
    parents: p.api,
    store,
    now: () => t,
    focused: () => focused,
    notify: async (title, body) => void notes.push([title, body]),
  })
  const lines = () => store.getState().lines.map((l) => `${l.who}: ${l.text}`)
  const last = () => store.getState().lines.at(-1)?.text
  return { ...c, parents: p, store, jarvis, lines, last, notes }
}

describe('reading', () => {
  test("a read tool's output goes back to the model, which answers", async () => {
    const s = setup([calls('git_status', { project: 'mnemo-desktop' }), said('Está limpo.')])
    await s.jarvis.ask('como está o git do desktop?')
    expect(s.tools).toEqual([['git_status', { project: 'mnemo-desktop' }]])
    const second = s.bodies[1].messages
    expect(second.at(-2)).toMatchObject({ role: 'assistant', tool_calls: [{ function: { name: 'git_status' } }] })
    expect(second.at(-1)).toMatchObject({ role: 'tool', content: 'git_status output' })
    expect(s.last()).toBe('Está limpo.')
    // Typed: nothing is spoken.
    expect(s.spoken).toEqual([])
    expect(s.logged).toEqual([expect.objectContaining({ request: 'como está o git do desktop?', tool: 'git_status', project: 'mnemo-desktop', reply: 'Está limpo.' })])
  })

  test('the project is the one named, whatever the model wrote', async () => {
    const s = setup([calls('git_log', { project: 'mnemo-desktop' }), said('ok')])
    await s.jarvis.ask('o que mudou no tasklist?')
    expect(s.tools).toEqual([['git_log', { project: 'tasklist' }]])
  })

  test('the window in front names the project when the request does not', async () => {
    const s = setup([calls('git_diff', {}), said('ok')], { client: { focusedWindow: async () => 'loop.ts - tasklist - Visual Studio Code' } })
    await s.jarvis.ask('o que eu mudei?')
    expect(s.tools).toEqual([['git_diff', { project: 'tasklist' }]])
    expect(s.store.getState().recent).toEqual({ project: 'tasklist', at: t })
  })

  test('a tool that takes an optional project runs on every project when none is told', async () => {
    const s = setup([calls('gh_pr_list', {}), said('Dois PRs abertos.')])
    await s.jarvis.ask('quais PRs estão abertos?')
    expect(s.tools).toEqual([['gh_pr_list', {}]])
  })

  test('with no project to be told, Jarvis asks, and the answer runs the request', async () => {
    const s = setup([calls('git_status', { project: 'nope' }), calls('git_status', { project: 'tasklist' }), said('Limpo.')])
    await s.jarvis.ask('como está o git?')
    expect(s.tools).toEqual([])
    expect(s.last()).toBe('Em qual projeto? Conheço mnemo-desktop, tasklist.')
    expect(s.store.getState().pending).toMatchObject({ kind: 'ask', request: 'como está o git?' })
    await s.jarvis.ask('tarefas')
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
    // The model sees the question it answers.
    expect(s.bodies[1].messages.slice(1)).toEqual([
      { role: 'user', content: 'como está o git?' },
      { role: 'assistant', content: 'Em qual projeto? Conheço mnemo-desktop, tasklist.' },
      { role: 'user', content: 'tarefas' },
    ])
    expect(s.store.getState().pending).toBeNull()
  })

  test('two projects named ask between those two', async () => {
    const s = setup([calls('git_log', { project: 'tasklist' })])
    await s.jarvis.ask('compara o tasklist com o desktop')
    expect(s.last()).toBe('Em qual projeto: tasklist ou mnemo-desktop?')
  })

  test(`reads stop after ${MAX_STEPS} steps`, async () => {
    const s = setup(Array.from({ length: MAX_STEPS }, () => calls('git_log', { project: 'tasklist' })))
    await s.jarvis.ask('lê tudo do tasklist')
    expect(s.tools).toHaveLength(MAX_STEPS)
    expect(s.last()).toMatch(/Não cheguei/)
  })

  test("a refused read is said to the model, which answers", async () => {
    const s = setup([calls('read_file', { project: 'tasklist', path: '.env' }), said('Esse arquivo é segredo.')], {
      client: { tool: async () => Promise.reject(new Error('refused: a secret file')) },
    })
    await s.jarvis.ask('lê o .env do tasklist')
    expect(s.bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', content: 'Erro: refused: a secret file' })
    expect(s.last()).toBe('Esse arquivo é segredo.')
  })

  test("Gemma's bare call is read back as a tool call", async () => {
    const s = setup([said('git_status{project:<|"|>tasklist<|"|>}'), said('ok')])
    await s.jarvis.ask('git do tasklist')
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
  })

  test('a reply with no tool is said as it is', async () => {
    const s = setup([said('Bom dia!')])
    await s.jarvis.ask('bom dia, James')
    expect(s.lines()).toEqual(['you: bom dia, James', 'james: Bom dia!'])
  })
})

describe('delegating', () => {
  test('a write opens a parent with the words verbatim and what was read', async () => {
    const s = setup([calls('git_status', { project: 'tasklist' }), calls('delegate_to_parent', { project: 'tasklist', request: 'fix it' })])
    await s.jarvis.ask('corrige o teste quebrado do tasklist')
    expect(s.parents.opened).toEqual([
      {
        project: 'tasklist',
        root: '/Users/you/code/tasklist',
        request: 'corrige o teste quebrado do tasklist',
        gathered: 'git_status (tasklist):\ngit_status output',
        host: undefined,
      },
    ])
    expect(s.last()).toBe('Mandei para o tasklist.')
    expect(s.store.getState().parents.map((p) => p.ref.sessionId)).toEqual(['s1'])
    expect(s.store.getState().delegated).toEqual({ sessionId: 's1', project: 'tasklist', at: t })
  })

  test('a request naming Grok opens a Grok parent', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.ask('pede pro grok escrever os testes do tasklist')
    expect(s.parents.opened[0].host).toBe('grok')
  })

  test('a follow-up goes to the running parent of the project named', async () => {
    const live = [ref('a', 'mnemo-desktop'), ref('b', 'tasklist')]
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })], { live })
    await s.jarvis.ask('diz pra ele também corrigir o lint no tasklist')
    expect(s.parents.sent).toEqual([['b', 'diz pra ele também corrigir o lint no tasklist']])
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Mandei para o parent do tasklist.')
  })

  test('a follow-up with one parent running goes to it', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'mnemo-desktop', request: 'x' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.ask('fala pra ele rodar os testes de novo')
    expect(s.parents.sent).toEqual([['a', 'fala pra ele rodar os testes de novo']])
  })

  test('a follow-up with two running and none named asks which', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })], { live: [ref('a', 'mnemo-desktop'), ref('b', 'tasklist', 'abre o PR')] })
    await s.jarvis.ask('manda ele também atualizar o changelog')
    expect(s.parents.sent).toEqual([])
    expect(s.last()).toBe('Qual parent: o do mnemo-desktop («corrige o login») ou o do tasklist («abre o PR»)?')
  })

  test('a new write with a parent running opens its own parent', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.ask('cria uma issue sobre o cache no tasklist')
    expect(s.parents.sent).toEqual([])
    expect(s.parents.opened.map((o) => o.request)).toEqual(['cria uma issue sobre o cache no tasklist'])
  })

  test('"cancela" right after a delegation stops that parent', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.ask('apaga a branch velha do tasklist')
    t += CANCEL_MS - 1
    await s.jarvis.ask('cancela')
    expect(s.parents.cancelled).toEqual(['s1'])
    expect(s.last()).toBe('Cancelei o parent do tasklist.')
    // Once only.
    await s.jarvis.ask('cancela')
    expect(s.parents.cancelled).toEqual(['s1'])
    expect(s.last()).toBe('Nada para cancelar.')
  })

  test('"cancela" long after a delegation stops nothing', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.ask('abre um PR no tasklist')
    t += CANCEL_MS + 1
    await s.jarvis.ask('cancela')
    expect(s.parents.cancelled).toEqual([])
  })

  test("parent_status reads the project's parent", async () => {
    const s = setup([calls('parent_status', { project: 'tasklist' })], { live: [ref('a', 'mnemo-desktop'), ref('b', 'tasklist')] })
    await s.jarvis.ask('como está o tasklist?')
    expect(s.last()).toBe('O parent do tasklist terminou a vez: Corrigi o teste e abri o PR.')
  })

  test('parent_status with nothing running says so', async () => {
    const s = setup([calls('parent_status', { project: 'tasklist' })])
    await s.jarvis.ask('terminou?')
    expect(s.last()).toBe('Nenhum parent rodando no tasklist.')
  })

  test("the model's ask_user is shown, and the next request answers it", async () => {
    const s = setup([calls('ask_user', { question: 'Apagar a branch main mesmo?', reason: 'destructive' }), calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.ask('apaga a main do tasklist')
    expect(s.last()).toBe('Apagar a branch main mesmo?')
    await s.jarvis.ask('sim, pode')
    expect(s.parents.opened[0].request).toBe('apaga a main do tasklist\nsim, pode')
  })
})

describe('the screen', () => {
  test('a screenshot is described, and only the description reaches a handoff', async () => {
    const s = setup([
      calls('look_at_screen', { question: 'que erro é esse?' }),
      said('Um TypeError em loop.ts linha 12.'),
      calls('delegate_to_parent', { project: 'tasklist', request: 'x' }),
    ])
    await s.jarvis.ask('olha esse erro na tela e corrige no tasklist')
    // The image went to the model once, with no tools, and nowhere else.
    const vision = s.bodies[1]
    expect(vision.tools).toBeUndefined()
    expect(JSON.stringify(vision.messages)).toContain(SHOT)
    expect(JSON.stringify(s.bodies[2].messages)).not.toContain(SHOT)
    expect(s.bodies[2].messages.at(-1)).toMatchObject({ role: 'tool', content: 'Um TypeError em loop.ts linha 12.' })
    const handoff = s.parents.opened[0]
    expect(JSON.stringify(handoff)).not.toContain('data:image')
    expect(handoff.gathered).toBe('A tela mostrava (descrito pelo modelo local):\nUm TypeError em loop.ts linha 12.')
    expect(JSON.stringify(s.logged)).not.toContain('data:image')
  })

  test('without the vision projector the screen is not taken', async () => {
    const screenshot = vi.fn(async () => SHOT)
    const s = setup([calls('look_at_screen', { question: 'o que é isso?' }), said('Não consigo ver a tela.')], {
      client: { screenshot, ensureModel: async (cb: (s: LlmSetup) => void) => cb({ kind: 'ready', vision: false }) },
    })
    await s.jarvis.ask('olha a tela')
    expect(screenshot).not.toHaveBeenCalled()
    expect(s.bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', content: expect.stringMatching(/^Erro: /) })
  })
})

describe('apps', () => {
  test('open_app, on the project told', async () => {
    const s = setup([calls('open_app', { app: 'VS Code', project: 'desktop' })])
    await s.jarvis.ask('abre o VS Code no desktop')
    expect(s.opened).toEqual([['app', 'VS Code', 'mnemo-desktop']])
    expect(s.last()).toBe('Abri VS Code no mnemo-desktop.')
  })

  test('open_app with no project', async () => {
    const s = setup([calls('open_app', { app: 'Spotify' })])
    await s.jarvis.ask('abre o Spotify')
    expect(s.opened).toEqual([['app', 'Spotify', undefined]])
  })

  test('open_in_browser and open_url', async () => {
    const s = setup([calls('open_in_browser', { project: 'tasklist', page: 'pr', number: 12 }), calls('open_url', { url: 'https://example.com' })])
    await s.jarvis.ask('abre o PR 12 do tasklist no navegador')
    await s.jarvis.ask('abre example.com')
    expect(s.opened).toEqual([
      ['browser', 'tasklist', 'pr', 12],
      ['url', 'https://example.com'],
    ])
  })

  test("a refusal from Rust is said, and the next request runs", async () => {
    const s = setup([calls('open_url', { url: 'file:///etc/passwd' }), said('ok')], { client: { openUrl: async () => Promise.reject(new Error('only http and https')) } })
    await s.jarvis.ask('abre esse arquivo')
    expect(s.last()).toBe('Não deu: only http and https')
    expect(s.store.getState().busy).toBe(false)
    await s.jarvis.ask('oi')
    expect(s.last()).toBe('ok')
  })
})

describe('voice', () => {
  test('a heard request is answered aloud', async () => {
    const s = setup([said('Está tudo verde.')])
    await s.jarvis.heard({ text: 'como estão os checks?', confidence: 0.9, window: null })
    expect(s.spoken).toEqual(['Está tudo verde.'])
  })

  test('low confidence is repeated as a question before anything acts', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.heard({ text: 'apaga o cache do tasklist', confidence: 0.3, window: null })
    expect(s.bodies).toEqual([])
    expect(s.last()).toBe('Ouvi «apaga o cache do tasklist». É isso?')
    expect(s.spoken).toEqual(['Ouvi «apaga o cache do tasklist». É isso?'])
    await s.jarvis.heard({ text: 'sim', confidence: 0.95, window: null })
    expect(s.parents.opened.map((o) => o.request)).toEqual(['apaga o cache do tasklist'])
  })

  test('a low-confidence take answered no does nothing', async () => {
    const s = setup([])
    await s.jarvis.heard({ text: 'apaga tudo', confidence: 0.2, window: null })
    await s.jarvis.ask('não')
    expect(s.bodies).toEqual([])
    expect(s.last()).toBe('Tudo bem, não fiz nada.')
  })

  test('a new request stops what James was saying, before he answers it', async () => {
    const order: string[] = []
    const hush = async () => void order.push('(hush)')
    const say = async (t: string) => void order.push(t)
    const s = setup([said('Está verde.'), said('Nada mudou.')], { client: { hush, say } })
    await s.jarvis.heard({ text: 'e o CI?', confidence: 0.9, window: null })
    expect(order).toEqual(['(hush)', 'Está verde.'])
    // Typed too: the old answer is not read over the new one.
    await s.jarvis.ask('e o git?')
    expect(order).toEqual(['(hush)', 'Está verde.', '(hush)'])
    // A take with nothing said in it is not a request, and leaves James talking.
    await s.jarvis.heard({ text: '  ', confidence: 0, window: null })
    expect(order).toHaveLength(3)
  })

  test("the take's window names the project, not the window in front now", async () => {
    const focusedWindow = vi.fn(async () => 'mnemo-desktop')
    const s = setup([calls('git_status', {}), said('ok')], { client: { focusedWindow } })
    await s.jarvis.heard({ text: 'como está o git?', confidence: 0.9, window: 'tasklist - Explorer' })
    expect(focusedWindow).not.toHaveBeenCalled()
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
  })
})

describe('parents speak up', () => {
  test('an event is a line, and a notification with the app in the back', async () => {
    const s = setup([], { focused: false })
    const p = ref('a', 'tasklist')
    s.parents.emit({ kind: 'opened', parent: p })
    s.parents.emit({ kind: 'approval', parent: p, question: 'Rodar git push?' })
    expect(s.store.getState().parents).toEqual([{ ref: p, state: 'approval', summary: null, question: 'Rodar git push?' }])
    expect(s.lines()).toEqual(['parent: Espera aprovação: Rodar git push?'])
    expect(s.notes).toEqual([['James · tasklist', 'Espera aprovação: Rodar git push?']])
    await s.jarvis.answer('a', true)
    expect(s.parents.answered).toEqual([['a', true]])
    expect(s.store.getState().parents[0].state).toBe('working')
    s.parents.emit({ kind: 'exited', parent: p })
    expect(s.store.getState().parents).toEqual([])
  })

  test('with the app in front there is no notification', () => {
    const s = setup([])
    s.parents.emit({ kind: 'turn-ended', parent: ref('a', 'tasklist'), summary: 'Pronto.' })
    expect(s.notes).toEqual([])
    expect(s.lines()).toEqual(['parent: Pronto.'])
  })
})

describe('the model', () => {
  test('its setup is shown, and a failure is retried on the next request', async () => {
    let fail = true
    const ensureModel = vi.fn(async (cb: (s: LlmSetup) => void) => {
      cb({ kind: 'download', file: 'model.gguf', done: 1, total: 2 })
      if (fail) throw new Error('disk full')
      cb({ kind: 'ready', vision: true })
    })
    const s = setup([said('oi')], { client: { ensureModel } })
    await s.jarvis.ask('oi')
    expect(s.store.getState().setup).toEqual({ kind: 'error', message: 'disk full' })
    expect(s.bodies).toEqual([])
    fail = false
    await s.jarvis.ask('oi')
    expect(s.store.getState().setup).toEqual({ kind: 'ready', vision: true })
    expect(s.last()).toBe('oi')
    expect(ensureModel).toHaveBeenCalledTimes(2)
  })

  test('requests run one at a time, in order', async () => {
    const s = setup([said('um'), said('dois')])
    await Promise.all([s.jarvis.ask('primeiro'), s.jarvis.ask('segundo')])
    expect(s.lines()).toEqual(['you: primeiro', 'james: um', 'you: segundo', 'james: dois'])
  })
})

test('what reads as a follow-up', () => {
  for (const t of ['diz pra ele também corrigir o lint', 'fala pra ele parar', 'manda pro parent rodar os testes', 'Além disso, atualiza o README', 'pede a ela o link do PR'])
    expect([t, isFollowUp(t)]).toEqual([t, true])
  for (const t of ['corrige o teste do tasklist', 'cria uma issue sobre isso', 'abre um PR', 'elemento quebrado no header'])
    expect([t, isFollowUp(t)]).toEqual([t, false])
})

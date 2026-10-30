import { PAUSE_MS } from './brain'
import type { AppEntry, BrainConfig, JarvisClient, JarvisProject, LlmSetup, Research } from './client'
import { CANCEL_MS, CONTINUES, createJarvis, FROM_WEB, isBareOpen, isFollowUp, isNo, isResearchStatus, isStopParent, isYes, LOOKING, MAX_STEPS, type LoopDeps } from './loop'
import { followUp, type OpenParent, type ParentEvent, type ParentRef, type ParentsApi, type ParentStatus } from './parent'
import type { Message } from './routing'
import type { Situation } from './situation'
import type { Speaker } from './speaker'
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
    // Claude's reply in one piece, as the seam's Rust side sends it.
    brainStream: async (system, text, on) => {
      const reply = await client.brainAsk(system, text)
      on(reply)
      return reply
    },
    brainReset: async () => {},
    tool: async (name, args) => {
      tools.push([name, args])
      return `${name} output`
    },
    focusedWindow: async () => null,
    research: async () => Promise.reject(new Error('the web was not expected to be searched')),
    say: async (t) => void spoken.push(t),
    hush: async () => {},
    onVoice: async () => () => {},
    onHeard: async () => () => {},
    onVoiceError: async () => () => {},
    onVoiceNote: async () => () => {},
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
/** A situation that knows nothing, as the seam's. */
const QUIET: Situation = { text: () => '', changedAt: () => null, refresh: async () => {}, start: () => () => {} }
/** A speaker that says nothing early, as the seam's: these tests pin what the loop says. */
const WHOLE = (): Speaker => ({ push: () => {}, rest: (words) => words })

type Extras = Pick<LoopDeps, 'situation' | 'speaker' | 'report'>

function setup(
  replies: Chunk[][],
  { live = [] as ParentRef[], client: over = {} as Partial<JarvisClient>, focused = true, wait = async (_ms: number) => {}, situation = QUIET, speaker = WHOLE, report }: { live?: ParentRef[]; client?: Partial<JarvisClient>; focused?: boolean; wait?: (ms: number) => Promise<void> } & Extras = {},
) {
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
    wait,
    situation,
    speaker,
    ...(report && { report }),
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

  test('two projects named ask between those two, unless the model picked one of them', async () => {
    const s = setup([calls('git_log', {}), calls('git_log', { project: 'desktop' }), said('ok')])
    await s.jarvis.ask('compara o tasklist com o desktop')
    expect(s.last()).toBe('Em qual projeto: tasklist ou mnemo-desktop?')
    await s.jarvis.ask('cancela')
    await s.jarvis.ask('o que mudou no tasklist e no desktop?')
    expect(s.tools).toEqual([['git_log', { project: 'mnemo-desktop' }]])
  })

  test("the model's project beats the window in front", async () => {
    const s = setup([calls('gh_pr_list', { project: 'mnemo-desktop' }), said('Um PR.'), calls('git_status', { project: 'nope' }), said('ok')], {
      client: { focusedWindow: async () => 'loop.ts - tasklist - Visual Studio Code' },
    })
    await s.jarvis.ask('quais PRs do meu app estão abertos?')
    // A pick that is no known project leaves it to the window.
    await s.jarvis.ask('e o git?')
    expect(s.tools).toEqual([
      ['gh_pr_list', { project: 'mnemo-desktop' }],
      ['git_status', { project: 'tasklist' }],
    ])
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
        task: 'fix it',
        conversation: '',
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
    expect(s.parents.sent).toEqual([['b', followUp({ task: 'x', words: 'diz pra ele também corrigir o lint no tasklist', conversation: '' })]])
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Mandei para o parent do tasklist.')
  })

  test('a follow-up with one parent running goes to it', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'mnemo-desktop', request: 'x' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.ask('fala pra ele rodar os testes de novo')
    expect(s.parents.sent).toEqual([['a', followUp({ task: 'x', words: 'fala pra ele rodar os testes de novo', conversation: '' })]])
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

  test('a write that names the parent he opened goes to it, not to a new one', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.ask('Eu preciso que esse parent que você abriu agora veja o Google Ads')
    expect(s.parents.opened).toEqual([])
    expect(s.parents.sent).toEqual([['a', followUp({ task: 'x', words: 'Eu preciso que esse parent que você abriu agora veja o Google Ads', conversation: '' })]])
  })

  test('a task that only says the words again is none: the conversation carries it', async () => {
    const s = setup([said('Falha no Windows. Quer que eu mande corrigir?'), calls('delegate_to_parent', { project: 'tasklist', request: 'Sim, pode mandar pro parent!' })])
    await s.jarvis.ask('o teste de upload do tasklist falha')
    await s.jarvis.ask('sim, pode mandar pro parent')
    expect(s.parents.opened).toHaveLength(1)
    expect(s.parents.opened[0]).toMatchObject({
      request: 'sim, pode mandar pro parent',
      task: '',
      conversation: 'Maintainer: o teste de upload do tasklist falha\nJarvis: Falha no Windows. Quer que eu mande corrigir?',
    })
  })

  test("the conversation a parent is handed is the last eight exchanges", async () => {
    const replies = Array.from({ length: 10 }, (_, i) => said(`a${i + 1}`))
    const s = setup([...replies, calls('delegate_to_parent', { project: 'tasklist', request: 'Corrigir o teste de upload do tasklist.' })])
    for (let i = 1; i <= 10; i++) await s.jarvis.ask(`r${i}`)
    await s.jarvis.ask('manda corrigir isso no tasklist')
    const lines = s.parents.opened[0].conversation.split('\n')
    expect(lines).toHaveLength(16)
    expect(lines[0]).toBe('Maintainer: r3')
    expect(lines.at(-1)).toBe('Jarvis: a10')
  })
})

describe('ending a parent', () => {
  test('stop_parent ends the parent he opened in the project named', async () => {
    const s = setup([calls('stop_parent', { project: 'mnemo-desktop' })], { live: [ref('a', 'mnemo-desktop'), ref('b', 'tasklist')] })
    await s.jarvis.ask('fecha o parent do tasklist')
    expect(s.parents.cancelled).toEqual(['b'])
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Fechei o parent do tasklist.')
    expect(s.store.getState().recent).toEqual({ project: 'tasklist', at: t })
    expect(s.logged).toEqual([expect.objectContaining({ tool: 'stop_parent', project: 'tasklist', reply: 'Fechei o parent do tasklist.' })])
  })

  test("with none named, the brain's project, else the only one running", async () => {
    const s = setup([calls('stop_parent', { project: 'tasklist' })], { live: [ref('a', 'mnemo-desktop'), ref('b', 'tasklist')] })
    await s.jarvis.ask('fecha aquele parent')
    expect(s.parents.cancelled).toEqual(['b'])
    const one = setup([calls('stop_parent', {})], { live: [ref('a', 'mnemo-desktop')] })
    await one.jarvis.ask('encerra a sessão')
    expect(one.parents.cancelled).toEqual(['a'])
    expect(one.last()).toBe('Fechei o parent do mnemo-desktop.')
  })

  test('two running and none told: he asks which, and the answer ends that one', async () => {
    const s = setup([calls('stop_parent', {}), calls('stop_parent', {})], { live: [ref('a', 'mnemo-desktop'), ref('b', 'tasklist', 'abre o PR')] })
    await s.jarvis.ask('fecha o parent')
    expect(s.parents.cancelled).toEqual([])
    expect(s.last()).toBe('Qual parent: o do mnemo-desktop («corrige o login») ou o do tasklist («abre o PR»)?')
    await s.jarvis.ask('o do tasklist')
    expect(s.parents.cancelled).toEqual(['b'])
  })

  test('none of his running in the project, or at all: he says so and ends nothing', async () => {
    const s = setup([calls('stop_parent', { project: 'tasklist' })], { live: [ref('a', 'mnemo-desktop')] })
    await s.jarvis.ask('fecha o parent do tasklist')
    expect(s.parents.cancelled).toEqual([])
    expect(s.last()).toBe('Não abri nenhum parent no tasklist.')
    const none = setup([calls('stop_parent', {})])
    await none.jarvis.ask('fecha o parent')
    expect(none.last()).toBe('Não abri nenhum parent.')
  })

  test('closing a parent handed to delegate_to_parent ends it, and opens nothing', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.ask('Preciso que você feche a sessão do parent do tasklist lá que a gente abriu.')
    expect(s.parents.opened).toEqual([])
    expect(s.parents.sent).toEqual([])
    expect(s.parents.cancelled).toEqual(['a'])
    expect(s.last()).toBe('Fechei o parent do tasklist.')
    // With none of his running, still none is opened to close one.
    const none = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await none.jarvis.ask('pare esse parent do tasklist')
    expect(none.parents.opened).toEqual([])
    expect(none.last()).toBe('Não abri nenhum parent no tasklist.')
  })

  test('ending another parent leaves "cancela" on the one just delegated', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' }), calls('stop_parent', { project: 'mnemo-desktop' })], { live: [ref('a', 'mnemo-desktop')] })
    await s.jarvis.ask('corrige o teste do tasklist')
    await s.jarvis.ask('fecha o parent do desktop')
    expect(s.parents.cancelled).toEqual(['a'])
    await s.jarvis.ask('cancela')
    expect(s.parents.cancelled).toEqual(['a', 's1'])
  })

  test('the parent just delegated, ended, is not cancelled again', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' }), calls('stop_parent', { project: 'tasklist' })])
    await s.jarvis.ask('corrige o teste do tasklist')
    await s.jarvis.ask('fecha o parent do tasklist')
    expect(s.parents.cancelled).toEqual(['s1'])
    expect(s.store.getState().delegated).toBeNull()
    await s.jarvis.ask('cancela')
    expect(s.parents.cancelled).toEqual(['s1'])
  })

  test('heard low, it waits for a yes', async () => {
    const s = setup([calls('stop_parent', { project: 'tasklist' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.heard({ text: 'fecha o parent do tasklist', confidence: 0.3, window: null })
    expect(s.parents.cancelled).toEqual([])
    expect(s.store.getState().pending).toMatchObject({ kind: 'confirm', tool: 'stop_parent' })
    await s.jarvis.ask('sim')
    expect(s.parents.cancelled).toEqual(['a'])
  })
})

describe('a parent asked for with nothing to do', () => {
  test('he asks what for, and the parent opens with the task joined on', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' }), calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.ask('Pode abrir um parent no tasklist.')
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Pra fazer o quê no tasklist?')
    expect(s.store.getState().pending).toMatchObject({ kind: 'ask', request: 'Pode abrir um parent no tasklist.' })
    await s.jarvis.ask('ver como está o Google Ads')
    expect(s.parents.opened.map((o) => o.request)).toEqual(['Pode abrir um parent no tasklist.\nver como está o Google Ads'])
  })

  test('with no project told, which one first, then what for', async () => {
    const s = setup([calls('delegate_to_parent', {}), calls('delegate_to_parent', { project: 'tasklist' }), calls('delegate_to_parent', { project: 'tasklist' })])
    await s.jarvis.ask('abre um parent')
    expect(s.last()).toMatch(/^Em qual projeto\?/)
    await s.jarvis.ask('no tasklist')
    expect(s.last()).toBe('Pra fazer o quê no tasklist?')
    expect(s.parents.opened).toEqual([])
    await s.jarvis.ask('rodar os testes')
    expect(s.parents.opened.map((o) => o.request)).toEqual(['abre um parent\nno tasklist\nrodar os testes'])
  })

  test('a parent asked for with its task opens at once', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.ask('abre um parent no tasklist pra corrigir o teste')
    expect(s.parents.opened.map((o) => o.request)).toEqual(['abre um parent no tasklist pra corrigir o teste'])
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

  test('a low-confidence delegation is repeated as a question, and a yes runs it', async () => {
    const s = setup([calls('git_status', { project: 'tasklist' }), calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.heard({ text: 'apaga o cache do tasklist', confidence: 0.3, window: null })
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Ouvi «apaga o cache do tasklist». É isso?')
    expect(s.spoken).toEqual(['Ouvi «apaga o cache do tasklist». É isso?'])
    expect(s.store.getState().pending).toMatchObject({ kind: 'confirm', tool: 'delegate_to_parent' })
    // Heard low too: a yes is a yes.
    await s.jarvis.heard({ text: 'é esse mesmo', confidence: 0.4, window: null })
    // The model is not asked again: the held call runs, with what was read for it.
    expect(s.bodies).toHaveLength(2)
    expect(s.parents.opened.map((o) => [o.request, o.gathered])).toEqual([['apaga o cache do tasklist', 'git_status (tasklist):\ngit_status output']])
    expect(s.last()).toBe('Mandei para o tasklist.')
  })

  test('a low-confidence read runs at once', async () => {
    const s = setup([calls('git_status', { project: 'tasklist' }), said('Está limpo.')])
    await s.jarvis.heard({ text: 'como está o git do tasklist?', confidence: 0.3, window: null })
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
    expect(s.last()).toBe('Está limpo.')
    expect(s.store.getState().pending).toBeNull()
  })

  test('opening, heard low, waits for a yes too', async () => {
    const s = setup([calls('open_app', { app: 'Spotify' })])
    await s.jarvis.heard({ text: 'abre o Spotify', confidence: 0.5, window: null })
    expect(s.opened).toEqual([])
    await s.jarvis.ask('aham')
    expect(s.opened).toEqual([['app', 'Spotify', undefined]])
  })

  test('every call that opens something waits for a yes when heard low', async () => {
    for (const [tool, args] of [
      ['open_url', { url: 'https://example.com' }],
      ['open_in_browser', { project: 'tasklist', page: 'pr', number: 3 }],
    ] as const) {
      const s = setup([calls(tool, args)])
      await s.jarvis.heard({ text: 'abre aquilo', confidence: 0.5, window: null })
      expect([tool, s.opened]).toEqual([tool, []])
      expect(s.store.getState().pending).toMatchObject({ kind: 'confirm', tool })
    }
  })

  test('a status or a question, heard low, is answered at once', async () => {
    const s = setup([calls('parent_status', { project: 'tasklist' }), calls('ask_user', { question: 'Qual branch?', reason: 'ambiguous' })], { live: [ref('a', 'tasklist')] })
    await s.jarvis.heard({ text: 'como tá o parent do tasklist?', confidence: 0.3, window: null })
    expect(s.last()).toBe('O parent do tasklist terminou a vez: Corrigi o teste e abri o PR.')
    await s.jarvis.heard({ text: 'apaga a branch', confidence: 0.3, window: null })
    expect(s.last()).toBe('Qual branch?')
    expect(s.store.getState().pending).toMatchObject({ kind: 'ask' })
  })

  test('a low-confidence take answered no does nothing', async () => {
    const s = setup([calls('delegate_to_parent', { project: 'tasklist', request: 'x' })])
    await s.jarvis.heard({ text: 'apaga tudo do tasklist', confidence: 0.2, window: null })
    await s.jarvis.ask('não é isso')
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Tudo bem, não fiz nada.')
  })

  test('what is said aloud is the reply for speech; the panel and the log keep it whole', async () => {
    const whole = 'O último commit é `c1969a2 fix: estorno`, veja https://example.com/x.'
    const s = setup([said(whole)])
    await s.jarvis.heard({ text: 'qual o último commit?', confidence: 0.9, window: null })
    expect(s.spoken).toEqual(['O último commit é fix: estorno, veja.'])
    expect(s.last()).toBe(whole)
    expect(s.logged[0].reply).toBe(whole)
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

test("the maintainer's yes and no", () => {
  for (const t of ['sim', 'é esse mesmo', 'isso mesmo', 'É isso', 'aham', 'pode ser', 'claro', 'beleza', 'Isso.'])
    expect([t, isYes(t), isNo(t)]).toEqual([t, true, false])
  for (const t of ['não', 'não é isso', 'nada disso', 'Nada disso.'])
    expect([t, isYes(t), isNo(t)]).toEqual([t, false, true])
  // A bare "e" is "and": a new question, neither.
  for (const t of ['e', 'e o CI?', 'e agora'])
    expect([t, isYes(t), isNo(t)]).toEqual([t, false, false])
})

describe('the conversation', () => {
  test("the second request's body holds the first exchange, and holds nothing after the pause", async () => {
    const s = setup([said('O CI está verde.'), said('Sim, o último também.'), said('Bom dia.')])
    await s.jarvis.ask('como está o CI do tasklist?')
    await s.jarvis.ask('e o último run?')
    expect(s.bodies[1].messages.slice(1)).toEqual([
      { role: 'user', content: 'como está o CI do tasklist?' },
      { role: 'assistant', content: 'O CI está verde.' },
      { role: 'user', content: 'e o último run?' },
    ])
    t += PAUSE_MS
    await s.jarvis.ask('bom dia')
    expect(s.bodies[2].messages.slice(1)).toEqual([{ role: 'user', content: 'bom dia' }])
  })

  test('the local model is shown the last 8 exchanges', async () => {
    const s = setup(Array.from({ length: 10 }, (_, i) => said(`r${i}`)))
    for (let i = 0; i < 10; i++) await s.jarvis.ask(`q${i}`)
    const shown = s.bodies[9].messages.slice(1).map((m) => m.content)
    expect(shown).toEqual(['q1', 'r1', 'q2', 'r2', 'q3', 'r3', 'q4', 'r4', 'q5', 'r5', 'q6', 'r6', 'q7', 'r7', 'q8', 'r8', 'q9'])
  })

  test('every request carries the moment in words', async () => {
    t = new Date(2026, 9, 23, 21, 50).getTime()
    const s = setup([said('ok')])
    await s.jarvis.ask('que dia é hoje?')
    expect(s.bodies[0].messages[0].content).toContain('agora é sexta-feira, 23 de outubro de 2026, 21:50')
  })

  test('a brain that cannot be read is said, and the local model answers', async () => {
    const s = setup([said('Oi.')], { client: { brain: async () => Promise.reject(new Error('jarvis.json: brain.kind must be local or claude')) } })
    await s.jarvis.ask('oi')
    expect(s.lines()).toEqual(['you: oi', 'note: Cérebro: jarvis.json: brain.kind must be local or claude; responde o modelo local.', 'james: Oi.'])
    expect(s.logged[0].brain).toEqual({ kind: 'local' })
  })

  test('the log row says which brain answered', async () => {
    const s = setup([said('ok')])
    await s.jarvis.ask('oi')
    expect(s.logged[0].brain).toEqual({ kind: 'local' })
    expect(s.store.getState().brain).toEqual({ kind: 'local' })
  })
})

const SONNET: BrainConfig = { kind: 'claude', model: 'sonnet', effort: 'low' }

/** A loop whose brain is Claude, answering `replies` in turn; `local` is what the local model
 *  answers, for the screen. */
function withClaude(replies: string[], { local = [] as Chunk[][], client = {} as Partial<JarvisClient>, live = [] as ParentRef[], ...extras }: { local?: Chunk[][]; client?: Partial<JarvisClient>; live?: ParentRef[] } & Extras = {}) {
  const asks: { system: string; text: string }[] = []
  const resets: number[] = []
  const ensureModel = vi.fn(async (cb: (s: LlmSetup) => void) => cb({ kind: 'ready', vision: true }))
  const s = setup(local, {
    ...extras,
    live,
    client: {
      brain: async () => SONNET,
      brainAsk: async (system, text) => {
        asks.push({ system, text })
        const next = replies.shift()
        if (next === undefined) throw new Error('Claude was not expected to be asked again')
        return next
      },
      brainReset: async () => void resets.push(asks.length),
      ensureModel,
      ...client,
    },
  })
  return { ...s, asks, resets, ensureModel }
}

describe('with Claude', () => {
  test('a yes to what was discussed hands the parent the task Claude wrote, the words and the conversation', async () => {
    const task = 'No tasklist, corrigir o teste de upload que falha no Windows: o servidor falso responde depois de 5 s. Aumentar o tempo limite do teste e abrir um PR.'
    const s = withClaude([
      'Falha no Windows: o servidor falso responde depois de 5 s. Quer que eu mande para um parent corrigir?',
      `{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": ${JSON.stringify(task)}}}`,
    ])
    await s.jarvis.heard({ text: 'por que o teste de upload do tasklist falha?', confidence: 0.9, window: null })
    await s.jarvis.heard({ text: 'sim, pode mandar pro parent', confidence: 0.9, window: null })
    expect(s.parents.opened).toHaveLength(1)
    expect(s.parents.opened[0]).toMatchObject({
      project: 'tasklist',
      request: 'sim, pode mandar pro parent',
      task,
      conversation: 'Maintainer: por que o teste de upload do tasklist falha?\nJarvis: Falha no Windows: o servidor falso responde depois de 5 s. Quer que eu mande para um parent corrigir?',
    })
  })

  test('a follow-up hands the running parent the task and the conversation too', async () => {
    const task = 'Corrigir também o erro de lint em upload.ts.'
    const s = withClaude(['Tem um erro de lint no upload.ts.', `{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": ${JSON.stringify(task)}}}`], {
      live: [ref('a', 'tasklist')],
    })
    await s.jarvis.ask('tem algum erro de lint no tasklist?')
    await s.jarvis.ask('manda pra ele também')
    expect(s.parents.sent).toEqual([['a', followUp({ task, words: 'manda pra ele também', conversation: 'Maintainer: tem algum erro de lint no tasklist?\nJarvis: Tem um erro de lint no upload.ts.' })]])
  })

  test('Claude failing a spoken request is said, and the panel opens on the error', async () => {
    const s = withClaude([], { client: { brainAsk: async () => Promise.reject(new Error('claude: not logged in')) } })
    await s.jarvis.heard({ text: 'como está o mnemo?', confidence: 0.9, window: null })
    expect(s.last()).toBe('Não deu: claude: not logged in')
    expect(s.spoken).toEqual(['Não deu certo; o erro está no painel.'])
    expect(s.store.getState().open).toBe(true)
    // Typed, it is already in the panel it was typed in.
    s.store.setState({ open: false })
    await s.jarvis.ask('e agora?')
    expect(s.store.getState().open).toBe(false)
  })

  test('its JSON call is run, and the output is the next message', async () => {
    const s = withClaude(['Vou olhar.\n{"tool": "git_status", "args": {"project": "tasklist"}}', 'Está limpo, nada pendente.'])
    await s.jarvis.heard({ text: 'como está o git do tasklist?', confidence: 0.9, window: null })
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
    expect(s.asks[1].text).toBe('Saída de git_status no tasklist:\ngit_status output')
    // Its words before the call are said at once; then its answer.
    expect(s.spoken).toEqual(['Vou olhar.', 'Está limpo, nada pendente.'])
    expect(s.lines()).toEqual(['you: como está o git do tasklist?', 'james: Vou olhar.', 'note: git_status no tasklist', 'james: Está limpo, nada pendente.'])
    expect(s.logged).toEqual([expect.objectContaining({ tool: 'git_status', brain: SONNET, reply: 'Está limpo, nada pendente.' })])
  })

  test('its system prompt is the rules, the tools and the projects, and holds still', async () => {
    t = new Date(2026, 9, 23, 21, 50).getTime()
    const s = withClaude(['Boa noite.', 'Nada.'])
    await s.jarvis.ask('boa noite')
    t += 60_000
    await s.jarvis.ask('algo novo?')
    const [a, b] = s.asks
    expect(a.system).toBe(b.system)
    expect(a.system).toContain('{"tool": "git_status", "args": {"project": "nome"}}')
    expect(a.system).toContain('- gh_pr_list(project?): ')
    expect(a.system).toContain('- tasklist (também: tarefas)')
    expect(a.system).toContain('- Spotify')
    expect(a.system).not.toContain('2026')
    // The moment goes with the request.
    expect(a.text).toBe('[Estado atual: agora é sexta-feira, 23 de outubro de 2026, 21:50]\nboa noite')
    expect(b.text).toBe('[Estado atual: agora é sexta-feira, 23 de outubro de 2026, 21:51]\nalgo novo?')
  })

  test("what James said that was not Claude's own is told with the next request", async () => {
    const s = withClaude(['{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": "x"}}', 'Acho que vale esperar o parent.'])
    await s.jarvis.ask('corrige o teste do tasklist')
    expect(s.last()).toBe('Mandei para o tasklist.')
    await s.jarvis.ask('cancela')
    await s.jarvis.ask('o que achou?')
    expect(s.asks[1].text.split('\n')).toEqual([
      'O painel mostrou, sem passar por você:',
      'James: Mandei para o tasklist.',
      'Usuário: cancela',
      'James: Cancelei o parent do tasklist.',
      '',
      expect.stringMatching(/^\[Estado atual: agora é .*\]$/),
      'o que achou?',
    ])
  })

  test("a question about the project is told; Claude's own answer is not", async () => {
    const s = withClaude(['{"tool": "git_status", "args": {}}', '{"tool": "git_status", "args": {"project": "tasklist"}}', 'Limpo.', 'De nada.'])
    await s.jarvis.ask('como está o git?')
    expect(s.last()).toBe('Em qual projeto? Conheço mnemo-desktop, tasklist.')
    await s.jarvis.ask('tarefas')
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
    expect(s.asks[1].text).toMatch(/^O painel mostrou, sem passar por você:\nJames: Em qual projeto\? Conheço mnemo-desktop, tasklist\.\n\n\[Estado atual: .*\]\ntarefas$/)
    await s.jarvis.ask('valeu')
    expect(s.asks[3].text).not.toContain('O painel mostrou')
  })

  test("a parent's state goes back to Claude, which goes on from it", async () => {
    const s = withClaude(['Vou ver o parent.\n{"tool": "parent_status", "args": {"project": "tasklist"}}', 'Ele terminou e abriu o PR; quer que eu veja os checks?'], { live: [ref('a', 'tasklist')] })
    await s.jarvis.heard({ text: 'e o parent do tasklist?', confidence: 0.9, window: null })
    expect(s.asks[1].text).toBe('Saída de parent_status:\nO parent do tasklist terminou a vez: Corrigi o teste e abri o PR.')
    expect(s.spoken).toEqual(['Vou ver o parent.', 'Ele terminou e abriu o PR; quer que eu veja os checks?'])
  })

  test('words before a call the request ends on are not said twice', async () => {
    const s = withClaude(['Esse eu não conheço.\n{"tool": "ask_user", "args": {"question": "Qual projeto é esse?", "reason": "project_unknown"}}', 'Vou mandar.\n{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": "x"}}'])
    await s.jarvis.heard({ text: 'fala do projeto novo', confidence: 0.9, window: null })
    await s.jarvis.heard({ text: 'corrige o teste do tasklist', confidence: 0.9, window: null })
    expect(s.spoken).toEqual(['Qual projeto é esse?', 'Mandei para o tasklist.'])
  })

  test("Claude's own question is not told back to it", async () => {
    const s = withClaude(['{"tool": "ask_user", "args": {"question": "Qual dos dois?", "reason": "ambiguous"}}', 'Certo.'])
    await s.jarvis.ask('compara os dois')
    expect(s.last()).toBe('Qual dos dois?')
    await s.jarvis.ask('o tasklist')
    expect(s.asks[1].text).not.toContain('Qual dos dois?')
  })

  test("a project the brain picked outside the ones named asks between those named", async () => {
    const three = [...projects, { name: 'notes', aliases: [], root: '/Users/you/code/notes' }]
    const s = setup([calls('git_log', { project: 'notes' })], { client: { projects: async () => three } })
    await s.jarvis.ask('compara o tasklist com o desktop')
    expect(s.tools).toEqual([])
    expect(s.last()).toBe('Em qual projeto: tasklist ou mnemo-desktop?')
  })

  test('a pause starts a new conversation', async () => {
    const s = withClaude(['Oi.', 'Oi de novo.', 'Bom dia.'])
    await s.jarvis.ask('oi')
    t += PAUSE_MS - 1
    await s.jarvis.ask('oi')
    expect(s.resets).toEqual([])
    t += PAUSE_MS
    await s.jarvis.ask('bom dia')
    // Reset before the third ask.
    expect(s.resets).toEqual([2])
  })

  test('the local model is never started for a request', async () => {
    const chat = vi.fn(async () => {})
    const s = withClaude(['{"tool": "open_app", "args": {"app": "Spotify"}}', 'Bom dia.'], { client: { chat } })
    await s.jarvis.ask('abre o Spotify')
    await s.jarvis.ask('bom dia')
    expect(s.ensureModel).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
    expect(s.store.getState().setup).toEqual({ kind: 'idle' })
  })

  test('only the screen starts it, and the screenshot reaches the local model alone', async () => {
    const s = withClaude(['{"tool": "look_at_screen", "args": {"question": "que erro?"}}', 'É um TypeError na linha 12.'], { local: [said('Um TypeError em loop.ts linha 12.')] })
    await s.jarvis.ask('olha esse erro na tela')
    expect(s.ensureModel).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(s.bodies[0].messages)).toContain(SHOT)
    expect(JSON.stringify(s.asks)).not.toContain('data:image')
    expect(s.asks[1].text).toBe('Saída de look_at_screen:\nUm TypeError em loop.ts linha 12.')
  })

  test('a low-confidence read runs, a low-confidence delegation waits for a yes', async () => {
    const s = withClaude(['{"tool": "list_sessions", "args": {}}', 'Nenhum filho rodando.', '{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": "x"}}'])
    await s.jarvis.heard({ text: 'tem algum filho rodando?', confidence: 0.4, window: null })
    expect(s.tools).toEqual([['list_sessions', {}]])
    expect(s.last()).toBe('Nenhum filho rodando.')
    await s.jarvis.heard({ text: 'corrige o teste do tasklist', confidence: 0.4, window: null })
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Ouvi «corrige o teste do tasklist». É isso?')
    await s.jarvis.ask('isso mesmo')
    expect(s.parents.opened.map((o) => o.request)).toEqual(['corrige o teste do tasklist'])
    expect(s.asks).toHaveLength(3)
  })

  test('Claude ends a parent with stop_parent, and a bare parent is asked what for', async () => {
    const s = withClaude(
      [
        '{"tool": "stop_parent", "args": {"project": "tasklist"}}',
        '{"tool": "delegate_to_parent", "args": {"project": "mnemo-desktop", "request": "abre um parent"}}',
        '{"tool": "delegate_to_parent", "args": {"project": "mnemo-desktop", "request": "x"}}',
      ],
      { live: [ref('a', 'tasklist')] },
    )
    await s.jarvis.heard({ text: 'fecha o parent do tasklist', confidence: 0.9, window: null })
    expect(s.parents.cancelled).toEqual(['a'])
    expect(s.spoken).toEqual(['Fechei o parent do tasklist.'])
    expect(s.asks[0].system).toContain('- stop_parent(project?): ')
    expect(s.asks[0].system).toContain('Nunca abra um parent para fechar ou parar outro')
    expect(s.asks[0].system).toContain('pergunte antes, com ask_user, o que ele deve fazer')
    await s.jarvis.heard({ text: 'abre um parent no desktop', confidence: 0.9, window: null })
    expect(s.parents.opened).toEqual([])
    expect(s.last()).toBe('Pra fazer o quê no mnemo-desktop?')
    await s.jarvis.heard({ text: 'roda os testes', confidence: 0.9, window: null })
    // The question was the loop's, not Claude's: it is told.
    expect(s.asks[2].text).toContain('James: Pra fazer o quê no mnemo-desktop?')
    expect(s.parents.opened.map((o) => o.request)).toEqual(['abre um parent no desktop\nroda os testes'])
  })
})

test('what reads as a follow-up', () => {
  for (const t of [
    'diz pra ele também corrigir o lint',
    'fala pra ele parar',
    'manda pro parent rodar os testes',
    'Além disso, atualiza o README',
    'pede a ela o link do PR',
    'aquele parent precisa rodar o lint',
    'nesse parent, roda o lint de novo',
    'a resposta do parent está errada, corrige',
    'nessa sessão, roda o lint',
    'avisa a sessão do tasklist que o CI quebrou',
    'a issue que a gente abriu precisa de um teste',
    'o que você acabou de despachar tem que esperar o CI',
    'o PR que vc criou tem conflito',
  ])
    expect([t, isFollowUp(t)]).toEqual([t, true])
  for (const t of ['corrige o teste do tasklist', 'cria uma issue sobre isso', 'abre um PR', 'elemento quebrado no header', 'Pode abrir um parent no tasklist.', 'abre uma sessão no tasklist', 'manda pro tasklist corrigir o lint'])
    expect([t, isFollowUp(t)]).toEqual([t, false])
})

test('what asks to end a parent', () => {
  for (const t of [
    'fecha aquele parent',
    'Pare esse parent que você acabou de despachar do tasklist.',
    'Preciso que você feche a sessão do parent do desktop lá que a gente abriu.',
    'encerra a sessão',
    'pode fechar o parent do tasklist',
    'mata o parent',
    'derruba essa sessão',
    'desliga um parent',
    'cancela este parent',
    'parar aquela sessão de vez',
    'fecha esse parent e me diz quando fechou',
  ])
    expect([t, isStopParent(t)]).toEqual([t, true])
  for (const t of ['manda para o parent rodar os testes', 'fecha a issue que o parent abriu', 'pede pro parent fechar o PR', 'diz pro parent parar a sessão de testes', 'avisa ele pra fechar a sessão do banco', 'para tudo', 'fecha o PR do tasklist', 'abre um parent'])
    expect([t, isStopParent(t)]).toEqual([t, false])
})

test('what asks for a parent with nothing to do', () => {
  const known = [...projects, { name: 'notes', aliases: ['bloco de notas'], root: '/Users/you/code/my-notes' }]
  for (const t of [
    'Pode abrir um parent no bloco de notas.',
    'abre um parent no tasklist',
    'James, cria uma sessão nova no desktop pra mim, por favor',
    'abre outro parent',
    'sobe um parent no notes',
    'inicia uma sessão aqui agora',
    'abre um parent no my-notes',
  ])
    expect([t, isBareOpen(t, known)]).toEqual([t, true])
  for (const t of ['abre um parent no tasklist pra corrigir o teste', 'abre um PR no tasklist', 'abre o tasklist', 'fecha o parent', 'e o parent do tasklist?', 'Pode abrir um parent no bloco de notas.\nver o Google Ads'])
    expect([t, isBareOpen(t, known)]).toEqual([t, false])
})

describe('the web', () => {
  const found: Research = { summary: 'É a 2.12.5.', details: 'O crate tauri está na 2.12.5, de 21 de outubro.', sources: [{ title: 'Releases', url: 'https://github.com/tauri-apps/tauri/releases' }] }
  const deferred = <T,>() => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)))
    return { promise, resolve, reject }
  }
  const flush = () => new Promise((r) => setTimeout(r, 0))
  /** A `research` that answers quick searches with `found` at once and holds each deep one until
   *  the test ends it; `asked` lists every call. */
  const web = () => {
    const asked: [string, boolean][] = []
    const deep: ReturnType<typeof deferred<Research>>[] = []
    const research = async (question: string, isDeep: boolean) => {
      asked.push([question, isDeep])
      if (!isDeep) return found
      const d = deferred<Research>()
      deep.push(d)
      return d.promise
    }
    return { asked, deep, research }
  }

  describe('a quick search', () => {
    test('is a read: what it found goes back to the brain as text from the web, and its sources to the panel', async () => {
      const w = web()
      const s = setup([calls('web_search', { query: 'versão estável do Tauri' }), said('É a 2.12.5, de outubro.')], { client: { research: w.research } })
      await s.jarvis.heard({ text: 'qual é a versão mais nova do Tauri?', confidence: 0.9, window: null })
      expect(w.asked).toEqual([['versão estável do Tauri', false]])
      const out = s.bodies[1].messages.at(-1)!
      expect(out).toMatchObject({ role: 'tool' })
      expect(String(out.content).split('\n')).toEqual([FROM_WEB, found.details, 'Fontes:', '- Releases: https://github.com/tauri-apps/tauri/releases'])
      // The brain wrote nothing before it: James says he is looking, then the answer.
      expect(s.spoken).toEqual([LOOKING, 'É a 2.12.5, de outubro.'])
      expect(s.store.getState().lines.find((l) => l.who === 'web')).toMatchObject({ text: 'versão estável do Tauri', sources: found.sources })
    })

    test("with Claude, its words before the search are said at once, and the output is marked as the web's", async () => {
      const w = web()
      const s = withClaude(['Peraí, vou ver.\n{"tool": "web_search", "args": {"query": "dólar hoje"}}', 'Está em cinco e dez.'], { client: { research: w.research } })
      await s.jarvis.heard({ text: 'James, quanto tá o dólar hoje?', confidence: 0.9, window: null })
      expect(s.spoken).toEqual(['Peraí, vou ver.', 'Está em cinco e dez.'])
      expect(s.asks[1].text.split('\n').slice(0, 2)).toEqual(['Saída de web_search:', FROM_WEB])
    })

    test('a failure goes back to the brain as text, which says so', async () => {
      const s = setup([calls('web_search', { query: 'x' }), said('Não consegui olhar agora.')], { client: { research: async () => Promise.reject(new Error('claude could not start')) } })
      await s.jarvis.ask('qual a cotação do dólar?')
      expect(s.bodies[1].messages.at(-1)).toMatchObject({ role: 'tool', content: 'Erro: claude could not start' })
      expect(s.last()).toBe('Não consegui olhar agora.')
    })
  })

  describe('a research', () => {
    test('runs in the background: James says he is on it, the conversation goes on, and he tells what it found', async () => {
      const w = web()
      const s = withClaude(['{"tool": "research", "args": {"question": "modelos de voz em português que rodam local"}}', 'Bom dia!', 'O Piper, então.'], { client: { research: w.research } })
      await s.jarvis.heard({ text: 'pesquisa a fundo quais modelos de voz em português rodam local e me avisa', confidence: 0.9, window: null })
      expect(s.last()).toBe('Vou pesquisar isso com calma; te conto quando terminar.')
      expect(s.spoken).toEqual(['Vou pesquisar isso com calma; te conto quando terminar.'])
      expect(w.asked).toEqual([['modelos de voz em português que rodam local', true]])
      expect(s.store.getState().researches).toMatchObject([{ state: 'running', question: 'modelos de voz em português que rodam local', spoken: true }])

      // Asked something else meanwhile, James answers, and the brain knows a research runs.
      await s.jarvis.heard({ text: 'bom dia', confidence: 0.9, window: null })
      expect(s.last()).toBe('Bom dia!')
      expect(s.asks[1].text).toContain('pesquisa rodando há menos de um minuto sobre «modelos de voz em português que rodam local»')

      w.deep[0].resolve({ summary: 'O Piper é o mais leve.', details: 'Piper roda em CPU.', sources: [] })
      await flush()
      expect(s.store.getState().researches).toMatchObject([{ state: 'done', result: { summary: 'O Piper é o mais leve.' } }])
      expect(s.last()).toBe('Terminei a pesquisa sobre «modelos de voz em português que rodam local»: O Piper é o mais leve.')
      expect(s.spoken.at(-1)).toBe('Terminei a pesquisa. O Piper é o mais leve.')

      // Claude is told what it found, as text from the web.
      await s.jarvis.ask('e qual você usaria?')
      expect(s.asks[2].text).toContain('James, ao terminar a pesquisa sobre «modelos de voz em português que rodam local»: O Piper é o mais leve.')
      expect(s.asks[2].text).toContain(`${FROM_WEB}\nPiper roda em CPU.`)
    })

    test('its outcome waits until James is neither speaking nor listening', async () => {
      const w = web()
      const s = setup([calls('research', { question: 'q' })], { client: { research: w.research } })
      await s.jarvis.heard({ text: 'pesquisa a fundo q', confidence: 0.9, window: null })
      s.store.setState({ voice: 'speaking' })
      w.deep[0].resolve(found)
      await flush()
      expect(s.last()).toBe('Terminei a pesquisa sobre «q»: É a 2.12.5.')
      expect(s.spoken).not.toContain('Terminei a pesquisa. É a 2.12.5.')
      s.store.setState({ voice: 'listening' })
      await flush()
      s.store.setState({ voice: 'idle', busy: true })
      await flush()
      expect(s.spoken).not.toContain('Terminei a pesquisa. É a 2.12.5.')
      s.store.setState({ busy: false })
      await flush()
      expect(s.spoken.at(-1)).toBe('Terminei a pesquisa. É a 2.12.5.')
    })

    test('its outcome waits for 1.5 s of quiet, and waits again when James is spoken to meanwhile', async () => {
      const w = web()
      const waits: ReturnType<typeof deferred<void>>[] = []
      const asked: number[] = []
      const wait = (ms: number) => {
        asked.push(ms)
        const d = deferred<void>()
        waits.push(d)
        return d.promise
      }
      const s = setup([calls('research', { question: 'q' })], { client: { research: w.research }, wait })
      await s.jarvis.heard({ text: 'pesquisa a fundo q', confidence: 0.9, window: null })
      w.deep[0].resolve(found)
      await flush()
      expect(asked).toEqual([1500])
      // The maintainer presses the key before the quiet is out: James does not speak over them.
      s.store.setState({ voice: 'listening' })
      waits[0].resolve()
      await flush()
      expect(s.spoken).not.toContain('Terminei a pesquisa. É a 2.12.5.')
      s.store.setState({ voice: 'idle' })
      await flush()
      expect(asked).toEqual([1500, 1500])
      waits[1].resolve()
      await flush()
      expect(s.spoken.at(-1)).toBe('Terminei a pesquisa. É a 2.12.5.')
    })

    test('typed, its failure is not said aloud either', async () => {
      const w = web()
      const s = setup([calls('research', { question: 'q' })], { client: { research: w.research } })
      await s.jarvis.ask('pesquisa a fundo q')
      w.deep[0].reject(new Error('claude could not start'))
      await flush()
      expect(s.store.getState().researches).toMatchObject([{ state: 'failed' }])
      expect(s.spoken).toEqual([])
    })

    test('typed, its outcome is not said, and with the app in the back it is a notification', async () => {
      const w = web()
      const s = setup([calls('research', { question: 'q' })], { client: { research: w.research }, focused: false })
      await s.jarvis.ask('pesquisa a fundo q')
      w.deep[0].resolve(found)
      await flush()
      expect(s.spoken).toEqual([])
      expect(s.notes).toEqual([['James · pesquisa', 'É a 2.12.5.']])
    })

    test('a second one waits for the first; the same question is not asked twice', async () => {
      const w = web()
      const s = setup([calls('research', { question: 'modelos de voz' }), calls('research', { question: 'Modelos de voz' }), calls('research', { question: 'placas de vídeo' })], {
        client: { research: w.research },
      })
      await s.jarvis.ask('pesquisa a fundo modelos de voz')
      await s.jarvis.ask('pesquisa modelos de voz')
      expect(s.last()).toBe('Já estou pesquisando isso; te conto quando terminar.')
      await s.jarvis.ask('pesquisa também placas de vídeo')
      expect(s.last()).toBe('Vou pesquisar depois da que está rodando, sobre «modelos de voz»; te conto quando terminar.')
      expect(s.store.getState().researches.map((r) => [r.question, r.state])).toEqual([
        ['placas de vídeo', 'queued'],
        ['modelos de voz', 'running'],
      ])
      expect(w.asked).toEqual([['modelos de voz', true]])
      w.deep[0].resolve(found)
      await flush()
      expect(w.asked).toEqual([
        ['modelos de voz', true],
        ['placas de vídeo', true],
      ])
      expect(s.store.getState().researches.map((r) => r.state)).toEqual(['running', 'done'])
    })

    test('a failure is said, and the panel opens on why', async () => {
      const w = web()
      const s = setup([calls('research', { question: 'q' })], { client: { research: w.research } })
      await s.jarvis.heard({ text: 'pesquisa a fundo q', confidence: 0.9, window: null })
      s.store.setState({ open: false })
      expect(w.deep).toHaveLength(1)
      w.deep[0].reject(new Error('the web search gave no answer within 600 s, so it was stopped'))
      await flush()
      expect(s.store.getState().researches).toMatchObject([{ state: 'failed', error: 'the web search gave no answer within 600 s, so it was stopped' }])
      expect(s.store.getState().lines.at(-1)).toMatchObject({ who: 'note', error: true, text: 'A pesquisa sobre «q» não deu: the web search gave no answer within 600 s, so it was stopped' })
      expect(s.store.getState().open).toBe(true)
      expect(s.spoken.at(-1)).toBe('A pesquisa não deu certo; o erro está no painel.')
    })

    test('asked how it is going, James says so without asking the brain', async () => {
      const w = web()
      const s = setup([calls('research', { question: 'modelos de voz' })], { client: { research: w.research } })
      await s.jarvis.ask('como está a pesquisa?')
      expect(s.last()).toBe('Não tenho nenhuma pesquisa rodando.')
      await s.jarvis.ask('pesquisa a fundo modelos de voz')
      t += 3 * 60_000
      await s.jarvis.ask('e a pesquisa?')
      expect(s.last()).toBe('Ainda estou pesquisando «modelos de voz»; começou há 3 min.')
      w.deep[0].resolve(found)
      await flush()
      await s.jarvis.ask('a pesquisa já terminou?')
      expect(s.last()).toBe('A pesquisa sobre «modelos de voz» terminou: É a 2.12.5.')
      // Only the request that started it reached the model.
      expect(s.bodies).toHaveLength(1)
    })
  })

  test('heard low, a research waits for a yes: a take heard wrong does not start minutes of searching', async () => {
    const w = web()
    const s = setup([calls('research', { question: 'modelos de voz' })], { client: { research: w.research } })
    await s.jarvis.heard({ text: 'pesquisa a fundo modelos de voz', confidence: 0.4, window: null })
    expect(s.last()).toBe('Ouvi «pesquisa a fundo modelos de voz». É isso?')
    expect(w.asked).toEqual([])
    await s.jarvis.heard({ text: 'isso', confidence: 0.9, window: null })
    expect(w.asked).toEqual([['modelos de voz', true]])
    expect(s.last()).toBe('Vou pesquisar isso com calma; te conto quando terminar.')
  })

  test('which words ask how a research is going', () => {
    for (const t of ['como está a pesquisa?', 'e a pesquisa?', 'E aí, a pesquisa já terminou?', 'terminou a pesquisa?', 'como anda aquela pesquisa?', 'alguma novidade da pesquisa?'])
      expect([t, isResearchStatus(t)]).toEqual([t, true])
    for (const t of [
      'pesquisa a fundo modelos de voz',
      'faz uma pesquisa sobre placas de vídeo',
      'pesquisa como funciona o whisper',
      'qual o dólar hoje?',
      'me explica como a pesquisa de mercado que o parent do desktop fez ontem chegou naquele número',
    ])
      expect([t, isResearchStatus(t)]).toEqual([t, false])
  })

  test('a source opens in the browser', async () => {
    const s = setup([])
    await s.jarvis.openUrl('https://github.com/tauri-apps/tauri/releases')
    expect(s.opened).toEqual([['url', 'https://github.com/tauri-apps/tauri/releases']])
  })
})

describe('conversing (jarvis-converse)', () => {
  /** A speaker that says each piece at once: what is left once the reply is whole is nothing. */
  const EAGER = (say: (sentence: string) => void): Speaker => ({ push: (piece) => say(piece), rest: () => '' })
  const streaming = (pieces: string[]): Partial<JarvisClient> => ({
    brainStream: async (_system, _text, on) => {
      pieces.forEach(on)
      return pieces.join('')
    },
  })

  test('what a speaker said while Claude wrote is not said again once the reply is whole', async () => {
    const s = withClaude([], { client: streaming(['Tem dois PRs abertos. ', 'O 524 está verde.']), speaker: EAGER })
    await s.jarvis.heard({ text: 'como estão os PRs?', confidence: 0.9, window: null })
    expect(s.spoken).toEqual(['Tem dois PRs abertos.', 'O 524 está verde.'])
    // The panel and the conversation have the reply whole.
    expect(s.last()).toBe('Tem dois PRs abertos. O 524 está verde.')
  })

  test('before a read, only what the speaker left is said while it runs', async () => {
    const replies = [['Vou olhar. ', '{"tool": "git_status", "args": {"project": "tasklist"}}'], ['Está limpo.']]
    const s = withClaude([], {
      speaker: (say) => ({ push: (piece) => !piece.startsWith('{') && say(piece), rest: () => '' }),
      client: {
        brainStream: async (_system, _text, on) => {
          const pieces = replies.shift()!
          pieces.forEach(on)
          return pieces.join('')
        },
      },
    })
    await s.jarvis.heard({ text: 'como está o git do tasklist?', confidence: 0.9, window: null })
    expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
    expect(s.spoken).toEqual(['Vou olhar.', 'Está limpo.'])
  })

  test('a newer request hushes what is left of the one being answered', async () => {
    let finish: (reply: string) => void = () => {}
    let started = false
    const s = withClaude(['São dez da manhã.'], {
      client: {
        brainStream: async (system, text, on) => {
          if (text.endsWith('conta uma história longa')) {
            started = true
            const reply = await new Promise<string>((r) => (finish = r))
            on(reply)
            return reply
          }
          const reply = await s.client.brainAsk(system, text)
          on(reply)
          return reply
        },
      },
    })
    const first = s.jarvis.heard({ text: 'conta uma história longa', confidence: 0.9, window: null })
    await vi.waitFor(() => expect(started).toBe(true))
    const second = s.jarvis.heard({ text: 'na verdade, que horas são?', confidence: 0.9, window: null })
    finish('Era uma vez um parent que nunca terminava.')
    await Promise.all([first, second])
    // The old answer is in the panel, never aloud; the new one is said.
    expect(s.lines()).toContain('james: Era uma vez um parent que nunca terminava.')
    expect(s.spoken).toEqual(['São dez da manhã.'])
  })

  test('the panorama goes with a request when it changed since Claude last saw it', async () => {
    let state = { text: 'tasklist: 2 PRs abertos, CI verde.', at: 100 }
    let started = 0
    let stopped = 0
    const situation: Situation = {
      text: () => state.text,
      changedAt: () => state.at,
      refresh: async () => {},
      start: () => (started++, () => void stopped++),
    }
    const s = withClaude(['Dois PRs no tasklist.', 'Nada mudou.', 'Agora são três.', 'Três.'], { situation })
    await s.jarvis.ask('como tá tudo?')
    // Kept fresh from when Claude is known to be the brain, once.
    expect(started).toBe(1)
    await s.jarvis.ask('e agora?')
    state = { text: 'tasklist: 3 PRs abertos.', at: 200 }
    await s.jarvis.ask('e agora?')
    expect(s.asks.map((a) => a.text.includes('[Panorama dos projetos'))).toEqual([true, false, true])
    expect(s.asks[0].text).toContain('tasklist: 2 PRs abertos, CI verde.')
    expect(s.asks[2].text).toContain('tasklist: 3 PRs abertos.')
    // A new conversation sees it again.
    t += PAUSE_MS
    await s.jarvis.ask('como tá tudo?')
    expect(s.asks[3].text).toContain('tasklist: 3 PRs abertos.')
    s.jarvis.dispose()
    expect(stopped).toBe(1)
  })

  test('with the local model, nothing reads the projects in the background', async () => {
    let started = 0
    const situation: Situation = { ...QUIET, start: () => (started++, () => {}) }
    const s = setup([said('Bom dia!')], { situation })
    await s.jarvis.ask('bom dia')
    expect(started).toBe(0)
  })

  test('what a parent asked for aloud says is told to Claude, and said aloud at a quiet moment', async () => {
    const report = (e: ParentEvent) => (e.kind === 'turn-ended' ? { say: `O parent do ${e.parent.project} terminou: ${e.summary}`, tell: `Parent do ${e.parent.project}: ${e.summary}` } : null)
    const s = withClaude(['{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": "Corrigir o teste de upload no Windows."}}', 'Ele corrigiu o teste.'], { report })
    await s.jarvis.heard({ text: 'manda um parent corrigir o teste de upload do tasklist', confidence: 0.9, window: null })
    const p = s.parents.opened.length && s.parents.api.running()[0]
    expect(p).toBeTruthy()
    s.parents.emit({ kind: 'turn-ended', parent: p as ParentRef, summary: 'Corrigi o teste e abri o PR 12.' })
    await vi.waitFor(() => expect(s.spoken).toContain('O parent do tasklist terminou: Corrigi o teste e abri o PR 12.'))
    await s.jarvis.ask('e aí, como ficou?')
    expect(s.asks[1].text).toContain('Parent do tasklist: Corrigi o teste e abri o PR 12.')
  })

  describe('a request a breath cut in two', () => {
    /** Claude, holding its reply to `held` until `finish`; the rest answered from `replies`. */
    const holding = (held: string, replies: string[], extras: Parameters<typeof withClaude>[1] = {}) => {
      const state = { started: false, finish: (_reply: string) => {} }
      const s = withClaude(replies, {
        ...extras,
        client: {
          ...extras.client,
          brainStream: async (system, text, on) => {
            if (text.endsWith(held) && !state.started) {
              state.started = true
              const reply = await new Promise<string>((r) => (state.finish = r))
              on(reply)
              return reply
            }
            const reply = await s.client.brainAsk(system, text)
            on(reply)
            return reply
          },
        },
      })
      return { s, state }
    }

    test('its rest, heard with no name while the first half is thought over, is asked with it, and the first half runs no call', async () => {
      const { s, state } = holding('vê o git do tasklist.', ['Os dois estão limpos.'])
      const first = s.jarvis.heard({ text: 'vê o git do tasklist.', confidence: 0.9, window: null, via: 'wake' })
      await vi.waitFor(() => expect(state.started).toBe(true))
      const rest = s.jarvis.heard({ text: 'E do mnemo também.', confidence: 0.9, window: null, via: 'follow' })
      state.finish('{"tool": "git_status", "args": {"project": "tasklist"}}')
      await Promise.all([first, rest])
      expect(s.tools).toEqual([])
      expect(s.asks).toHaveLength(1)
      expect(s.asks[0].text).toContain(`${CONTINUES}\nvê o git do tasklist. E do mnemo também.`)
      expect(s.spoken).toEqual(['Os dois estão limpos.'])
      expect(s.lines().filter((l) => l.startsWith('james:'))).toEqual(['james: Os dois estão limpos.'])
    })

    test('a take with the name is a request of its own: the one before it runs its call, silently', async () => {
      const { s, state } = holding('vê o git do tasklist.', ['Está limpo.', 'São dez da manhã.'])
      const first = s.jarvis.heard({ text: 'vê o git do tasklist.', confidence: 0.9, window: null, via: 'wake' })
      await vi.waitFor(() => expect(state.started).toBe(true))
      const second = s.jarvis.heard({ text: 'que horas são?', confidence: 0.9, window: null, via: 'wake' })
      state.finish('{"tool": "git_status", "args": {"project": "tasklist"}}')
      await Promise.all([first, second])
      expect(s.tools).toEqual([['git_status', { project: 'tasklist' }]])
      expect(s.asks.map((a) => a.text.includes(CONTINUES))).toEqual([false, false])
      expect(s.spoken).toEqual(['São dez da manhã.'])
    })

    test('a take with no name once a call of the request before it ran, or once James answered, is a request of its own', async () => {
      let read: () => void = () => {}
      const reads: string[] = []
      const { s, state } = holding('vê o git do tasklist.', ['Está limpo.', 'Também está limpo.', 'De nada.'], {
        client: { tool: async (name) => (reads.push(name), new Promise<string>((r) => (read = () => r(`${name} output`)))) },
      })
      const first = s.jarvis.heard({ text: 'vê o git do tasklist.', confidence: 0.9, window: null, via: 'wake' })
      await vi.waitFor(() => expect(state.started).toBe(true))
      state.finish('{"tool": "git_status", "args": {"project": "tasklist"}}')
      await vi.waitFor(() => expect(reads).toEqual(['git_status']))
      const rest = s.jarvis.heard({ text: 'E do mnemo também.', confidence: 0.9, window: null, via: 'follow' })
      read()
      await Promise.all([first, rest])
      await s.jarvis.heard({ text: 'valeu.', confidence: 0.9, window: null, via: 'follow' })
      expect(s.asks.map((a) => a.text.includes(CONTINUES))).toEqual([false, false, false])
      expect(s.asks[1].text).toMatch(/E do mnemo também\.$/)
      expect(s.asks[2].text).toMatch(/valeu\.$/)
    })
  })

  test('a parent asked for by typing is told to Claude and never said aloud', async () => {
    const report = (e: ParentEvent) => (e.kind === 'turn-ended' ? { say: 'Terminou.', tell: `Parent do ${e.parent.project}: ${e.summary}` } : null)
    const s = withClaude(['{"tool": "delegate_to_parent", "args": {"project": "tasklist", "request": "Corrigir o teste de upload no Windows."}}'], { report })
    await s.jarvis.ask('manda um parent corrigir o teste de upload do tasklist')
    s.parents.emit({ kind: 'turn-ended', parent: s.parents.api.running()[0], summary: 'Pronto.' })
    await new Promise((r) => setTimeout(r, 0))
    expect(s.spoken).toEqual([])
  })
})

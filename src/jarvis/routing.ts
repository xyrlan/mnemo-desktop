/** How a request reaches the local model: James's name, tools and system prompt, the chat request
 *  body, and reading the streamed reply back. The app (#505) and the benchmark
 *  (`scripts/jarvis-bench.mjs`, #504) both build on this module, so what the benchmark measures
 *  is what ships.
 *
 *  Plain, erasable TypeScript with no imports: Node runs the benchmark against this file directly
 *  (type stripping), with no build step and no path aliases. */

/** What the maintainer calls the assistant out loud; "Jarvis" is only the project's name. */
export const NAME = 'James'

/** `expect.tool` for a request that wants a reply in words and no tool call. */
export const NO_TOOL = 'none'

/** A project James knows: its canonical name (the folder under `~/mnemo/bots/`) and what the
 *  maintainer also calls it. */
export type Project = { name: string; aliases?: string[] }

/** An app James may open (#508): its name as listed, and whether it takes a project. */
export type App = { name: string; project?: boolean }

type Schema = Record<string, unknown>
export type Tool = { type: 'function'; function: { name: string; description: string; parameters: Schema } }

const project = (what = 'the project') => ({ type: 'string', description: `${what}: one of the known projects' names, exactly as listed` })
const fn = (name: string, description: string, properties: Record<string, Schema>, required = Object.keys(properties)): Tool => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
})

/** The closed set of tools: reads (#505), following a running parent, handing a write to a
 *  parent, ending one Jarvis opened, asking, the screen on request (#507), and apps and web pages
 *  (#508). Never a shell. */
export const TOOLS: Tool[] = [
  fn('git_status', 'git status of a project.', { project: project() }),
  fn('git_log', 'Recent commits of a project.', { project: project(), limit: { type: 'integer' } }, ['project']),
  fn('git_diff', 'Uncommitted changes in a project, optionally of one path.', { project: project(), path: { type: 'string' } }, ['project']),
  fn('read_file', 'Read a file in a project.', { project: project(), path: { type: 'string' } }),
  fn('list_dir', 'List a folder in a project.', { project: project(), path: { type: 'string' } }, ['project']),
  fn('search', 'Search a project\'s files for text (ripgrep).', { project: project(), query: { type: 'string' } }),
  fn('read_briefings', 'Read the briefings of past work sessions in a project: what was done, decided, left open.', { project: project(), since: { type: 'string', description: 'e.g. "yesterday", "2026-10-01"' } }, ['project']),
  fn('query_rules', 'Look up the rules and conventions mnemo learned for a project.', { project: project(), query: { type: 'string' } }, ['query']),
  fn('list_sessions', 'List agent sessions (running and recent), optionally of one project.', { project: project() }, []),
  fn('gh_pr_list', 'Open pull requests of a project, or of every known project when none is named.', { project: project() }, []),
  fn('gh_pr_view', 'Show a pull request.', { project: project(), number: { type: 'integer' } }, ['project']),
  fn('gh_pr_checks', 'CI checks of a pull request.', { project: project(), number: { type: 'integer' } }, ['project']),
  fn('gh_run_list', 'Recent CI (GitHub Actions) runs of a project.', { project: project() }),
  fn('gh_issue_view', 'Show an issue.', { project: project(), number: { type: 'integer' } }),
  fn('parent_status', 'How a parent session already working on an earlier request is doing.', { project: project('the project the parent runs in') }),
  fn('delegate_to_parent', 'Hand a request that writes anything (code, commits, PRs, issues, messages, a follow-up instruction to a running parent) to a parent session in the project. Jarvis itself only reads.', { project: project(), request: { type: 'string', description: 'the task for the parent, whole: what to do, where, and what the conversation settled (names, numbers, choices). The parent sees nothing of the conversation but this, the user\'s last words and a few lines before them, so a "yes, send it" is never the task.' } }),
  fn('stop_parent', 'End (close, stop) a parent session Jarvis opened. Never a session Jarvis did not open, and never by opening another parent.', { project: project('the project the parent runs in') }, []),
  fn('ask_user', 'Ask the user before acting: when the project cannot be told, or the request is destructive (delete, force-push, reset).', {
    question: { type: 'string' },
    reason: { type: 'string', enum: ['project_unknown', 'destructive', 'ambiguous'] },
    project: project('the project, when it is known'),
  }, ['question', 'reason']),
  fn('look_at_screen', 'Take a screenshot and look at it. Only when the user asks you to look at the screen or at something showing on it.', { question: { type: 'string', description: 'what to look for, in the user\'s words' } }),
  fn('open_app', 'Open an app from the user\'s list of apps, on a project when the app takes one.', { app: { type: 'string', description: 'one of the listed apps\' names, exactly as listed' }, project: project() }, ['app']),
  fn('open_in_browser', 'Open a project\'s page on GitHub in the browser: the repository, a pull request, an issue, or its CI runs.', {
    project: project(),
    page: { type: 'string', enum: ['repo', 'pr', 'issue', 'actions'] },
    number: { type: 'integer', description: 'the pull request or issue number' },
  }, ['project', 'page']),
  fn('open_url', 'Open a web address (http or https) in the browser.', { url: { type: 'string' } }),
]

/** Who James is and how he works, whichever model plays him: the local one (`systemPrompt`) or
 *  Claude (`./brain`). */
export const RULES: string[] = [
  `Você é o ${NAME}, um assistente de voz no desktop do usuário. O usuário fala em português.`,
  'Você só lê: git, arquivos, briefings, regras, sessões e o gh somente-leitura, pelas ferramentas. Quando pedirem, também olha a tela e abre apps da lista e páginas web.',
  'Tudo que escreve (código, commits, PRs, issues, apagar algo, instruções a um parent já rodando) vai para delegate_to_parent. Em request, escreva a tarefa inteira para o parent agir sozinho: o que fazer, onde, e o que se combinou na conversa (nomes, números, escolhas). O parent não vê a conversa, só isso, as últimas palavras do usuário e poucas falas antes; um "sim, pode mandar" nunca é a tarefa.',
  'Pergunte com ask_user, antes de qualquer outra ferramenta, quando o pedido precisar de um projeto e não der para saber qual, ou quando for destrutivo (apagar, force-push, reset).',
  'Pedidos que escrevem e não são destrutivos (corrigir, criar issue, abrir PR, mergear, despachar, subir release, escrever testes) vão direto para delegate_to_parent, sem pedir confirmação: o parent confirma o que precisar.',
  'Quando o Estado atual diz que um parent está rodando e o usuário pergunta como está ou se terminou, use parent_status nesse projeto.',
  'Fechar, parar ou encerrar um parent que você abriu é stop_parent. Nunca abra um parent para fechar ou parar outro, e nunca feche uma sessão que você não abriu.',
  'Pedirem um parent sem dizer o que ele vai fazer ("abre um parent no X"): pergunte antes, com ask_user, o que ele deve fazer; o parent abre já com a tarefa.',
  'Nunca diga como algo está (sessões, filhos, CI, PRs, issues, commits) sem perguntar antes à ferramenta que sabe: responder "não" sem ferramenta é chutar.',
  '"Filho" é uma sessão que o mnemo despachou: quem sabe dos filhos é list_sessions. O andamento de um projeto são os commits recentes (git_log) e as sessões (list_sessions); o que se fez e decidiu está em read_briefings.',
  'A voz chega transcrita, e a transcrição erra nomes: "Games" ou "Jaime" é você, e um projeto pode chegar deformado ou partido em palavras. Fique com o projeto conhecido de som mais parecido.',
  'Você lembra a conversa: "esse", "o mesmo", "aquele PR" falam do que já foi dito.',
  'Converse de verdade. Quando pedirem sua opinião, uma ideia ou o que fazer primeiro, responda com uma posição concreta e o porquê, a partir do que leu e do que sabe; nunca só "tudo bem" ou "entendido".',
  'Suas respostas são faladas: no máximo três frases curtas, sem markdown, listas, hashes de commit, ids de sessão ou endereços. Resuma o que leu; o painel mostra o resto.',
]

/** James's system prompt over the known `projects`, the `apps` he may open, and what he knows
 *  besides the words (`context`: the moment, a running parent, the focused window). */
export function systemPrompt(projects: Project[], context?: string, reasoning = false, apps: App[] = []): string {
  return [
    reasoning ? '' : '/no_think',
    ...RULES,
    'Quando houver o que ler, fazer ou perguntar, chame exatamente uma ferramenta. Quando não houver (um bom-dia, uma conversa, uma opinião sobre o que já foi lido), responda em palavras, sem ferramenta.',
    ...listed(projects, apps),
    '',
    `Estado atual: ${context || 'nenhum parent rodando, nenhuma janela em foco.'}`,
  ].filter((l, i) => i > 0 || l).join('\n')
}

/** The projects and apps James knows, as the prompts list them. */
export function listed(projects: Project[], apps: App[] = []): string[] {
  const list = projects.map((p) => `- ${p.name}${p.aliases?.length ? ` (também: ${p.aliases.join(', ')})` : ''}`).join('\n')
  const appList = apps.map((a) => `- ${a.name}${a.project ? ' (aceita um projeto)' : ''}`).join('\n')
  return ['', 'Projetos conhecidos:', list, ...(apps.length ? ['', 'Apps que você pode abrir:', appList] : [])]
}

export type Message =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
export type ToolCall = { id?: string; type?: 'function'; function: { name: string; arguments: string } }

export type RequestOptions = { reasoning?: boolean; stream?: boolean }

/** The body of a chat request over `messages`, with every tool. Temperature 0: the same words
 *  route the same way. With reasoning on, the server's `--reasoning-budget` bounds it. */
export function requestBody(messages: Message[], { reasoning = false, stream = true }: RequestOptions = {}) {
  return {
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
    temperature: 0,
    max_tokens: reasoning ? 2048 : 384,
    stream,
    chat_template_kwargs: { enable_thinking: reasoning, thinking: reasoning },
  }
}

/** One request with no history: the system prompt, then `row.request`. */
export function chatBody(row: { request: string; context?: string }, projects: Project[], opts: RequestOptions & { apps?: App[] } = {}) {
  return requestBody(
    [
      { role: 'system', content: systemPrompt(projects, row.context, opts.reasoning, opts.apps) },
      { role: 'user', content: row.request },
    ],
    opts,
  )
}

/** Splits an SSE body's text into its `data:` payloads, JSON-parsed, stopping at `[DONE]`. */
export function sseEvents(text: string): unknown[] {
  const events: unknown[] = []
  for (const line of text.split('\n')) {
    const m = /^data:\s?(.*)$/.exec(line.trimEnd())
    if (!m) continue
    if (m[1] === '[DONE]') break
    try {
      events.push(JSON.parse(m[1]))
    } catch {
      // A keep-alive or a torn line.
    }
  }
  return events
}

export type Reply = { content: string; reasoning_content: string; tool_calls: ToolCall[] }

type Delta = { content?: string; reasoning_content?: string; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] }
const delta = (c: unknown): Delta | undefined => (c as { choices?: { delta?: Delta }[] } | null)?.choices?.[0]?.delta

/** Folds an OpenAI-style stream of chat chunks (already JSON-parsed) into one reply message.
 *  Tool calls arrive in pieces keyed by `index`. */
export function foldChunks(chunks: unknown[]): Reply {
  const msg: Reply = { content: '', reasoning_content: '', tool_calls: [] }
  for (const c of chunks) {
    const d = delta(c)
    if (!d) continue
    if (d.content) msg.content += d.content
    if (d.reasoning_content) msg.reasoning_content += d.reasoning_content
    for (const t of d.tool_calls ?? []) {
      const i = t.index ?? msg.tool_calls.length
      const slot = (msg.tool_calls[i] ??= { function: { name: '', arguments: '' } })
      if (t.function?.name) slot.function.name += t.function.name
      if (t.function?.arguments) slot.function.arguments += t.function.arguments
    }
  }
  msg.tool_calls = msg.tool_calls.filter(Boolean)
  return msg
}

/** Whether a chunk is the model's first output: text, reasoning or a tool call. */
export const isOutput = (c: unknown): boolean => {
  const d = delta(c)
  return !!(d && (d.content || d.reasoning_content || d.tool_calls?.length))
}

/** The first tool call of a reply `message`: `{tool, args}`, `tool` null when the model only wrote
 *  text, `args` null when they are not JSON. */
export function firstCall(message: { tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } | null | undefined): { tool: string | null; args: Record<string, unknown> | null } {
  const call = message?.tool_calls?.[0]
  if (!call) return { tool: null, args: null }
  const raw = call.function?.arguments
  let args: Record<string, unknown> | null = null
  if (raw && typeof raw === 'object') args = raw as Record<string, unknown>
  else
    try {
      args = JSON.parse((raw as string) || '{}')
    } catch {
      args = null
    }
  return { tool: call.function?.name ?? null, args }
}

/** A reply whose only text is a tool call in Gemma 4's own syntax, written bare: Bolt E4B does
 *  this with reasoning off (`delegate_to_parent{project:<|"|>x<|"|>}`, no `<|tool_call>call:`
 *  wrapper), so llama-server hands it back as text (#511). When the text is exactly one call to
 *  one of `TOOLS`, this returns the reply with that call in `tool_calls`; any other reply comes
 *  back unchanged. */
export function recoverBareCall(message: Reply): Reply {
  if (message.tool_calls.length) return message
  const m = /^\s*(?:call:)?([a-z_]+)(\{[\s\S]*\})\s*$/.exec(message.content)
  if (!m || !TOOLS.some((t) => t.function.name === m[1])) return message
  const strings: string[] = []
  let s = m[2].replace(/<\|"\|>([\s\S]*?)<\|"\|>/g, (_, v: string) => `\u0000${strings.push(v) - 1}\u0000`)
  s = s.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/\u0000(\d+)\u0000/g, (_, i: string) => JSON.stringify(strings[Number(i)]))
  try {
    if (typeof JSON.parse(s) !== 'object') return message
  } catch {
    return message
  }
  return { ...message, content: '', tool_calls: [{ type: 'function', function: { name: m[1], arguments: s } }] }
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()

/** The project named by `value`: its canonical name if `value` is one of `projects`' names or
 *  aliases, else `value` itself, normalized. */
export function canonicalProject(value: unknown, projects: Project[]): string {
  const v = norm(value)
  const p = projects.find((p) => norm(p.name) === v || (p.aliases ?? []).some((a) => norm(a) === v))
  return p ? norm(p.name) : v
}

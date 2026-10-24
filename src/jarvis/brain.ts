import { listed, RULES, TOOLS, type App, type Project, type Tool } from './routing'

/** What the loop (`./loop`) needs to hold a conversation with either brain (jarvis-brain, #503):
 *  the moment in words, the conversation's memory, and Claude's side of the seam: its system
 *  prompt and the tool call read out of its words. Claude has no tool of its own; it names one of
 *  `TOOLS` in a JSON line and the loop runs it. */

/** Requests further apart than this start a new conversation. */
export const PAUSE_MS = 30 * 60_000
/** The exchanges the local model is shown before a request. */
export const REMEMBERED = 8

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const two = (n: number) => String(n).padStart(2, '0')

/** The date and time in Portuguese words, in the machine's own zone: "sexta-feira, 23 de outubro
 *  de 2026, 21:50". */
export function moment(at: number): string {
  const d = new Date(at)
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}, ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** One request and James's final reply to it. */
export type Exchange = { request: string; reply: string }

/** A tool as Claude's system prompt lists it: `- git_log(project, limit?): Recent commits…`. */
function describe(t: Tool): string {
  const { properties = {}, required = [] } = t.function.parameters as { properties?: Record<string, { enum?: string[] }>; required?: string[] }
  const params = Object.entries(properties).map(([name, p]) => `${name}${required.includes(name) ? '' : '?'}${p.enum ? ` (${p.enum.join(' | ')})` : ''}`)
  return `- ${t.function.name}(${params.join(', ')}): ${t.function.description}`
}

/** James's system prompt for Claude: `RULES`, then the tools and how to call one, then `listed()`.
 *  It holds nothing of the moment, so it stays the same across a conversation; the moment goes with
 *  each request (`turnText`). */
export function claudeSystem(projects: Project[], apps: App[] = []): string {
  return [
    ...RULES,
    '',
    'Ferramentas. Quando houver o que ler, fazer ou perguntar, termine a resposta com exatamente um objeto JSON, numa linha só, nomeando uma ferramenta e seus argumentos: {"tool": "git_status", "args": {"project": "nome"}}. Uma frase curta antes dele é dita ao usuário enquanto a ferramenta roda; nada depois dele. A saída da ferramenta chega na mensagem seguinte. Quando não houver (um bom-dia, uma conversa, uma opinião sobre o que já foi lido), responda só em palavras, sem JSON.',
    'Argumentos com ? são opcionais. O projeto é sempre um dos nomes da lista abaixo, como está escrito.',
    ...TOOLS.map(describe),
    ...listed(projects, apps),
  ].join('\n')
}

/** What Claude is sent for a request: what the panel showed that Claude did not say (`told`), the
 *  moment and the state (`context`), then the request. */
export function turnText(request: string, context: string, told: string[]): string {
  return [
    ...(told.length ? ['O painel mostrou, sem passar por você:', ...told, ''] : []),
    `[Estado atual: ${context}]`,
    request,
  ].join('\n')
}

/** What Claude is sent after a tool it called ran. */
export const toolText = (name: string, project: string | undefined, out: string) => `Saída de ${name}${project ? ` no ${project}` : ''}:\n${out}`

/** The end of the balanced `{…}` starting at `from`, strings respected; -1 when it never closes. */
function closing(text: string, from: number): number {
  let depth = 0
  let quoted = false
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '\\') i++
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

export type ClaudeReply = {
  /** Claude's words: the whole reply, or what it wrote before the call. */
  words: string
  tool: string | null
  args: Record<string, unknown>
}

/** Claude's reply, read: its words, and the first JSON object in it naming a `tool`, with `args`.
 *  A fence around the object is dropped with it; anything after it is not Claude's to say. */
export function readReply(text: string): ClaudeReply {
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    const end = closing(text, i)
    if (end < 0) break
    let value: unknown
    try {
      value = JSON.parse(text.slice(i, end + 1))
    } catch {
      continue
    }
    const call = value as { tool?: unknown; args?: unknown }
    if (!call || typeof call.tool !== 'string') continue
    const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? (call.args as Record<string, unknown>) : {}
    const words = text.slice(0, i).replace(/```[a-z]*\s*$/i, '').trim()
    return { words, tool: call.tool, args }
  }
  return { words: text.trim(), tool: null, args: {} }
}

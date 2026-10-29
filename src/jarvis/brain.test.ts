import { claudeSystem, moment, readReply, toolText, turnText } from './brain'
import { RULES, TOOLS } from './routing'

test('the moment, in Portuguese words', () => {
  expect(moment(new Date(2026, 9, 23, 21, 50).getTime())).toBe('sexta-feira, 23 de outubro de 2026, 21:50')
  expect(moment(new Date(2027, 0, 3, 7, 5).getTime())).toBe('domingo, 3 de janeiro de 2027, 07:05')
  expect(moment(new Date(2026, 2, 4, 0, 0).getTime())).toBe('quarta-feira, 4 de março de 2026, 00:00')
})

describe("Claude's reply", () => {
  test('words alone are its answer', () => {
    expect(readReply('  Está tudo verde.  ')).toEqual({ words: 'Está tudo verde.', tool: null, args: {} })
  })

  test('a JSON line names the tool and its arguments', () => {
    expect(readReply('{"tool": "git_log", "args": {"project": "tasklist", "limit": 5}}')).toEqual({ words: '', tool: 'git_log', args: { project: 'tasklist', limit: 5 } })
  })

  test('words before the call are said; anything after it is not', () => {
    expect(readReply('Vou ver os PRs.\n{"tool": "gh_pr_list", "args": {}}\nJá volto.')).toEqual({ words: 'Vou ver os PRs.', tool: 'gh_pr_list', args: {} })
  })

  test('a fence around the call goes with it', () => {
    expect(readReply('Olhando.\n```json\n{"tool": "git_status", "args": {"project": "x"}}\n```')).toEqual({ words: 'Olhando.', tool: 'git_status', args: { project: 'x' } })
  })

  test('braces in strings, and missing or odd args', () => {
    expect(readReply('{"tool": "search", "args": {"project": "x", "query": "fn() { }"}}').args).toEqual({ project: 'x', query: 'fn() { }' })
    // An unbalanced brace in a string, after an escaped quote, does not end the call.
    expect(readReply('Vou buscar. {"tool": "search", "args": {"project": "x", "query": "a\\"}"}} depois').args).toEqual({ project: 'x', query: 'a"}' })
    expect(readReply('{"tool": "list_sessions"}')).toEqual({ words: '', tool: 'list_sessions', args: {} })
    expect(readReply('{"tool": "list_sessions", "args": [1]}').args).toEqual({})
  })

  test("a call in Claude's own markup is a call, and the markup is never words", () => {
    const markup = '<function_calls>\n<invoke name="read_file">\n<parameter name="project">tasklist</parameter>\n<parameter name="path">README.md</parameter>\n</invoke>\n</function_calls>'
    expect(readReply(`Vou ler o README.\n${markup}`)).toEqual({ words: 'Vou ler o README.', tool: 'read_file', args: { project: 'tasklist', path: 'README.md' } })
    expect(readReply('<invoke name="gh_pr_view"><parameter name="number">12</parameter></invoke>').args).toEqual({ number: 12 })
    // Markup before a JSON call goes; the JSON is the call.
    expect(readReply(`${markup}\n{"tool": "git_log", "args": {"project": "x"}}`)).toEqual({ words: '', tool: 'git_log', args: { project: 'x' } })
  })

  test('braces that are no call are words', () => {
    expect(readReply('Use {chave} no template.')).toEqual({ words: 'Use {chave} no template.', tool: null, args: {} })
    expect(readReply('O config é {"a": 1}.')).toEqual({ words: 'O config é {"a": 1}.', tool: null, args: {} })
    expect(readReply('Começo {"tool": "git_')).toMatchObject({ tool: null })
  })
})

test("Claude's system prompt: the rules, then every tool, then the projects and apps", () => {
  const system = claudeSystem([{ name: 'tasklist', aliases: ['tarefas'] }], [{ name: 'VS Code', project: true }])
  const lines = system.split('\n')
  expect(lines.slice(0, RULES.length)).toEqual(RULES)
  for (const t of TOOLS) expect(system).toContain(`- ${t.function.name}(`)
  expect(system).toContain('- git_log(project, limit?): Recent commits of a project.')
  expect(system).toContain('- open_in_browser(project, page (repo | pr | issue | actions), number?): ')
  expect(system.indexOf('- open_url(')).toBeLessThan(system.indexOf('Projetos conhecidos:'))
  expect(system).toContain('- tasklist (também: tarefas)')
  expect(system).toContain('- VS Code (aceita um projeto)')
})

test('what Claude is sent: what it did not see, the state, the request; and a tool output', () => {
  expect(turnText('e agora?', 'agora é x', [])).toBe('[Estado atual: agora é x]\ne agora?')
  expect(turnText('e agora?', 'agora é x', ['James: Mandei para o tasklist.'])).toBe(
    'O painel mostrou, sem passar por você:\nJames: Mandei para o tasklist.\n\n[Estado atual: agora é x]\ne agora?',
  )
  expect(turnText('como tá tudo?', 'agora é x', [], 'tasklist: 2 PRs abertos')).toBe(
    '[Panorama dos projetos, lido agora há pouco; vale até vir outro:\ntasklist: 2 PRs abertos\n]\n[Estado atual: agora é x]\ncomo tá tudo?',
  )
  expect(toolText('git_status', 'tasklist', 'limpo')).toBe('Saída de git_status no tasklist:\nlimpo')
  expect(toolText('gh_pr_list', undefined, 'nenhum')).toBe('Saída de gh_pr_list:\nnenhum')
})

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import {
  REAL_SET,
  REPO_SET,
  setName,
  TOOLS,
  canonicalProject,
  chatBody,
  firstCall,
  foldChunks,
  isOutput,
  parseArgs,
  parseSet,
  percentile,
  score,
  sseEvents,
  summarize,
  systemPrompt,
  table,
  vramSampler,
} from './jarvis-bench.mjs'

const projects = [{ name: 'mnemo-desktop', aliases: ['desktop'] }, { name: 'mnemo' }]
const call = (name, args) => ({ content: '', tool_calls: [{ function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } }] })

/** A canned llama-server stream: the tool call's name, then its arguments in two pieces. */
const SSE = [
  'data: {"choices":[{"delta":{"role":"assistant","content":null}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","type":"function","function":{"name":"gh_run_list","arguments":""}}]}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"project\\": "}}]}}]}',
  '',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"mnemo\\"}"}}]}}]}',
  '',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  '',
  'data: [DONE]',
  '',
].join('\n')

test('a streamed tool call folds back into one call, and the role-only chunk is not output', () => {
  const chunks = sseEvents(SSE)
  expect(chunks).toHaveLength(5)
  expect(isOutput(chunks[0])).toBe(false)
  expect(isOutput(chunks[1])).toBe(true)
  expect(firstCall(foldChunks(chunks))).toEqual({ tool: 'gh_run_list', args: { project: 'mnemo' } })
})

test('reasoning and text stream into their own fields', () => {
  const m = foldChunks([
    { choices: [{ delta: { reasoning_content: 'hm' } }] },
    { choices: [{ delta: { content: 'Qual ' } }] },
    { choices: [{ delta: { content: 'projeto?' } }] },
  ])
  expect(m).toMatchObject({ content: 'Qual projeto?', reasoning_content: 'hm', tool_calls: [] })
  expect(firstCall(m)).toEqual({ tool: null, args: null })
})

test('the right tool with the right project scores both; an alias names the same project', () => {
  const row = { request: 'x', expect: { tool: 'git_status', project: 'mnemo-desktop' } }
  expect(score(row, call('git_status', { project: 'mnemo-desktop' }), projects)).toMatchObject({ toolOk: true, argsOk: true })
  expect(score(row, call('git_status', { project: ' Desktop ' }), projects)).toMatchObject({ toolOk: true, argsOk: true })
  expect(score(row, call('git_status', { project: 'mnemo' }), projects)).toMatchObject({ toolOk: true, argsOk: false })
  expect(score(row, call('git_status', {}), projects)).toMatchObject({ toolOk: true, argsOk: false })
  expect(score(row, call('git_log', { project: 'mnemo-desktop' }), projects)).toMatchObject({ toolOk: false, argsOk: false })
})

test('the project counts whichever tool named it, and a reply that reasoned is flagged', () => {
  const row = { request: 'x', expect: { tool: 'delegate_to_parent', project: 'mnemo' } }
  expect(score(row, call('ask_user', { question: '?', reason: 'destructive', project: 'mnemo' }), projects)).toMatchObject({ toolOk: false, argsOk: false, projectOk: true, reasoned: false })
  expect(score(row, { ...call('delegate_to_parent', { project: 'mnemo-desktop' }), reasoning_content: 'pensando' }, projects)).toMatchObject({ projectOk: false, reasoned: true })
  expect(score({ request: 'x', expect: { tool: 'list_sessions' } }, call('list_sessions', {}), projects).projectOk).toBeNull()
  const s = summarize([
    score(row, call('ask_user', { project: 'mnemo' }), projects),
    score(row, { ...call('git_log', { project: 'outro' }), reasoning_content: 'hm' }, projects),
    score({ request: 'x', expect: { tool: 'list_sessions' } }, call('list_sessions', {}), projects),
  ])
  expect(s).toMatchObject({ project: 1, withProject: 2, reasoned: 1 })
  expect(table([{ candidate: 'c', summary: s, vram: null }]).split('\n')[2]).toMatch(/^\| c · reasoned on 1 \| 1\/3 \(33%\) \| 1\/3 \(33%\) \| 1\/2 \(50%\) \|/)
})

test('arguments that are not JSON fail the arguments, not the tool', () => {
  const row = { request: 'x', expect: { tool: 'git_status', project: 'mnemo' } }
  expect(score(row, call('git_status', '{project: mnemo'), projects)).toMatchObject({ toolOk: true, argsOk: false })
})

test('expected arguments: a string is contained, ignoring case; a number matches exactly', () => {
  const row = { request: 'x', expect: { tool: 'read_file', project: 'mnemo', args: { path: 'readme' } } }
  expect(score(row, call('read_file', { project: 'mnemo', path: 'README.md' }), projects).argsOk).toBe(true)
  expect(score(row, call('read_file', { project: 'mnemo', path: 'CHANGELOG.md' }), projects).argsOk).toBe(false)
  const pr = { request: 'x', expect: { tool: 'gh_pr_view', project: 'mnemo', args: { number: 500 } } }
  expect(score(pr, call('gh_pr_view', { project: 'mnemo', number: 500 }), projects).argsOk).toBe(true)
  expect(score(pr, call('gh_pr_view', { project: 'mnemo', number: '500' }), projects).argsOk).toBe(true)
  expect(score(pr, call('gh_pr_view', { project: 'mnemo', number: 50 }), projects).argsOk).toBe(false)
})

test('asking: counted where the row wants it, and a text-only reply is not an ask', () => {
  const unknown = { request: 'abre um PR com isso', expect: { tool: 'ask_user' } }
  expect(score(unknown, call('ask_user', { question: 'Em qual projeto?', reason: 'project_unknown' }), projects)).toMatchObject({ shouldAsk: true, asked: true, toolOk: true, argsOk: true })
  expect(score(unknown, { content: 'Em qual projeto?' }, projects)).toMatchObject({ shouldAsk: true, asked: false, textOnly: true, toolOk: false })
  const destructive = { request: 'apaga a branch', expect: { tool: 'ask_user', project: 'mnemo' } }
  expect(score(destructive, call('ask_user', { question: '?', reason: 'destructive', project: 'mnemo' }), projects).argsOk).toBe(true)
  expect(score(destructive, call('delegate_to_parent', { project: 'mnemo', request: 'apaga a branch' }), projects)).toMatchObject({ asked: false, toolOk: false })
  expect(score({ request: 'x', expect: { tool: 'git_log', project: 'mnemo' } }, call('ask_user', { question: '?' }), projects)).toMatchObject({ shouldAsk: false, asked: true })
  expect(score(unknown, null, projects)).toMatchObject({ toolOk: false, asked: false })
})

test('the summary counts hits, needless asks and errors, with nearest-rank percentiles', () => {
  const s = summarize([
    { toolOk: true, argsOk: true, shouldAsk: false, asked: false, ttftMs: 100, totalMs: 300 },
    { toolOk: true, argsOk: false, shouldAsk: false, asked: false, ttftMs: 200, totalMs: 400 },
    { toolOk: false, argsOk: false, shouldAsk: false, asked: true, ttftMs: 300, totalMs: 500 },
    { toolOk: true, argsOk: true, shouldAsk: true, asked: true, ttftMs: 400, totalMs: 900 },
    { toolOk: false, argsOk: false, shouldAsk: true, asked: false, textOnly: true, error: 'HTTP 500' },
  ])
  expect(s).toMatchObject({ n: 5, errors: 1, tool: 3, args: 2, asked: 1, shouldAsk: 2, askedNeedlessly: 1, textOnly: 1 })
  expect(s.ttft).toEqual({ p50: 200, p95: 400 })
  expect(s.total).toEqual({ p50: 400, p95: 900 })
  expect(percentile([], 0.5)).toBeNull()
  expect(percentile([7], 0.95)).toBe(7)
})

test('the table has one row per candidate and names no request or project', () => {
  const summary = summarize([{ toolOk: true, argsOk: true, shouldAsk: true, asked: true, ttftMs: 120.4, totalMs: 480.6, request: 'segredo', project: 'privado' }])
  const t = table([{ candidate: 'nano-4b', summary, vram: { peakMiB: 5120, deltaMiB: 3000 } }, { candidate: 'control', summary, vram: null }])
  const lines = t.split('\n')
  expect(lines).toHaveLength(4)
  expect(lines[2]).toBe('| nano-4b | 1/1 (100%) | 1/1 (100%) | — | 1/1 (100%) | 0 | 0 | 120 / 120 | 481 / 481 | 5120 (+3000 over idle) |')
  expect(lines[3]).toContain('| control |')
  expect(lines[3].endsWith('| — |')).toBe(true)
  expect(t).not.toMatch(/segredo|privado/)
})

test('a set: the projects line, example rows skipped, and projects drawn from the set without one', () => {
  const text = [
    '{"example": true, "request": "modelo", "expect": {"tool": "git_status", "project": "a"}}',
    '{"request": "um", "expect": {"tool": "git_status", "project": "b"}}',
    '{"request": "dois", "expect": {"tool": "ask_user"}}',
    '{"request": "sem expect"}',
    'not json',
  ].join('\n')
  const s = parseSet(text)
  expect(s.requests.map((r) => r.request)).toEqual(['um', 'dois'])
  expect(s.projects).toEqual([{ name: 'b' }])
  expect(parseSet(`{"projects": ["x", {"name": "y", "aliases": ["z"]}]}\n${text}`).projects).toEqual([{ name: 'x' }, { name: 'y', aliases: ['z'] }])
})

test('the repo set is well formed, names only its listed projects, and covers every tool', () => {
  const { requests, projects } = parseSet(readFileSync(REPO_SET, 'utf8'))
  expect(requests.length).toBeGreaterThanOrEqual(30)
  const names = new Set(projects.map((p) => p.name))
  const tools = new Set(TOOLS.map((t) => t.function.name))
  for (const r of requests) {
    expect(tools.has(r.expect.tool)).toBe(true)
    if (r.expect.project) expect(names.has(r.expect.project)).toBe(true)
  }
  expect(new Set(requests.map((r) => r.expect.tool))).toEqual(tools)
  expect(requests.filter((r) => r.expect.tool === 'ask_user' && !r.expect.project).length).toBeGreaterThan(0)
  expect(requests.filter((r) => r.expect.tool === 'ask_user' && r.expect.project).length).toBeGreaterThan(0)
})

test('the tool schema: step 2\'s read tools plus delegating and asking, and never a shell', () => {
  const names = TOOLS.map((t) => t.function.name)
  expect(names).toContain('delegate_to_parent')
  expect(names).toContain('ask_user')
  expect(names.some((n) => /shell|exec|bash|run_command/.test(n))).toBe(false)
  for (const t of TOOLS) expect(t.function.parameters.required.every((k) => k in t.function.parameters.properties)).toBe(true)
})

test('the request body: tools, the known projects and the context; reasoning off unless asked', () => {
  const b = chatBody({ request: 'oi', context: 'um parent roda no mnemo' }, projects)
  expect(b.tools).toBe(TOOLS)
  expect(b.stream).toBe(true)
  expect(b.temperature).toBe(0)
  expect(b.chat_template_kwargs.enable_thinking).toBe(false)
  expect(b.messages[1]).toEqual({ role: 'user', content: 'oi' })
  expect(b.messages[0].content).toContain('- mnemo-desktop (também: desktop)')
  expect(b.messages[0].content).toContain('Estado atual: um parent roda no mnemo')
  expect(b.messages[0].content.startsWith('/no_think')).toBe(true)
  const on = chatBody({ request: 'oi' }, projects, { reasoning: true })
  expect(on.chat_template_kwargs.enable_thinking).toBe(true)
  expect(on.messages[0].content).not.toContain('/no_think')
  expect(systemPrompt(projects)).toContain('nenhum parent rodando')
})

test('canonical project: names and aliases, case and spaces aside; an unknown name stays itself', () => {
  expect(canonicalProject('DESKTOP', projects)).toBe('mnemo-desktop')
  expect(canonicalProject('outro', projects)).toBe('outro')
  expect(canonicalProject(undefined, projects)).toBe('')
})

test('options: the default sets, a started server, and llama-server\'s own args after --', () => {
  const d = parseArgs([])
  expect(d.sets).toHaveLength(2)
  expect(d.sets[0]).toBe(REPO_SET)
  const o = parseArgs(['--server', 'llama-server.exe', '--model', 'm.gguf', '--candidate', 'nano', '--reasoning', '--', '-ngl', '999', '--n-cpu-moe', '20'])
  expect(o).toMatchObject({ server: 'llama-server.exe', model: 'm.gguf', candidate: 'nano', reasoning: true, serverArgs: ['-ngl', '999', '--n-cpu-moe', '20'] })
  expect(() => parseArgs(['--bogus'])).toThrow('unknown option --bogus')
})

test('only the repo set, however its path is written, is named other than real', () => {
  expect(setName(REPO_SET)).toBe('repo (synthetic)')
  expect(setName(relative(process.cwd(), REPO_SET))).toBe('repo (synthetic)')
  expect(setName(REAL_SET)).toBe('real')
  expect(setName('elsewhere/jarvis-bench.jsonl')).toBe('real')
})

test('the VRAM sampler keeps the peak it reads', () => {
  vi.useFakeTimers()
  const reads = [1000, 1500, 4200, 3900]
  const s = vramSampler(10, () => reads.shift() ?? null)
  vi.advanceTimersByTime(35)
  expect(s.stop()).toBe(4200)
  vi.useRealTimers()
})

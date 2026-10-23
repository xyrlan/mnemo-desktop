import { firstCall, recoverBareCall, systemPrompt, TOOLS, type Reply } from './routing'

const text = (content: string): Reply => ({ content, reasoning_content: '', tool_calls: [] })
const q = (s: string) => `<|"|>${s}<|"|>`

test('a bare Gemma 4 call becomes the tool call it names, strings and numbers intact', () => {
  const r = recoverBareCall(text(`delegate_to_parent{project:${q('mnemo')},request:${q('corrige o teste: "x, y" e {z}')}}`))
  expect(r.content).toBe('')
  expect(firstCall(r)).toEqual({ tool: 'delegate_to_parent', args: { project: 'mnemo', request: 'corrige o teste: "x, y" e {z}' } })
  expect(firstCall(recoverBareCall(text(`call:gh_pr_view{number:511,project:${q('desktop')}}`)))).toEqual({ tool: 'gh_pr_view', args: { number: 511, project: 'desktop' } })
  expect(firstCall(recoverBareCall(text(`  parent_status{project:${q('mnemo')}}\n`))).tool).toBe('parent_status')
})

test('anything that is not exactly one call to a known tool stays text', () => {
  for (const s of [
    'Bom dia! Pode mandar.',
    `shell{cmd:${q('rm -rf /')}}`,
    `Vou chamar delegate_to_parent{project:${q('mnemo')}}`,
    `delegate_to_parent{project:${q('mnemo')}} e depois git_log{}`,
    'git_status{project:mnemo',
  ]) {
    const r = recoverBareCall(text(s))
    expect(r.tool_calls).toEqual([])
    expect(r.content).toBe(s)
  }
  const real: Reply = { content: 'git_log{}', reasoning_content: '', tool_calls: [{ function: { name: 'git_status', arguments: '{}' } }] }
  expect(recoverBareCall(real)).toBe(real)
})

test('the apps James may open are listed only when there are some', () => {
  const projects = [{ name: 'mnemo' }]
  expect(systemPrompt(projects)).not.toContain('Apps que você pode abrir')
  const p = systemPrompt(projects, undefined, true, [{ name: 'VS Code', project: true }, { name: 'Spotify' }])
  expect(p).toContain('Apps que você pode abrir:\n- VS Code (aceita um projeto)\n- Spotify')
  expect(p.startsWith('Você é o James,')).toBe(true)
})

test('the tools stay closed: no shell, and the screen and apps are asked for by name', () => {
  const names = TOOLS.map((t) => t.function.name)
  expect(names.some((n) => /shell|exec|bash|run_command|powershell|cmd/.test(n))).toBe(false)
  expect(names).toEqual(expect.arrayContaining(['look_at_screen', 'open_app', 'open_in_browser', 'open_url']))
  expect(new Set(names).size).toBe(names.length)
})

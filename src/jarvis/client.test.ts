import { makeJarvisClient, READ_TOOLS, type ChannelLike } from './client'
import { TOOLS } from './routing'

function fake() {
  const calls: [string, Record<string, unknown> | undefined][] = []
  const listened: string[] = []
  const client = makeJarvisClient(
    async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args])
      const on = args?.on as ChannelLike<unknown> | undefined
      on?.onmessage({ from: cmd })
      return undefined as T
    },
    <T,>() => ({ onmessage: (_: T) => {} }),
    async (event) => {
      listened.push(event)
      return () => {}
    },
  )
  return { client, calls, listened }
}

test('every command goes to Rust under the contract\'s name, with its arguments', async () => {
  const { client, calls, listened } = fake()
  await client.projects()
  await client.log({ said: 'oi' })
  await client.stopModel()
  await client.brain()
  await client.brainAsk('Você é o James.', 'bom dia')
  await client.brainReset()
  await client.tool('git_log', { project: 'mnemo', limit: 5 })
  await client.focusedWindow()
  await client.say('pronto')
  await client.hush()
  await client.screenshot()
  await client.apps()
  await client.openApp('VS Code', 'mnemo')
  await client.openApp('Spotify')
  await client.openInBrowser('mnemo', 'pr', 511)
  await client.openInBrowser('mnemo', 'actions')
  await client.openUrl('https://example.com')
  await client.onVoice(() => {})
  await client.onHeard(() => {})
  await client.onVoiceError(() => {})
  await client.onLevel(() => {})
  await client.listen(true)
  await client.listen()
  expect(calls).toEqual([
    ['jarvis_projects', undefined],
    ['jarvis_log_append', { row: { said: 'oi' } }],
    ['jarvis_llm_stop', undefined],
    ['jarvis_brain', undefined],
    ['jarvis_brain_ask', { system: 'Você é o James.', text: 'bom dia' }],
    ['jarvis_brain_reset', undefined],
    ['jarvis_tool', { name: 'git_log', args: { project: 'mnemo', limit: 5 } }],
    ['jarvis_focused_window', undefined],
    ['jarvis_say', { text: 'pronto' }],
    ['jarvis_hush', undefined],
    ['jarvis_screenshot', undefined],
    ['jarvis_apps', undefined],
    ['jarvis_open_app', { app: 'VS Code', project: 'mnemo' }],
    ['jarvis_open_app', { app: 'Spotify', project: null }],
    ['jarvis_open_in_browser', { project: 'mnemo', page: 'pr', number: 511 }],
    ['jarvis_open_in_browser', { project: 'mnemo', page: 'actions', number: null }],
    ['jarvis_open_url', { url: 'https://example.com' }],
    ['jarvis_listen', { enabled: true }],
    ['jarvis_listen', { enabled: null }],
  ])
  expect(listened).toEqual(['jarvis://voice', 'jarvis://heard', 'jarvis://voice-error', 'jarvis://level'])
})

test('streamed commands hand Rust a channel and pass on what comes back', async () => {
  const { client, calls } = fake()
  const setup: unknown[] = []
  const chunks: unknown[] = []
  await client.ensureModel((s) => setup.push(s))
  await client.chat({ messages: [] }, (c) => chunks.push(c))
  expect(calls.map(([cmd, a]) => [cmd, Object.keys(a ?? {})])).toEqual([
    ['jarvis_llm_ensure', ['on']],
    ['jarvis_llm_chat', ['body', 'on']],
  ])
  expect(setup).toEqual([{ from: 'jarvis_llm_ensure' }])
  expect(chunks).toEqual([{ from: 'jarvis_llm_chat' }])
})

test('the read tools are exactly the tools Rust runs: the rest are the panel\'s to route', () => {
  const names = TOOLS.map((t) => t.function.name)
  expect(READ_TOOLS.every((t) => names.includes(t))).toBe(true)
  expect(names.filter((n) => !(READ_TOOLS as readonly string[]).includes(n))).toEqual([
    'parent_status',
    'delegate_to_parent',
    'ask_user',
    'look_at_screen',
    'open_app',
    'open_in_browser',
    'open_url',
  ])
})

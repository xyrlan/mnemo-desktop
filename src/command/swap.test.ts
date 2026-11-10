// What the swap added to the command line: `classic`, a panel opened by name, and the models
// `mnemo dispatch` names (docs/superpowers/specs/2026-11-10-recreation-swap.md).

import { registerPanel } from '../panels/registry'
import { MODELS } from '../tasks/model'
import { setActions } from '../world/actions'
import { HOME, routeStore } from '../world/route'
import { sampleActions, sampleWorld } from '../world/sample'
import { models, offers } from './complete'
import { enter, lineStore, openCommand, resetLine, rows, type } from './line'
import { VERBS, panelCalled, parse, type Command } from './parse'
import { run } from './run'

const world = sampleWorld()
const Nothing = () => null

const command = (line: string): Command => {
  const parsed = parse(line, world)
  if (!('command' in parsed)) throw new Error(`"${line}" did not parse: ${parsed.error}`)
  return parsed.command
}
const error = (line: string): string => {
  const parsed = parse(line, world)
  if ('command' in parsed) throw new Error(`"${line}" parsed to ${parsed.command.kind}`)
  return parsed.error
}
const route = () => routeStore.getState().route

beforeAll(() => {
  // Three of the panels a build has: enough to tell a name from a prefix two share.
  registerPanel({ id: 'missions', title: 'Missions', hint: 'issues, pull requests, dispatch', Component: Nothing })
  registerPanel({ id: 'memory', title: 'Memory', Component: Nothing })
  registerPanel({ id: 'settings', title: 'Settings', hint: 'saved as you choose', Component: Nothing })
})
afterAll(() => {
  const g = globalThis as { __mnemoPanels?: Map<string, unknown> }
  g.__mnemoPanels?.clear()
})

describe('classic', () => {
  test('is a verb of its own, and takes nothing after it', () => {
    expect(VERBS.map((v) => v.verb)).toContain('classic')
    expect(command('classic')).toEqual({ kind: 'classic' })
    expect(command('/classic')).toEqual({ kind: 'classic' })
    expect(error('classic now')).toBe('classic takes nothing after it: it shows the classic interface.')
  })

  test('says what Enter will do, and is not asked about twice', () => {
    const parsed = parse('classic', world)
    expect(parsed).toMatchObject({ says: 'Show the classic interface (the app loads again; your terminals stay)', batch: false })
  })

  test('taken from the list it is whole: Enter runs it', () => {
    const offer = offers('cla', world).find((o) => o.tag === 'classic')!
    expect(offer).toMatchObject({ fill: 'classic', runs: true })
    // every other verb still wants what comes after it
    expect(
      offers('', world)
        .filter((o) => o.runs)
        .map((o) => o.tag),
    ).toEqual(['classic'])
  })

  test('running it shows the ship; a switch that could not be kept is a refusal, in its words', async () => {
    let shown = 0
    expect(await run({ kind: 'classic' }, world, () => (shown++, null))).toEqual({ ok: true })
    expect(shown).toBe(1)
    expect(await run({ kind: 'classic' }, world, () => 'The choice could not be kept: no storage')).toEqual({ ok: false, why: 'The choice could not be kept: no storage' })
  })
})

describe('a panel, by name', () => {
  test('`panel <name>` opens it; its id, its title or the start of either names it', () => {
    expect(command('panel missions')).toEqual({ kind: 'panel', panel: 'missions' })
    expect(command('panel Missions')).toEqual({ kind: 'panel', panel: 'missions' })
    expect(command('panel mi')).toEqual({ kind: 'panel', panel: 'missions' })
    expect(parse('panel set', world)).toMatchObject({ says: 'Open Settings', batch: false })
  })

  test('a start two panels share names neither, and the refusal lists what there is', () => {
    expect(panelCalled('m')).toBeNull()
    expect(error('panel m')).toBe('No panel called m. There are: missions, memory, settings.')
    expect(error('panel')).toBe('panel <name>: which one? There are: missions, memory, settings.')
    expect(error('panel orbit')).toBe('No panel called orbit. There are: missions, memory, settings.')
  })

  test('a panel named outright is opened, as a session named outright is staged', () => {
    expect(command('missions')).toEqual({ kind: 'panel', panel: 'missions' })
    expect(command('open settings')).toEqual({ kind: 'panel', panel: 'settings' })
    // a word that is neither is still said to be no verb
    expect(error('telescope')).toMatch(/^No verb called telescope\./)
  })

  test('a session’s own name outranks a panel’s: a contract piece called `memory` is the session', () => {
    const s = world.sessions[0]
    const named = { ...world, sessions: world.sessions.map((x) => (x.id === s.id ? { ...x, contract: { feature: 'vault', piece: 'memory' } } : x)) }
    expect(parse('memory', named)).toMatchObject({ command: { kind: 'go', session: s.id } })
    expect(parse('open memory', named)).toMatchObject({ command: { kind: 'go', session: s.id } })
    // the panel is still reached by saying it is one
    expect(parse('panel memory', named)).toMatchObject({ command: { kind: 'panel', panel: 'memory' } })
    // and with no such session, the word is the panel
    expect(command('memory')).toEqual({ kind: 'panel', panel: 'memory' })
  })

  test('typed with no verb, the start of a panel’s name offers it, and Enter opens it', () => {
    const found = offers('mem', world).filter((o) => o.kind === 'panel')
    expect(found).toEqual([{ kind: 'panel', tag: 'panel', label: 'Memory', detail: 'a panel', fill: 'panel memory', runs: true }])
    expect(offers('mi', world).find((o) => o.kind === 'panel')).toMatchObject({ label: 'Missions', detail: 'issues, pull requests, dispatch' })
    // after the verb, every panel, then the ones the letters start
    expect(offers('panel ', world).map((o) => o.fill)).toEqual(['panel missions', 'panel memory', 'panel settings'])
    expect(offers('panel se', world).map((o) => o.fill)).toEqual(['panel settings'])
    expect(offers('panel settings now', world)).toEqual([])
  })

  test('running it opens the panel and closes the line', async () => {
    routeStore.setState({ route: { ...HOME, view: 'console', command: true }, recent: [] })
    expect(await run({ kind: 'panel', panel: 'memory' }, world)).toEqual({ ok: true })
    expect(route()).toMatchObject({ panel: 'memory', command: false, view: 'console' })
  })

  test('from the line itself: the letters, Enter, and the panel is open', async () => {
    const undo = setActions(
      sampleActions(
        () => world,
        () => {},
      ),
    )
    routeStore.setState({ route: { ...HOME, view: 'console' }, recent: [] })
    resetLine()
    openCommand()
    type('sett')
    expect(rows(lineStore.getState(), world)[0]).toMatchObject({ kind: 'run', says: 'Open Settings' })
    await enter(world)
    expect(route()).toMatchObject({ panel: 'settings', command: false })
    expect(lineStore.getState().said).toEqual({ text: 'Open Settings', ok: true })
    undo()
  })
})

describe('the models a dispatch offers', () => {
  test('Fable is one of the models `mnemo dispatch` names', () => {
    expect(MODELS).toContain('fable')
    // empty first: leaving the flag off is the default
    expect(MODELS[0]).toBe('')
  })

  test('`model=` completes to those, newest first, then to what the fleet runs now', () => {
    const fleet = [...new Set(world.sessions.map((s) => s.model).filter(Boolean))]
    expect(models(world).slice(0, 4)).toEqual(['fable', 'opus', 'sonnet', 'haiku'])
    expect(models(world).slice(4).sort()).toEqual([...fleet].sort())
    const offered = offers('dispatch atlas-api #12 model=', world)
    expect(offered[0]).toMatchObject({ label: 'fable', detail: 'a model', fill: 'dispatch atlas-api #12 model=fable ' })
    expect(offered.find((o) => o.label === fleet[0])!.detail).toBe('a model the fleet runs now')
    expect(offers('dispatch atlas-api #12 model=f', world).map((o) => o.label)).toEqual(['fable'])
    expect(offers('dispatch atlas-api #12 advisor=', world)[0].label).toBe('fable')
  })

  test('a model named twice is offered once', () => {
    const twice = { ...world, sessions: world.sessions.map((s, i) => (i === 0 ? { ...s, model: 'opus' } : s)) }
    expect(models(twice).filter((m) => m === 'opus')).toEqual(['opus'])
  })
})

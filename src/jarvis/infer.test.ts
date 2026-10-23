import { inferProject, knownProject, projectsIn, RECENT_MS } from './infer'
import type { JarvisProject } from './client'

const projects: JarvisProject[] = [
  { name: 'mnemo-desktop', aliases: ['desktop', 'app'], root: '/Users/you/code/mnemo-desktop' },
  { name: 'mnemo', aliases: ['memória'], root: '/Users/you/code/mnemo-src' },
  { name: 'tasklist', aliases: [], root: 'C:\\code\\tasklist' },
]
const now = 1_000_000
const infer = (request: string, window: string | null = null, recent: { project: string; at: number } | null = null) =>
  inferProject({ request, window, recent, now, projects })

describe('naming a project', () => {
  test('by its name, an alias or its folder, ignoring case and accents', () => {
    expect(infer('como estão os PRs do mnemo-desktop?')).toEqual({ kind: 'one', project: 'mnemo-desktop', by: 'named' })
    expect(infer('o que mudou no Desktop hoje')).toEqual({ kind: 'one', project: 'mnemo-desktop', by: 'named' })
    expect(infer('lê os briefings da memoria')).toEqual({ kind: 'one', project: 'mnemo', by: 'named' })
    expect(infer('git status no mnemo-src')).toEqual({ kind: 'one', project: 'mnemo', by: 'named' })
  })

  test('spoken with a space where the name has a dash', () => {
    expect(infer('abre o mnemo desktop')).toEqual({ kind: 'one', project: 'mnemo-desktop', by: 'named' })
  })

  test('a name inside a longer one is not that name', () => {
    expect(projectsIn('o mnemo-desktop e o mnemo desktop', projects)).toEqual(['mnemo-desktop'])
    expect(projectsIn('approve', projects)).toEqual([])
  })

  test('naming beats the window and the recent project', () => {
    expect(infer('e o tasklist?', 'mnemo-desktop - Visual Studio Code', { project: 'mnemo', at: now })).toMatchObject({ project: 'tasklist', by: 'named' })
  })
})

describe('the window in front', () => {
  test('its title names the project when the request does not', () => {
    expect(infer('roda os testes', 'infer.ts - mnemo-desktop - Visual Studio Code')).toEqual({ kind: 'one', project: 'mnemo-desktop', by: 'window' })
    expect(infer('o que é isso?', 'C:\\code\\tasklist\\main.rs')).toEqual({ kind: 'one', project: 'tasklist', by: 'window' })
  })

  test('a title naming two falls through to the recent project', () => {
    expect(infer('e agora?', 'mnemo vs tasklist', { project: 'tasklist', at: now - 1000 })).toEqual({ kind: 'one', project: 'tasklist', by: 'recent' })
  })
})

describe('the project of the last few minutes', () => {
  test('answers when nothing else does', () => {
    expect(infer('e os checks?', 'Spotify', { project: 'mnemo', at: now - RECENT_MS + 1 })).toEqual({ kind: 'one', project: 'mnemo', by: 'recent' })
  })

  test('is forgotten after a few minutes', () => {
    expect(infer('e os checks?', null, { project: 'mnemo', at: now - RECENT_MS - 1 })).toEqual({ kind: 'ask', candidates: [] })
  })

  test('a project no longer known is not recent', () => {
    expect(infer('e os checks?', null, { project: 'gone', at: now })).toEqual({ kind: 'ask', candidates: [] })
  })
})

describe('ambiguous', () => {
  test('two named ask between those two', () => {
    expect(infer('compara o tasklist com o mnemo')).toEqual({ kind: 'ask', candidates: ['tasklist', 'mnemo'] })
  })

  test('two named, the window settles it when it shows one of them', () => {
    expect(infer('compara o tasklist com o mnemo', 'tasklist - Explorer')).toEqual({ kind: 'one', project: 'tasklist', by: 'window' })
  })

  test('two named, a recent third project does not settle it', () => {
    expect(infer('compara o tasklist com o mnemo', null, { project: 'mnemo-desktop', at: now })).toEqual({ kind: 'ask', candidates: ['tasklist', 'mnemo'] })
  })

  test('two in the window title ask between those', () => {
    expect(infer('fecha isso', 'mnemo | tasklist')).toEqual({ kind: 'ask', candidates: ['mnemo', 'tasklist'] })
  })

  test('nothing at all asks with no candidates', () => {
    expect(infer('como está?')).toEqual({ kind: 'ask', candidates: [] })
  })
})

test('a project as the model wrote it', () => {
  expect(knownProject('Mnemo-Desktop', projects)).toBe('mnemo-desktop')
  expect(knownProject('memoria', projects)).toBe('mnemo')
  expect(knownProject('mnemo-src', projects)).toBe('mnemo')
  expect(knownProject('other', projects)).toBeNull()
  expect(knownProject('', projects)).toBeNull()
  expect(knownProject(3, projects)).toBeNull()
})

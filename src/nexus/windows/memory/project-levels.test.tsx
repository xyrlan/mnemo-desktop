import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { LevelClient } from '../../../vaultlevel/client'
import { XP_PER_FIRE, XP_PER_FIRED_RULE } from '../../../vaultlevel/level'
import type { ProjectLevels } from '../../../vaultlevel/types'
import { useProjectLevels, type ProjectProgress } from './Level'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A client over synthetic per-project numbers, keeping each project's best as the command does. */
function fake(answer: () => ProjectLevels) {
  const best: Record<string, number> = { retired: 450 }
  const offers: Record<string, number>[] = []
  const client: LevelClient = {
    level: async () => {
      throw new Error('the decks read no vault level')
    },
    best: async () => {
      throw new Error('the decks offer no vault xp')
    },
    projects: async () => answer(),
    projectsBest: async (xp) => {
      offers.push(xp)
      for (const [k, v] of Object.entries(xp)) best[k] = Math.max(best[k] ?? 0, v)
      return { ...best }
    },
  }
  return { client, offers }
}

let root: Root | null = null
let seen: ProjectProgress | 'none' | null = null

function Probe({ client, again }: { client: LevelClient; again?: unknown }) {
  seen = useProjectLevels(client, 60_000, undefined, again)
  return null
}

const draw = (client: LevelClient, again?: unknown) =>
  act(async () => {
    root ??= createRoot(document.body.appendChild(document.createElement('div')))
    root.render(<Probe client={client} again={again} />)
  })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  seen = null
})

test('each project gets the level of its own best xp, in one read for all of them', async () => {
  let projects: ProjectLevels['projects'] = { alpha: { pages: 40, rules_fired: 10, fires: 25 }, beta: { pages: 2, rules_fired: 1, fires: 1 } }
  const { client, offers } = fake(() => ({ root: '/v', projects, error: null }))
  await draw(client)
  expect(offers).toEqual([{ alpha: 40 + 10 * XP_PER_FIRED_RULE + 25 * XP_PER_FIRE, beta: 2 + XP_PER_FIRED_RULE + XP_PER_FIRE }])
  const got = seen as ProjectProgress
  expect(got.get('alpha')).toEqual({ level: 1, into: 15, fraction: 0.15 })
  expect(got.get('beta')!.level).toBe(0)
  // A project gone from the logs keeps its best.
  expect(got.get('retired')!.level).toBe(4)
  // alpha falls (a rule retired): its level does not.
  projects = { alpha: { pages: 40, rules_fired: 0, fires: 0 }, beta: projects.beta }
  await draw(client, 'learned')
  expect((seen as ProjectProgress).get('alpha')!.level).toBe(1)
})

test('no vault reads none', async () => {
  const { client, offers } = fake(() => ({ root: null, projects: {}, error: 'no mnemo vault found' }))
  await draw(client)
  expect(seen).toBe('none')
  expect(offers).toEqual([])
})

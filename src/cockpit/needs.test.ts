import { needsYou } from './needs'
import { snapshot } from '../mission/fixtures'
import { withPrs } from './fixtures'

test('blocked children, then red CI, then landable contracts', () => {
  expect(needsYou(withPrs).map((n) => n.key)).toEqual([
    'blocked:094c6a03',
    'ci:/Users/me/github/mnemo#13',
    'land:/Users/me/github/mnemo/docs/contracts/round4.md',
  ])
  const [b] = needsYou(snapshot)
  expect(b).toMatchObject({ kind: 'blocked', label: 'vault', repo: { name: 'mnemo-desktop' } })
})

test('nothing when nothing is blocked, red or landable', () => {
  expect(needsYou({ ...snapshot, repos: snapshot.repos.slice(1) })).toEqual([])
})

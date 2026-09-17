import { store as layout } from '../layout/app-store'
import { dispatchIssue, dispatchIssues } from './actions'

const typed: [string | undefined, string][] = []

beforeEach(() => {
  typed.length = 0
  layout.setState({ openCommandTab: async (cwd, cmd) => void typed.push([cwd, cmd]) })
})

test('dispatchIssue types the single-issue command, unchanged', () => {
  dispatchIssue('/repo', 45)
  expect(typed).toEqual([['/repo', 'mnemo dispatch 45']])
})

test('dispatchIssues types every issue in one command, in the order given', () => {
  dispatchIssues('/repo', [3, 1, 2])
  expect(typed).toEqual([['/repo', 'mnemo dispatch 3 1 2']])
})

test('dispatchIssues appends --model, --effort and --may when given', () => {
  dispatchIssues('/repo', [1], { model: 'opus', effort: 'high', may: 'pr' })
  expect(typed).toEqual([['/repo', 'mnemo dispatch 1 --model opus --effort high --may pr']])
})

test('dispatchIssues only appends the flags actually given', () => {
  dispatchIssues('/repo', [1, 2], { effort: 'low' })
  expect(typed).toEqual([['/repo', 'mnemo dispatch 1 2 --effort low']])
})

test('dispatchIssues does nothing for an empty selection', () => {
  dispatchIssues('/repo', [])
  expect(typed).toEqual([])
})

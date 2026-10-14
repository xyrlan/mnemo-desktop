import { explainError, explainErrors } from './errors'

test('each source of a snapshot error is named, and a missing program says what to do (#367)', () => {
  expect(explainError('claude: No such file or directory (os error 2)')).toEqual({
    source: 'sessions',
    text: 'Claude sessions could not be listed: `claude` was not found. Install Claude Code, or check that `claude --version` works in a new terminal, then restart the app.',
    detail: 'claude: No such file or directory (os error 2)',
  })
  // Windows says it another way.
  expect(explainError('claude: program not found').text).toContain('`claude` was not found')
  expect(explainError('mnemo sessions --json --all: boom').text).toBe('Background children could not be listed: mnemo sessions --json --all: boom')
  expect(explainError('sessions json: expected value').source).toBe('children')
  expect(explainError('agents json: EOF').source).toBe('sessions')
  expect(explainError('gh: The system cannot find the file specified. (os error 2)').text).toContain('gh) was not found')
  expect(explainError('gh pr list --json n: To get started with GitHub CLI, please run:  gh auth login').text).toBe('Pull requests could not be read: gh is not logged in. Run `gh auth login` in a terminal.')
  expect(explainError('gh pr list --json n: error connecting to api.github.com').text).toContain('GitHub could not be reached')
  expect(explainError('history (/h/.claude/history.jsonl): Permission denied (os error 13)').text).toBe("Claude's history could not be read: history (/h/.claude/history.jsonl): Permission denied (os error 13)")
  expect(explainError('account work: claude agents --json --all: Invalid API key').text).toBe('Claude sessions could not be listed on account work: claude agents --json --all: Invalid API key')
  expect(explainError('something new').source).toBe('other')
})

test('only the sources asked for are shown, each said once', () => {
  const errors = ['mnemo: x', 'gh: y', 'mnemo: x', 'claude: z']
  expect(explainErrors(errors, ['children', 'sessions']).map((e) => e.detail)).toEqual(['mnemo: x', 'claude: z'])
  expect(explainErrors([], ['other'])).toEqual([])
})

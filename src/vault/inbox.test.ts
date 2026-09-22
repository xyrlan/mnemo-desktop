import { parseInboxListing, parseInboxStats, splitFrontmatter } from './inbox'

// Captured from a real `mnemo inbox` (project-scoped) on 2026-09-22.
const LISTING = `10 staged pages for mnemo-desktop in shared/_inbox/ (median 6d, oldest 7d)

  reference/github-auth-via-gh-cli-not-oauth             demotion       7d  Use 'gh auth login --web' for authentication instead of implementing na…
  reference/dispatch-button-opens-bar-not-auto-dispatch  demotion       7d  Clicking a dispatch button in the UI should open a command entry, not i…
  reference/run-git-commands-yourself                    demotion       6d  Always run git and GitHub CLI commands yourself; never hand off to ano…

nothing was written — this is a listing only.
  \`mnemo inbox --promote KEY\` moves one into shared/<type>/, where recall sees it
  \`mnemo inbox --drop KEY\` archives it and takes it out of the queue
  \`mnemo inbox --show KEY\` prints one page
  (134 more staged for other projects — \`mnemo inbox --all\`)
`

// Captured from `mnemo inbox --show reference/run-git-commands-yourself`.
const SHOWN = `---
name: 'Run git/gh commands yourself, don''t hand off'
slug: run-git-commands-yourself
type: reference
tags:
  - needs-review
  - git
---

Always run git and gh commands yourself in the current session.

**Why:** you own the commit history.
`

test('parses the header, every row and the other-projects count', () => {
  const listing = parseInboxListing(LISTING)
  expect(listing.summary).toBe('10 staged pages for mnemo-desktop in shared/_inbox/ (median 6d, oldest 7d)')
  expect(listing.other).toBe(134)
  expect(listing.rows).toEqual([
    { key: 'reference/github-auth-via-gh-cli-not-oauth', reason: 'demotion', ageDays: 7, description: "Use 'gh auth login --web' for authentication instead of implementing na…" },
    { key: 'reference/dispatch-button-opens-bar-not-auto-dispatch', reason: 'demotion', ageDays: 7, description: 'Clicking a dispatch button in the UI should open a command entry, not i…' },
    { key: 'reference/run-git-commands-yourself', reason: 'demotion', ageDays: 6, description: 'Always run git and GitHub CLI commands yourself; never hand off to ano…' },
  ])
})

test('a queue empty for this project still names the pages waiting elsewhere', () => {
  const listing = parseInboxListing('nothing staged for mnemo-desktop — 12 page(s) wait for other projects (`mnemo inbox --all`)\n')
  expect(listing).toEqual({ rows: [], summary: 'nothing staged for mnemo-desktop — 12 page(s) wait for other projects (`mnemo inbox --all`)', other: 12 })
})

test('a fully empty vault-wide queue has no other count', () => {
  const listing = parseInboxListing('nothing staged in shared/_inbox/\n')
  expect(listing).toEqual({ rows: [], summary: 'nothing staged in shared/_inbox/', other: 0 })
})

test('an --all listing has no other-projects line', () => {
  const listing = parseInboxListing('3 staged pages across every project in shared/_inbox/ (median 2d, oldest 5d)\n\n  a/b  other  1d  x\n')
  expect(listing.other).toBe(0)
  expect(listing.rows).toEqual([{ key: 'a/b', reason: 'other', ageDays: 1, description: 'x' }])
})

test('unrecognised output (a refusal, no vault) is an empty listing, not a crash', () => {
  expect(parseInboxListing('mnemo: command not found\n')).toEqual({ rows: [], summary: '', other: 0 })
  expect(parseInboxListing('')).toEqual({ rows: [], summary: '', other: 0 })
})

test('parses --stats, with and without the held-expiry and decision-median lines', () => {
  const full = [
    '144 staged in shared/_inbox/ (median 5d, oldest 19d)',
    'last 7 days: 44 offered at session start, 0 promoted, 101 dropped (101 resolved)',
    '  held pages expired unreviewed: 3, restored: 1 (`mnemo inbox --restore KEY`)',
    'median offer → decision: 1.55541d',
  ].join('\n')
  expect(parseInboxStats(full)).toEqual({
    staged: 144,
    medianAgeDays: 5,
    oldestAgeDays: 19,
    windowDays: 7,
    offered: 44,
    promoted: 0,
    dropped: 101,
    resolved: 101,
    expired: 3,
    restored: 1,
    medianDecisionDays: 1.55541,
  })

  const bare = ['0 staged in shared/_inbox/ (median —, oldest —)', 'last 7 days: 0 offered at session start, 0 promoted, 0 dropped (0 resolved)', 'median offer → decision: no page has been both offered and decided yet'].join('\n')
  expect(parseInboxStats(bare)).toEqual({
    staged: 0,
    medianAgeDays: null,
    oldestAgeDays: null,
    windowDays: 7,
    offered: 0,
    promoted: 0,
    dropped: 0,
    resolved: 0,
    expired: null,
    restored: null,
    medianDecisionDays: null,
  })
})

test('unrecognised stats output is null, not a crash', () => {
  expect(parseInboxStats('no mnemo vault found\n')).toBeNull()
  expect(parseInboxStats('')).toBeNull()
})

test('splits the frontmatter fence from the body', () => {
  const { frontmatter, body } = splitFrontmatter(SHOWN)
  expect(frontmatter).toContain('slug: run-git-commands-yourself')
  expect(frontmatter).not.toContain('---')
  expect(body.trim()).toBe('Always run git and gh commands yourself in the current session.\n\n**Why:** you own the commit history.')
})

test('a page with no frontmatter fence still reads, as the body', () => {
  expect(splitFrontmatter('just text, no fence\n')).toEqual({ frontmatter: '', body: 'just text, no fence\n' })
})

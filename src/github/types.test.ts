import { filterByLabels, issueOfBranch, labelsOf, linkIssues, linkWord, shownIssues, RECENT } from './types'
import { issue, mnemoIssues, shippedOnIssue } from './fixtures'
import { desktop } from '../mission/fixtures'

test('issueOfBranch reads the dispatch branch and its variants', () => {
  expect(issueOfBranch('fix/issue-45')).toBe(45)
  expect(issueOfBranch('feat/issue-7-login')).toBe(7)
  expect(issueOfBranch('issue-3')).toBe(3)
  expect(issueOfBranch('feat/round7/github')).toBeNull()
  expect(issueOfBranch('fix/tissue-4')).toBeNull()
  expect(issueOfBranch(null)).toBeNull()
})

test('linkIssues: child on the branch, contract piece, closing PR in and out of the snapshot', () => {
  const links = linkIssues(shippedOnIssue, mnemoIssues)
  expect([...links.keys()].sort((a, b) => a - b)).toEqual([40, 41, 42, 43])
  expect(links.get(40)!.children.map((c) => c.id)).toEqual(['c0ffee01'])
  expect(links.get(41)!.pieces.map((p) => p.piece.name)).toEqual(['api'])
  expect(links.get(41)!.prs.map((p) => p.number)).toEqual([12])
  expect(links.get(42)!.prs.map((p) => p.number)).toEqual([13])
  expect(links.get(43)!).toMatchObject({ prs: [], closing: [99] })
  // A piece naming the issue but with neither child nor PR is no link.
  const later = issue({ number: 50, pieces: [{ contract_path: shippedOnIssue.missions[0].contract_path, piece: 'later' }] })
  expect(linkIssues(shippedOnIssue, [later]).size).toBe(0)
  expect(linkIssues(desktop, mnemoIssues).size).toBe(2) // only the closing refs; #13 is not a desktop PR
})

test('linkWord names the most urgent linked thing', () => {
  const links = linkIssues(shippedOnIssue, mnemoIssues)
  expect(linkWord(links.get(40))).toBe('child active')
  expect(linkWord(links.get(41))).toBe('PR #12 ✓')
  expect(linkWord(links.get(42))).toBe('PR #13 CI ✗')
  expect(linkWord(links.get(43))).toBe('PR #99')
  expect(linkWord(undefined)).toBeNull()
  const blocked = { ...shippedOnIssue, children: shippedOnIssue.children.map((c) => ({ ...c, tempo: 'blocked' })) }
  expect(linkWord(linkIssues(blocked, mnemoIssues).get(40))).toBe('child BLOCKED')
})

test('shown: every linked issue plus the 10 most recent that pass the label filter', () => {
  const links = linkIssues(shippedOnIssue, mnemoIssues)
  const all = shownIssues(mnemoIssues, links, [])
  expect(all.map((i) => i.number)).toEqual([43, 42, 41, 40, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
  expect(all.length).toBe(4 + RECENT)
  const bugs = shownIssues(mnemoIssues, links, ['bug'])
  expect(bugs.map((i) => i.number)).toEqual([43, 42, 41, 40, 11, 9, 7, 5, 3, 1])
  expect(shownIssues(mnemoIssues, links, ['nope']).map((i) => i.number)).toEqual([43, 42, 41, 40])
  expect(filterByLabels(mnemoIssues, ['ui', 'bug']).length).toBe(12)
  expect(labelsOf(mnemoIssues)).toEqual(['bug', 'ui'])
})

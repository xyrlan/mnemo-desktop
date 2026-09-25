import { child, parent } from '../mission/fixtures'
import type { Mission, Piece, Pr, RepoGroup, Snapshot } from '../mission/types'
import { dispatchTitle, ISSUES, parentOf, rowState, waveKey, waveLines, wavesOf, waveOfTarget, waveStays } from './model'

const ROOT = '/code/app'
const WT = '/code/app-wt-parent'
const NOW = Date.parse('2026-09-25T12:00:00Z')
const HOUR = 3600_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

const pr = (over: Partial<Pr> = {}): Pr => ({ number: 1, url: 'https://x/pr/1', state: 'OPEN', head: 'feat/a/b', ci: 'pending', ...over })
const piece = (name: string, over: Partial<Piece> = {}): Piece => ({ name, branch: `feat/w/${name}`, child: null, pr: null, ...over })
const mission = (feature: string, pieces: Piece[], over: Partial<Mission> = {}): Mission => ({ feature, contract_path: `${ROOT}/docs/contracts/${feature}.md`, pieces, landable: false, ...over })

/** A repo with the parent session in the parent's worktree and one in the main checkout. */
function repo(missions: Mission[], children = [] as RepoGroup['children']): Snapshot {
  return {
    repos: [
      {
        root: ROOT,
        name: 'app',
        parents: [parent({ session_id: 'p-wt', cwd: `${WT}/src` }), parent({ session_id: 'p-main', cwd: ROOT })],
        missions,
        children,
      },
    ],
    errors: [],
    at: ago(0),
  }
}

const kid = (id: string, over: Parameters<typeof child>[0] extends infer T ? Partial<T> : never = {}) =>
  child({ id, parent_session: 'p-wt', cwd: `/code/app-wt-${id}`, updated_at: ago(60_000), ...over })

describe('rowState', () => {
  it('reads a blocked tempo, or a prompt claude agents reports, as needing you', () => {
    expect(rowState(kid('a', { tempo: 'blocked' }))).toBe('needs-you')
    expect(rowState(kid('a', { waiting_for: 'permission prompt' }))).toBe('needs-you')
    expect(rowState(kid('a', { waiting_for: 'input needed' }))).toBe('needs-you')
  })
  it('does not count a dialog the user opened', () => {
    expect(rowState(kid('a', { waiting_for: 'dialog open' }))).toBe('working')
  })
  it('counts stalled as working, and a stopped, finished or missing child as done', () => {
    expect(rowState(kid('a', { tempo: 'stalled' }))).toBe('working')
    expect(rowState(kid('a', { state: 'done' }))).toBe('done')
    expect(rowState(kid('a', { live: false }))).toBe('done')
    expect(rowState(null)).toBe('done')
  })
})

describe('parentOf', () => {
  const snap = repo([mission('w', [piece('a', { child: kid('a') }), piece('b', { child: kid('b', { parent_session: 'gone' }) })])], [kid('i', { parent_session: 'p-main' })])

  it('is the worktree holding the cwd of the session that dispatched the child', () => {
    expect(parentOf(snap, 'a', [ROOT, WT, '/code/app-wt-a'])).toBe(WT)
  })
  it('is that cwd itself while no known worktree holds it', () => {
    expect(parentOf(snap, 'a', [ROOT])).toBe(`${WT}/src`)
  })
  it("is the repo's main checkout when that session is gone", () => {
    expect(parentOf(snap, 'b', [ROOT, WT])).toBe(ROOT)
  })
  it('finds children of no wave too, and knows nothing of a child the snapshot does not list', () => {
    expect(parentOf(snap, 'i', [ROOT, WT])).toBe(ROOT)
    expect(parentOf(snap, 'zzz', [ROOT, WT])).toBeNull()
  })
  it('does not take a sibling whose name only starts the same for the holder', () => {
    expect(parentOf(snap, 'a', ['/code/app-wt-par', ROOT])).toBe(`${WT}/src`)
  })
})

describe('wavesOf', () => {
  it("holds only the parent's own waves, and Issues after them", () => {
    const snap = repo(
      [mission('mine', [piece('a', { child: kid('a') })]), mission('theirs', [piece('b', { child: kid('b', { parent_session: 'p-main' }) })])],
      [kid('i1', { name: 'fix-login' }), kid('i2', { parent_session: 'p-main' })],
    )
    const waves = wavesOf(snap, WT, [ROOT, WT], undefined, NOW)
    expect(waves.map((w) => w.feature)).toEqual(['mine', ISSUES])
    expect(waves[1].rows.map((r) => r.piece)).toEqual(['fix-login'])
    expect(wavesOf(snap, ROOT, [ROOT, WT], undefined, NOW).map((w) => w.feature)).toEqual(['theirs', ISSUES])
  })

  it('takes the parent path with or without a trailing slash', () => {
    const snap = repo([mission('mine', [piece('a', { child: kid('a') })])])
    expect(wavesOf(snap, `${WT}/`, [ROOT, WT], undefined, NOW)).toHaveLength(1)
  })

  it('puts the children that need you on top, then those working, then the done', () => {
    const snap = repo([
      mission('w', [
        piece('done', { child: kid('d', { state: 'done' }), pr: pr() }),
        piece('work', { child: kid('k') }),
        piece('ask', { child: kid('q', { tempo: 'blocked' }) }),
        piece('pr-only', { pr: pr({ state: 'MERGED' }) }),
        piece('not-dispatched'),
      ]),
    ])
    const [w] = wavesOf(snap, WT, [ROOT, WT], undefined, NOW)
    expect(w.rows.map((r) => r.piece)).toEqual(['ask', 'work', 'done', 'pr-only'])
    expect([w.needsYou, w.working, w.done, w.finished]).toEqual([1, 1, 2, false])
    expect(w.rows.map((r) => r.key)).toEqual(['q', 'k', 'd', 'piece:feat/w/pr-only'])
  })

  it('shows a wave with nothing running or asking as finished', () => {
    const snap = repo([mission('w', [piece('a', { child: kid('a', { state: 'done' }), pr: pr() })])])
    expect(wavesOf(snap, WT, [ROOT, WT], undefined, NOW)[0].finished).toBe(true)
  })

  it('lists the waves newest first, by when each was first seen, the unknown after', () => {
    const snap = repo(['old', 'mid', 'new', 'unseen-a', 'unseen-b'].map((f) => mission(f, [piece('a', { child: kid(`${f}-a`) })])))
    const born: Record<string, number> = { [waveKey(ROOT, 'old')]: 1, [waveKey(ROOT, 'new')]: 3, [waveKey(ROOT, 'mid')]: 2 }
    const waves = wavesOf(snap, WT, [ROOT, WT], (k) => born[k], NOW)
    // Unknown ones keep the snapshot's order reversed: contracts are dated, the newer sort last.
    expect(waves.map((w) => w.feature)).toEqual(['new', 'mid', 'old', 'unseen-b', 'unseen-a'])
  })

  it('drops a wave whose PRs are all merged or closed and none of whose children runs', () => {
    const gone = mission('gone', [
      piece('a', { child: kid('a', { state: 'done', live: false }), pr: pr({ state: 'MERGED' }) }),
      piece('b', { pr: pr({ state: 'CLOSED' }) }),
    ])
    const open = mission('open', [piece('a', { child: kid('oa', { state: 'done', live: false }), pr: pr({ state: 'MERGED' }) }), piece('b', { pr: pr() })])
    const live = mission('live', [piece('a', { child: kid('la'), pr: pr({ state: 'MERGED' }) })])
    const waves = wavesOf(repo([gone, open, live]), WT, [ROOT, WT], undefined, NOW)
    expect(waves.map((w) => w.feature).sort()).toEqual(['live', 'open'])
  })

  it('keeps a wave whose child ended without a PR, for as long as a finished child shows', () => {
    const stopped = (at: number) => mission('short', [piece('a', { child: kid('a', { state: 'stopped', live: false, updated_at: ago(at) }) })])
    expect(waveStays(stopped(HOUR), NOW)).toBe(true)
    expect(waveStays(stopped(7 * HOUR), NOW)).toBe(false)
  })

  it('keeps an Issues child while it runs, while its PR is open, and for a while after', () => {
    const snap = repo(
      [],
      [
        kid('live'),
        kid('pr', { live: false, state: 'done', updated_at: ago(48 * HOUR), pr: pr() }),
        kid('recent', { live: false, state: 'done', updated_at: ago(HOUR) }),
        kid('old', { live: false, state: 'done', updated_at: ago(48 * HOUR) }),
        kid('merged', { live: false, state: 'done', updated_at: ago(48 * HOUR), pr: pr({ state: 'MERGED' }) }),
      ],
    )
    const [issues] = wavesOf(snap, WT, [ROOT, WT], undefined, NOW)
    expect(issues.issues).toBe(true)
    expect(issues.rows.map((r) => r.key)).toEqual(['live', 'pr', 'recent'])
  })

  it('gives a wave none of whose children is left to the main checkout', () => {
    const orphan = mission('orphan', [piece('a', { pr: pr() })])
    expect(wavesOf(repo([orphan]), ROOT, [ROOT, WT], undefined, NOW).map((w) => w.feature)).toEqual(['orphan'])
    expect(wavesOf(repo([orphan]), WT, [ROOT, WT], undefined, NOW)).toEqual([])
  })
})

describe('waveLines, dispatchTitle, waveOfTarget', () => {
  const snap = repo(
    [
      mission('w1', [piece('a', { child: kid('a', { tempo: 'blocked' }) }), piece('b', { child: kid('b', { tempo: 'blocked' }) }), piece('c', { child: kid('c') })]),
      mission('w2', [piece('a', { child: kid('d', { state: 'done' }), pr: pr() })]),
    ],
    [kid('i')],
  )
  const waves = wavesOf(snap, WT, [ROOT, WT], undefined, NOW)

  it("are the tab's sections as counts, in its order", () => {
    expect(waveLines(waves)).toEqual([
      { feature: 'w2', needsYou: 0, working: 0, done: 1 },
      { feature: 'w1', needsYou: 2, working: 1, done: 0 },
      { feature: ISSUES, needsYou: 0, working: 1, done: 0 },
    ])
  })
  it('carries the alert in the title', () => {
    expect(dispatchTitle(waves)).toBe('Dispatch · 2 need you')
    expect(dispatchTitle(waves.slice(0, 1))).toBe('Dispatch')
    expect(dispatchTitle(wavesOf(repo([mission('w', [piece('a', { child: kid('a', { tempo: 'blocked' }) })])]), WT, [WT], undefined, NOW))).toBe('Dispatch · 1 needs you')
  })
  it('finds the section by a child it holds, or by its feature', () => {
    expect(waveOfTarget(waves, 'c')?.feature).toBe('w1')
    expect(waveOfTarget(waves, 'w2')?.feature).toBe('w2')
    expect(waveOfTarget(waves, ISSUES)?.feature).toBe(ISSUES)
    expect(waveOfTarget(waves, 'nope')).toBeUndefined()
    expect(waveOfTarget(waves, undefined)).toBeUndefined()
  })
})

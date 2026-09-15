import { useMission } from '../mission/app-store'
import { delta } from '../mission/types'
import { openContract, openMissionPane, openPr, ReplyBox } from '../mission/rows'
import type { Need } from './needs'

/** Where a click on a need goes: the child's mission pane, the red PR, the landable contract. */
export function openNeed(n: Need) {
  if (n.kind === 'blocked') openMissionPane(n.child)
  else if (n.kind === 'ci') openPr(n.pr)
  else openContract(n.mission)
}

function Head({ n, showRepo, replied }: { n: Need; showRepo: boolean; replied: boolean }) {
  const looked = useMission((s) => s.looked)
  const d = n.kind === 'blocked' ? delta(n.child, looked) : 0
  const [word, label] =
    n.kind === 'blocked' ? [replied ? 'replied' : 'BLOCKED', n.label] : n.kind === 'ci' ? ['CI ✗', `${n.piece} · PR #${n.pr.number}`] : ['land', `mission ${n.mission.feature}`]
  return (
    <>
      <span className="nd-word">{word}</span>
      <span className="nd-label">{label}</span>
      {showRepo && <span className="nd-repo">{n.repo.name}</span>}
      {d > 0 && <span className="m-delta">+{d}</span>}
    </>
  )
}

/** The needs-you items. `list` (the sidebar) is a column with the reply field under each
 *  blocked child; `strip` (above the canvas) is one row of chips that open the need. */
export default function NeedsList({ needs, variant, showRepo }: { needs: Need[]; variant: 'list' | 'strip'; showRepo: boolean }) {
  const sent = useMission((s) => s.sent)
  return (
    <div className={`needs needs-${variant}`}>
      {needs.map((n) => {
        // A reply shows for a minute while the child has not picked it up yet.
        const replied = n.kind === 'blocked' && Date.now() - (sent[n.child.id]?.at(-1)?.at ?? 0) < 60_000
        const cls = `nd nd-${n.kind}${replied ? ' nd-replied' : ''}`
        if (variant === 'strip')
          return (
            <button key={n.key} className={cls} onClick={() => openNeed(n)} title={n.kind === 'blocked' ? (n.child.needs ?? undefined) : n.repo.root}>
              <Head n={n} showRepo={showRepo} replied={replied} />
            </button>
          )
        return (
          <div key={n.key} className={cls}>
            <div className="nd-row" onClick={() => openNeed(n)} title={n.kind === 'blocked' ? n.child.cwd : n.repo.root}>
              <Head n={n} showRepo={showRepo} replied={replied} />
            </div>
            {n.kind === 'blocked' && <ReplyBox c={n.child} />}
            {n.kind === 'ci' && <div className="nd-sub">{n.pr.head}</div>}
            {n.kind === 'land' && <div className="nd-sub">ready to land · open the contract</div>}
          </div>
        )
      })}
    </div>
  )
}

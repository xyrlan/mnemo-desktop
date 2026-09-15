import { useMission } from '../mission/app-store'
import { delta } from '../mission/types'
import { openContract, openMissionPane, openPr, ReplyBox } from '../mission/rows'
import type { Need } from './needs'

/** Where a click on a need goes: the child's mission pane, the PR, the landable contract. */
export function openNeed(n: Need) {
  if (n.kind === 'blocked') openMissionPane(n.child)
  else if (n.kind === 'ci' || n.kind === 'ready') openPr(n.pr)
  else openContract(n.mission)
}

const HEAD: Record<Need['kind'], string> = { blocked: 'BLOCKED', ci: 'CI ✗', ready: 'merge', land: 'land' }

function Head({ n, showRepo, replied }: { n: Need; showRepo: boolean; replied: boolean }) {
  const looked = useMission((s) => s.looked)
  const d = n.kind === 'blocked' ? delta(n.child, looked) : 0
  const label = n.kind === 'blocked' ? n.label : n.kind === 'land' ? `mission ${n.mission.feature}` : `${n.piece} · PR #${n.pr.number}`
  return (
    <>
      <span className="nd-word">{replied ? 'replied' : HEAD[n.kind]}</span>
      <span className="nd-label">{label}</span>
      {showRepo && <span className="nd-repo">{n.repo.name}</span>}
      {d > 0 && <span className="m-delta">+{d}</span>}
    </>
  )
}

const SUB: Partial<Record<Need['kind'], string>> = { ready: 'CI green · merge it from the cockpit', land: 'ready to land · open the contract' }

/** The needs-you items as the sidebar's narrow column, with the reply field under each
 *  blocked child. The cockpit renders the same needs as its inbox rows. */
export default function NeedsList({ needs, showRepo }: { needs: Need[]; showRepo: boolean }) {
  const sent = useMission((s) => s.sent)
  return (
    <div className="needs needs-list">
      {needs.map((n) => {
        // A reply shows for a minute while the child has not picked it up yet.
        const replied = n.kind === 'blocked' && Date.now() - (sent[n.child.id]?.at(-1)?.at ?? 0) < 60_000
        return (
          <div key={n.key} className={`nd nd-${n.kind}${replied ? ' nd-replied' : ''}`}>
            <div className="nd-row" onClick={() => openNeed(n)} title={n.kind === 'blocked' ? n.child.cwd : n.repo.root}>
              <Head n={n} showRepo={showRepo} replied={replied} />
            </div>
            {n.kind === 'blocked' && <ReplyBox c={n.child} attach />}
            {n.kind === 'ci' && <div className="nd-sub">{n.pr.head}</div>}
            {SUB[n.kind] && <div className="nd-sub">{SUB[n.kind]}</div>}
          </div>
        )
      })}
    </div>
  )
}

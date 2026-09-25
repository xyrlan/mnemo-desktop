import { useMemo } from 'react'
import { Foot, type Parked } from '../conversation/Foot'
import { useFollow } from '../conversation/useFollow'
import { tauriConversation, type ConversationClient } from '../conversation/client'
import { deriveConversation } from '../conversation/parse'
import { pendingCard, type ToolCard } from '../conversation/stream'
import { ChatInputContext, chatInputParts, type ChatInputParts } from '../conversation/chat-input'
import { childAgent, childStatus } from '../mission/agent'
import { ChildComposer, ChildContext, MissionFooter } from '../mission/rows'
import { takeOver } from './run'
import type { ChildSession } from '../mission/types'

/** The chat-input piece's cards, with the child's composer in place of a pane's (as in
 *  `ChildConversation`). */
const PARTS: ChatInputParts = { ...chatInputParts, Composer: ChildComposer }

/** The answer card of a child that needs you, open in its row (spec decision 6): what the foot of
 *  its conversation would show — the approval card, the question card with the dialog's options,
 *  or the composer under the question it asked as it ended its turn, "as me" by default — and the
 *  line under it. The transcript says what it is parked on, so it is followed here too. */
export function RowAnswer({ child, client = tauriConversation }: { child: ChildSession; client?: ConversationClient }) {
  // One agent per child: it reads the child from the latest snapshot when it answers.
  const agent = useMemo(() => childAgent(child), [child.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = childStatus(child)
  // Every poll deserialises a new child: keep the status while what it says is the same.
  const status = useMemo(() => s, [s.busy, s.waiting, s.parked]) // eslint-disable-line react-hooks/exhaustive-deps
  const { segments } = useFollow(client, child.session_id, child.cwd)
  const records = segments.at(-1)?.records
  const current = useMemo(() => (records ? deriveConversation(records) : null), [records])
  const parked = useMemo<Parked>(() => {
    const p = current && pendingCard(current.cards, status.waiting)
    const tool = p && current.cards.find((c): c is ToolCard => c.id === p.id && c.kind === 'tool')
    return p && tool ? { tool, kind: p.kind } : null
  }, [current, status.waiting])
  return (
    <ChildContext.Provider value={child}>
      <ChatInputContext.Provider value={PARTS}>
        <div className="dispatch-answer -mx-1 flex flex-col" data-answer={child.id}>
          <Foot agent={agent} cwd={child.cwd || null} status={status} parked={parked} onOpenTerminal={() => void takeOver(child)} />
          <MissionFooter c={child} parked={parked} />
        </div>
      </ChatInputContext.Provider>
    </ChildContext.Provider>
  )
}

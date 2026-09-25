import { useMemo } from 'react'
import { ConversationView } from '../conversation/ConversationView'
import { ChatInputContext, chatInputParts, type ChatInputParts } from '../conversation/chat-input'
import type { Parked } from '../conversation/Foot'
import type { StatusMarker } from '../conversation/types'
import { childAgent, childStatus } from './agent'
import { ChildComposer, ChildContext, MissionFooter } from './rows'
import type { ChildSession } from './types'

/** The chat-input piece's cards, with the child's composer in place of a pane's. */
const PARTS: ChatInputParts = { ...chatInputParts, Composer: ChildComposer }

/** A dispatched child's conversation, answerable in the app: its transcript, and under it the
 *  card or the composer for whatever it waits on (`childAgent`). The mission pane shows it; the
 *  Dispatch tab's detail can too. */
export function ChildConversation({ child, markers, onOpenTerminal }: { child: ChildSession; markers?: StatusMarker[]; onOpenTerminal?: () => void }) {
  // One agent per child: it reads the child from the latest snapshot when it answers.
  const agent = useMemo(() => childAgent(child), [child.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const s = childStatus(child)
  // Every poll deserialises a new child: keep the status while what it says is the same.
  const status = useMemo(() => s, [s.busy, s.waiting, s.parked]) // eslint-disable-line react-hooks/exhaustive-deps
  const footer = useMemo(() => (parked: Parked) => <MissionFooter c={child} parked={parked} />, [child])
  return (
    <ChildContext.Provider value={child}>
      <ChatInputContext.Provider value={PARTS}>
        <ConversationView sessionId={child.session_id} cwd={child.cwd} status={status} markers={markers} footer={footer} onOpenTerminal={onOpenTerminal} agent={agent} />
      </ChatInputContext.Provider>
    </ChildContext.Provider>
  )
}

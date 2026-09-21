import { useEffect, useRef } from 'react'
import { useMission } from '../mission/app-store'
import { attachChild, ReplyField, sentAt } from '../mission/rows'
import { childWord, type ChildSession, type RepoGroup } from '../mission/types'
import type { Sent } from '../mission/store'
import CardDrawer from './CardDrawer'

/** The drawer slot a child's conversation takes. Keyed by the child, not by its row: a row's key
 *  names its list (`working:…`, `blocked:…`), and a child that blocks mid-conversation moves list
 *  without the conversation closing on you. */
export const chatKey = (id: string) => `chat:${id}`

/** What the drawer is a window onto, in the contract's shape: `mnemo-desktop/103`. */
export const chatTitle = (repo: Pick<RepoGroup, 'name'>, label: string) => `${repo.name}/${label.replace(/^#/, '')}`

// One empty list for every child that has none: a `?? []` inside the selector is a fresh array
// on every read, and useSyncExternalStore re-renders on it until React unmounts the app.
const NONE: Sent[] = []

/** Sending a child a message without a pane: what you already sent it, and the same draft field
 *  the blocked child's question box types into. Not a terminal — `take over` is still that, and
 *  "open in pane" is `take over`, so the drawer is the small end of a path that already exists.
 *  A question or a permission prompt the child is waiting on stays on its card, where it is
 *  answered; this only ever sends. */
export default function ChatDrawer({ child, title, onClose }: { child: ChildSession; title: string; onClose: () => void }) {
  const sent = useMission((s) => s.sent[child.id]) ?? NONE
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [sent.length])
  const word = childWord(child)
  const live = word !== 'done' && word !== 'stopped'
  return (
    <CardDrawer open title={title} onClose={onClose} onPromote={() => attachChild(child.id)}>
      <div className="ck-chat">
        <div className="ck-chat-now" title={child.detail}>
          {word} · {child.detail || 'no activity yet'}
        </div>
        <ol className="ck-chat-log">
          {sent.map((m) => (
            <li key={`${m.at}-${m.text}`} className={`ck-chat-msg${m.asMe ? ' ck-as-me' : ''}`}>
              <span className="ck-chat-at">{sentAt(m.at)}</span>
              <span className="ck-chat-who">{m.asMe ? 'typed as you' : 'sent'}</span>
              <span className="ck-chat-text" title={m.original !== m.text ? `typed: ${m.original}` : undefined}>
                {m.text}
              </span>
            </li>
          ))}
        </ol>
        {sent.length === 0 && <div className="ck-quiet">nothing sent to it yet</div>}
        <div ref={end} />
        {live ? (
          <div className="m-reply ck-chat-reply">
            <ReplyField c={child} rows={3} />
          </div>
        ) : (
          <div className="ck-quiet">the child is {word}: there is no one to send to</div>
        )}
      </div>
    </CardDrawer>
  )
}

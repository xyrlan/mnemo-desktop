import Avatar from '../avatar/Avatar'
import { childWord, type ChildSession } from '../mission/types'
import './cockpit.css'

/** A child row's state as the octopus playing it, in the slot the word pill had. The avatar
 *  is the one visible marker for the state: the word is kept only for screen readers (the
 *  avatar is `aria-hidden`) and as the hover title, so the row never shows the same fact twice. */
/** Big enough to read as an animation: at 16px the scenes were a dot. */
export const MARK_SIZE = 26

export default function ChildMark({ child }: { child: Pick<ChildSession, 'state' | 'tempo' | 'live'> }) {
  const word = childWord(child)
  return (
    <span className={`ck-mark ck-mark-${word.toLowerCase()}`} title={word}>
      <Avatar state={word} size={MARK_SIZE} />
      <span className="ck-sr">{word}</span>
    </span>
  )
}

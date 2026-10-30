/** Speaking a reply of the brain while Claude is still writing it (jarvis-speaker, #503). The loop
 *  makes one speaker per brain message and hands it every piece `jarvis_brain_stream` sends; the
 *  speaker says each sentence once it is whole, through `say`, which turns it into speech
 *  (`forSpeech`) and queues it after what is already queued. A tool call the brain writes after its
 *  words (a JSON line, or its own markup, as `readReply` reads them) is never said. Once the reply
 *  is whole, `rest` is what of its words is still to be said: the loop says that, and ends there.
 *
 *  The seam's speaker says nothing early: the whole reply is said once it is whole, as before. */

export type Speaker = {
  /** The next piece of the reply, as Claude wrote it. */
  push(piece: string): void
  /** The reply is whole, and `words` are its words as `readReply` read them (the call left out):
   *  what of them is still to be said, '' when all of it was. */
  rest(words: string): string
}

export function createSpeaker(say: (sentence: string) => void): Speaker {
  void say
  return { push: () => {}, rest: (words) => words }
}

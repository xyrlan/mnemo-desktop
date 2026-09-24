// adapted from stablyai/orca src/renderer/src/components/diff-comments/diff-comment-zone-mouse-events.ts (MIT, 122b8c25)
export function installDiffCommentZoneMouseDownStopper(target: EventTarget): () => void {
  const stopMouseDownPropagation = (ev: Event): void => ev.stopPropagation()
  target.addEventListener('mousedown', stopMouseDownPropagation)
  return () => target.removeEventListener('mousedown', stopMouseDownPropagation)
}

// adapted from stablyai/orca src/renderer/src/components/right-sidebar/source-control/commit/commit-message-rows.ts (MIT, 122b8c25)

/** How far into a message its lines are counted: a pasted log is not scanned whole. */
export const COMMIT_MESSAGE_ROW_SCAN_CODE_UNITS = 64 * 1024

/** The message box's height: its line count, from 3 up to 12 (past that it scrolls, so a long
 *  message never pushes the buttons out of the dialog). */
export function getCommitMessageTextareaRows(message: string): number {
  return Math.min(12, Math.max(3, countCommitMessageRows(message)))
}

function countCommitMessageRows(message: string): number {
  if (message.length === 0) return 1
  const scanLength = Math.min(message.length, COMMIT_MESSAGE_ROW_SCAN_CODE_UNITS)
  let rows = 1
  for (let index = 0; index < scanLength; index += 1) {
    if (message.charCodeAt(index) !== 10) continue
    rows += 1
    if (rows >= 12) return rows
  }
  return rows
}

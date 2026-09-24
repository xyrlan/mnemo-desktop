/** xterm's CSI params: a number each, or a list of sub-params. */
type Params = (number | number[])[]

/** The size in `CSI 8 ; rows ; cols t` (XTWINOPS "resize the text area"), which opens the screen of
 *  a shell attached again (`src-tauri/src/pty/screen.rs`): the size it was drawn at. `null` for any
 *  other `CSI … t`, or a size that is not one. */
export function resizeRequest(params: Params): { rows: number; cols: number } | null {
  const [op, rows, cols] = params
  if (op !== 8 || typeof rows !== 'number' || typeof cols !== 'number') return null
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1 || rows > 1000 || cols > 1000) return null
  return { rows, cols }
}

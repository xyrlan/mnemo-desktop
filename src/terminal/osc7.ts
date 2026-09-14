/** OSC 7 payload: file://host/path → path (percent-decoded). */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  return m ? decodeURIComponent(m[1]) : null
}

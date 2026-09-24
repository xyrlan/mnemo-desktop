type Ctx = Pick<AudioContext, 'currentTime' | 'destination' | 'createOscillator' | 'createGain' | 'state' | 'resume'>

let ctx: Ctx | null | undefined

/** The app's one audio context, made on first use; `null` where there is no Web Audio. */
function audio(): Ctx | null {
  if (ctx !== undefined) return ctx
  const Make = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext
  ctx = Make ? new Make() : null
  return ctx
}

/** A short, soft two-note chime (E6 then A6, ~0.35 s), synthesized so no audio file ships. */
export function chime(make: () => Ctx | null = audio): void {
  const a = make()
  if (!a) return
  if (a.state === 'suspended') void a.resume().catch(() => {})
  const t0 = a.currentTime
  for (const [freq, start] of [[1318.5, 0], [1760, 0.09]] as const) {
    const osc = a.createOscillator()
    const gain = a.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t0 + start)
    gain.gain.exponentialRampToValueAtTime(0.08, t0 + start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + 0.26)
    osc.connect(gain).connect(a.destination)
    osc.start(t0 + start)
    osc.stop(t0 + start + 0.28)
  }
}

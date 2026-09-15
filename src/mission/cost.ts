/** USD per million tokens, blended input/output guess per model family. A budget
 *  signal, not a bill: `mnemo sessions` reports one token total per child. */
const PER_M: Record<string, number> = { opus: 30, sonnet: 9, haiku: 2.5, fable: 30 }

export function estimateUsd(tokens: number, model: string | null | undefined): number {
  const key = Object.keys(PER_M).find((k) => (model ?? '').toLowerCase().includes(k)) ?? 'opus'
  return (tokens / 1_000_000) * PER_M[key]
}

export function fmtUsd(n: number): string {
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

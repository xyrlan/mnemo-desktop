#!/usr/bin/env node
/** `node scripts/usage-summary.mjs [days]`: how the conversation face was used over the last
 *  `days` (default 7), read from `~/.mnemo-desktop/usage.jsonl` (spec Q8 of
 *  docs/superpowers/specs/2026-09-23-conversation-view-design.md). The rows are written by
 *  `src/conversation/usage.ts`: `{event: 'face', face, session, ts}` on each face change and
 *  `{event: 'beat', face, ts}` each minute the window has focus on a terminal pane. */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The spec's bar: under ~30 % of the time on the conversation face, the composer does not pay. */
export const BAR = 0.3

/** The rows of a usage.jsonl, skipping any line that is not a JSON object. */
export function parseRows(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && typeof r === 'object' && !Array.isArray(r)) rows.push(r)
    } catch {
      // A torn last line (the app was writing) is not worth failing the summary over.
    }
  }
  return rows
}

/** Counts of `rows` stamped at or after `since` (unix seconds). `share` is the conversation
 *  face's part of the beats, null with no beats. */
export function summarize(rows, since) {
  const beats = { terminal: 0, conversation: 0 }
  const toggles = { terminal: 0, conversation: 0, withSession: 0 }
  for (const r of rows) {
    if (typeof r.ts !== 'number' || r.ts < since) continue
    if (r.face !== 'terminal' && r.face !== 'conversation') continue
    if (r.event === 'beat') beats[r.face]++
    else if (r.event === 'face') {
      toggles[r.face]++
      if (r.session) toggles.withSession++
    }
  }
  const total = beats.terminal + beats.conversation
  return { beats, total, share: total ? beats.conversation / total : null, toggles: { ...toggles, total: toggles.terminal + toggles.conversation } }
}

const pct = (x) => `${Math.round(x * 100)}%`

/** What the script prints for `summarize`'s result over `days`. */
export function report(s, days) {
  const out = [`conversation face, last ${days} ${days === 1 ? 'day' : 'days'}`]
  if (!s.total) out.push('  no beats yet: the window never had focus on a terminal pane, or the app is older than round 20')
  else {
    out.push(`  beats: ${s.total} (about ${(s.total / 60).toFixed(1)} h with a terminal pane focused)`)
    out.push(`  conversation face: ${pct(s.share)} (${s.beats.conversation})   terminal face: ${pct(1 - s.share)} (${s.beats.terminal})`)
    out.push(`  ${s.share < BAR ? 'under' : 'at or over'} the spec's ${pct(BAR)} bar`)
  }
  out.push(`  face toggles: ${s.toggles.total} (${s.toggles.conversation} to conversation, ${s.toggles.terminal} to terminal; ${s.toggles.withSession} with a Claude session)`)
  return out.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const days = Number(process.argv[2] ?? 7)
  if (!Number.isFinite(days) || days <= 0) {
    console.error('usage: node scripts/usage-summary.mjs [days]')
    process.exit(2)
  }
  const file = join(homedir(), '.mnemo-desktop', 'usage.jsonl')
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    console.error(`no ${file} yet: the app writes it once a pane's face changes or a minute passes`)
    process.exit(1)
  }
  console.log(report(summarize(parseRows(text), Date.now() / 1000 - days * 86400), days))
}

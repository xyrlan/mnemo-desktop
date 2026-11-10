#!/usr/bin/env node
// Checks the core's session insight against this machine's real transcripts.
//
//     node tools/insight/check.mjs [--n 400] [--dump <file>] [--keep]
//
// It runs the core's own reader over the newest transcripts (the ignored test
// `insight::probe::real_transcripts`, which writes what it read), counts the same bytes of the
// same files with `count.mjs`, and prints where the two differ and what was measured. It exits
// 1 on any difference. README.md beside this file says what each line of the report means.

import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { compare, contextError, countSubagent, countTranscript, subagentRows } from './count.mjs'

const args = process.argv.slice(2)
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const n = Number(option('--n') ?? 400)
const keep = args.includes('--keep')
const given = option('--dump')
const dump = given ?? join(tmpdir(), `mnemo-insight-check-${process.pid}.json`)

/** The complete lines within the first `bytes` bytes of `path`: what the core had read. */
function* linesOf(path, bytes) {
  const buf = Buffer.allocUnsafe(bytes)
  const fd = openSync(path, 'r')
  let got = 0
  try {
    while (got < bytes) {
      const read = readSync(fd, buf, got, bytes - got, got)
      if (read === 0) break
      got += read
    }
  } finally {
    closeSync(fd)
  }
  let start = 0
  for (let end = buf.indexOf(10, start); end !== -1 && end < got; end = buf.indexOf(10, start)) {
    const stop = end > start && buf[end - 1] === 13 ? end - 1 : end
    if (stop > start) yield buf.toString('utf8', start, stop)
    start = end + 1
  }
}

let probeFailed = false
if (!given) {
  const cargo = spawnSync('cargo', ['test', '--lib', 'insight::probe::real_transcripts', '--', '--ignored', '--exact', '--nocapture'], {
    cwd: join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src-tauri'),
    env: { ...process.env, MNEMO_INSIGHT_PROBE_OUT: dump, MNEMO_INSIGHT_PROBE_N: String(n) },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  if (cargo.error) {
    console.error(`cargo did not run: ${cargo.error.message}`)
    process.exit(2)
  }
  probeFailed = cargo.status !== 0
}

let report
try {
  report = JSON.parse(readFileSync(dump, 'utf8'))
} catch (e) {
  console.error(`the core's reading was not written (${e.message}): the probe did not get that far`)
  process.exit(2)
} finally {
  // It names real sessions and paths.
  if (!given && !keep) rmSync(dump, { force: true })
}

const started = Date.now()
const differing = []
const measured = []
const totals = { messages: 0, tokens: 0, subagents: 0, withSubagents: 0, calls: 0, shots: 0, compactions: 0, million: 0 }
for (const row of report.transcripts) {
  const mine = countTranscript(linesOf(row.path, row.bytes))
  const subagents = subagentRows(
    row.subagentFiles.map(f => ({ id: basename(f.path, '.jsonl').replace(/^(agent-)+/, ''), rows: countSubagent(linesOf(f.path, f.bytes)) })),
    mine.ids,
  )
  const diffs = compare(row, mine, subagents)
  if (diffs.length) differing.push({ session: basename(row.path, '.jsonl').slice(0, 8), diffs })
  measured.push(...row.measured)
  const own = row.insight.tokens.own
  totals.messages += row.messages.main + row.messages.sidechain + row.insight.tokens.subagents.reduce((sum, s) => sum + s.calls, 0)
  totals.tokens += own.input + own.output + own.cacheRead + own.cacheCreation
  totals.subagents += row.subagentFiles.length
  totals.withSubagents += row.subagentFiles.length ? 1 : 0
  totals.calls += row.insight.activityTotal
  totals.shots += row.insight.web.shots.length
  totals.compactions += row.insight.context.compactions.length
  totals.million += row.insight.context.window === 1_000_000 ? 1 : 0
}

const count = v => v.toLocaleString('en-US')
const percent = (v, digits) => `${(100 * v).toFixed(digits)}%`
const transcripts = report.transcripts.length
const megabytes = report.bytes / 1e6
const lines = [
  `${transcripts} transcripts, ${megabytes.toFixed(1)} MB, and ${totals.subagents} sub-agent transcripts beside ${totals.withSubagents} of them`,
  `  API messages    ${count(totals.messages)}, ${count(totals.tokens)} tokens with their caches`,
  `  tool calls      ${count(totals.calls)}`,
  `  compactions     ${totals.compactions}; ${totals.million} sessions on the 1M window`,
  `  screenshots     ${totals.shots} listed, ${report.shotsUnreadable.length} not read back by id`,
  `  read in parts   ${report.splitDiffers.length} of ${transcripts} differ from the same bytes read in one go`,
  `  counted again   ${differing.length} of ${transcripts} differ from count.mjs (${((Date.now() - started) / 1000).toFixed(1)} s)`,
]
const error = contextError(measured)
lines.push(
  error
    ? `  context         against Claude Code's own size at ${error.compactions} compactions (${count(error.smallest)} to ${count(error.largest)} tokens): median ${percent(error.median, 2)}, largest ${percent(error.worst, 1)}`
    : '  context         no compaction among them to hold it against',
)
lines.push(
  `  cost            read at ${(megabytes / (report.readMs / 1000)).toFixed(0)} MB/s${report.debug ? ' (a debug build)' : ''}; a poll of the ${report.poll.sessions} newest sessions: ${report.poll.ms.toFixed(2)} ms`,
)
console.log(lines.join('\n'))

for (const { session, diffs } of differing.slice(0, 10)) {
  for (const d of diffs) console.log(`\n${session}… ${d.field}\n  core:  ${JSON.stringify(d.core)?.slice(0, 400)}\n  check: ${JSON.stringify(d.check)?.slice(0, 400)}`)
}
if (differing.length > 10) console.log(`\n…and ${differing.length - 10} more transcripts`)

if (report.unanswered.length) console.log(`\n${report.unanswered.length} of ${report.poll.sessions} sessions asked for by id had no answer`)
const failed = probeFailed || differing.length || report.splitDiffers.length || report.shotsUnreadable.length || report.unanswered.length
console.log(failed ? '\nFAILED: the insight does not match its source' : '\nok: every counter matches')
process.exit(failed ? 1 : 0)

#!/usr/bin/env node
/**
 * Was this build made for other machines, or for the one that compiled it? (#308)
 *
 * whisper.cpp's ggml tunes itself to the build machine unless told not to (`GGML_NATIVE`, on by
 * default). v0.5.0's Windows build came off a runner with AVX-512, ran 512-bit code
 * unconditionally, and closed at launch on every CPU without it. ci.yml and release.yml set
 * `GGML_NATIVE=OFF`; this reads what was actually built, because whisper's build script does
 * not rerun when that variable changes and a cached build directory keeps what it had.
 *
 *   node scripts/portable-build.mjs [<target dir>]    every whisper build and app executable there
 *   node scripts/portable-build.mjs --exe <file>…     only count, in executables from anywhere
 *
 * Two readings, and both must pass:
 *   1. every whisper build under the target was configured with GGML_NATIVE off and with no
 *      instruction set on beyond the baseline voice.rs checks for at run time;
 *   2. the app's executable has at most LIMIT instructions touching a 512-bit register. A
 *      routine that picks AVX-512 at run time has a handful (crc32fast: 26, all there are in
 *      v0.5.0's Linux binary); a C library compiled for an AVX-512 machine has thousands
 *      (10,871 in v0.5.0's Windows one).
 *
 * Run by CI after it builds, and by the release after it uploads: a release is a draft until
 * someone publishes it, and this failing is the reason not to.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export const APP_BIN = 'mnemo-desktop'
/** ggml's x86 instruction-set options a published build may have on: voice.rs's `BASELINE`. */
export const BASELINE = ['SSE42', 'AVX', 'F16C', 'FMA', 'BMI2', 'AVX2']
/** Instructions touching a 512-bit register an executable may have; see the two cases above. */
export const LIMIT = 200

const FALSE = new Set(['OFF', '0', 'NO', 'FALSE', 'N', 'IGNORE', 'NOTFOUND', ''])

/** CMake's reading of a cache value as false. */
export function isOff(value) {
  const v = String(value).trim().toUpperCase()
  return FALSE.has(v) || v.endsWith('-NOTFOUND')
}

/** The `GGML_*` entries of a CMakeCache.txt, by name. */
export function ggmlSettings(cacheText) {
  const out = {}
  for (const m of cacheText.matchAll(/^(GGML_[A-Z0-9_]+):[A-Z]+=(.*)$/gm)) out[m[1]] = m[2].trim()
  return out
}

/** ggml's options that turn an x86 instruction set on. */
const INSTRUCTION_SET = /^GGML_(SSE\d+|AVX\w*|BMI\d*|FMA|F16C|AMX\w*)$/

/** What is wrong with one whisper build's configuration; empty when it is for other machines. */
export function configProblems(settings) {
  const problems = []
  if (!('GGML_NATIVE' in settings)) problems.push('GGML_NATIVE is not in the cache')
  else if (!isOff(settings.GGML_NATIVE)) problems.push(`GGML_NATIVE=${settings.GGML_NATIVE}, so it is tuned to the machine that built it`)
  const beyond = Object.keys(settings)
    .filter((k) => INSTRUCTION_SET.test(k) && !isOff(settings[k]) && !BASELINE.includes(k.slice('GGML_'.length)))
    .sort()
  if (beyond.length) problems.push(`on beyond the baseline: ${beyond.join(', ')}`)
  return problems
}

/** `<target>/release` and `<target>/<triple>/release`, whichever exist. */
function profileDirs(targetDir) {
  if (!existsSync(targetDir)) return []
  const triples = readdirSync(targetDir).sort().map((name) => join(targetDir, name, 'release'))
  return [join(targetDir, 'release'), ...triples].filter(existsSync)
}

/** The CMakeCache.txt of every whisper build under a cargo target dir. */
export function whisperCaches(targetDir) {
  const out = []
  for (const profile of profileDirs(targetDir)) {
    const build = join(profile, 'build')
    if (!existsSync(build)) continue
    for (const name of readdirSync(build).sort()) {
      const cache = join(build, name, 'out/build/CMakeCache.txt')
      if (name.startsWith('whisper-rs-sys-') && existsSync(cache)) out.push(cache)
    }
  }
  return out
}

/** The app's executable in every profile dir that has one. */
export function executables(targetDir) {
  return profileDirs(targetDir)
    .flatMap((dir) => [join(dir, APP_BIN), join(dir, `${APP_BIN}.exe`)])
    .filter(existsSync)
}

/**
 * Counts, over `objdump -d` output fed a line at a time, the instructions that touch a 512-bit
 * register, by the symbol they are in (one unnamed bucket when the file has no symbols, as a
 * Windows executable does not).
 */
export function wideCounter() {
  const bySymbol = new Map()
  let symbol = ''
  let total = 0
  return {
    feed(line) {
      const head = /^[0-9a-f]+ <(.+)>:$/.exec(line)
      if (head) symbol = head[1]
      else if (/\bzmm\d/.test(line)) {
        total += 1
        bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0) + 1)
      }
    },
    result: () => ({ total, bySymbol }),
  }
}

/** The symbols holding the most of them, `count name` each, for the line that explains a failure. */
export function topSymbols(bySymbol, n = 5) {
  return [...bySymbol]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => `${count} ${name || '(no symbol)'}`)
}

/** The first disassembler that runs: LLVM's, then binutils'. Null when there is none. */
export function disassembler(candidates = ['llvm-objdump', 'objdump', 'C:\\Program Files\\LLVM\\bin\\llvm-objdump.exe']) {
  return candidates.find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) ?? null
}

/** Disassembles `file` with `tool` and counts as it streams: the text runs to hundreds of MB. */
export function wideIn(tool, file) {
  return new Promise((resolve, reject) => {
    const counter = wideCounter()
    const child = spawn(tool, ['-d', '--no-show-raw-insn', file], { stdio: ['ignore', 'pipe', 'inherit'] })
    createInterface({ input: child.stdout }).on('line', counter.feed)
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(counter.result()) : reject(new Error(`${tool} exited ${code} on ${file}`))))
  })
}

/** One line per whisper build; true when every one is for other machines. */
export function checkConfig(caches, log = console.log) {
  let ok = true
  for (const cache of caches) {
    const problems = configProblems(ggmlSettings(readFileSync(cache, 'utf8')))
    if (problems.length) ok = false
    log(problems.length ? `${cache}: ${problems.join('; ')}` : `${cache}: GGML_NATIVE off, nothing on beyond ${BASELINE.join(' ')}`)
  }
  return ok
}

/** One line per executable (and the symbols to look at when it fails); true when all pass. */
export async function checkExecutables(files, tool, log = console.log) {
  let ok = true
  for (const file of files) {
    const { total, bySymbol } = await wideIn(tool, file)
    log(`${file}: ${total} instructions touch a 512-bit register (limit ${LIMIT})`)
    if (total > LIMIT) {
      ok = false
      log(`  most of them in: ${topSymbols(bySymbol).join(', ')}`)
    }
  }
  return ok
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const fail = (message) => {
    console.error(message)
    process.exit(1)
  }
  let ok = true
  let files
  if (args[0] === '--exe') {
    files = args.slice(1)
    if (!files.length) fail('--exe needs at least one file')
  } else {
    const root = dirname(dirname(fileURLToPath(import.meta.url)))
    const target =
      args[0] ??
      JSON.parse(
        execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], {
          cwd: root,
          encoding: 'utf8',
        }),
      ).target_directory
    const caches = whisperCaches(target)
    if (!caches.length) fail(`no whisper build under ${target}: run a release build first`)
    ok = checkConfig(caches)
    files = executables(target)
    if (!files.length) fail(`no ${APP_BIN} executable under ${target}: run a release build first`)
  }
  const tool = disassembler()
  if (!tool) fail('no llvm-objdump or objdump to read the executable with')
  if (!(await checkExecutables(files, tool))) ok = false
  if (!ok) process.exit(1)
}

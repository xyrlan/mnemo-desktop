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
 * Three readings, and all must pass:
 *   1. every whisper build under the target was configured with GGML_NATIVE off and with no
 *      instruction set on beyond the baseline voice.rs checks for at run time;
 *   2. the app's executable has at most LIMIT instructions touching a 512-bit register. A
 *      routine that picks AVX-512 at run time has a handful (crc32fast: 26, all there are in
 *      v0.5.0's Linux binary); a C library compiled for an AVX-512 machine has thousands
 *      (10,871 in v0.5.0's Windows one);
 *   3. its 256-bit code is optimized (#312): at most SPILL_LIMIT in a thousand of those
 *      instructions store a register to a stack slot and load it straight back, which is what a
 *      compiler emits for intrinsics when it is not optimizing and all but never otherwise.
 *      cmake-rs replaces MSVC's Release flags with a line that has no /O flag unless they are
 *      already defined, so every Windows release up to v0.5.1 shipped whisper unoptimized:
 *      129.1 in a thousand there, 0.5 in the Linux binary built from the same commit.
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
/** Store-then-reload pairs per thousand 256-bit instructions an executable may have; see above. */
export const SPILL_LIMIT = 10

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

const STACK_SLOT = String.raw`((?:-?0x[0-9a-f]+|-?\d+)?\(%r[sb]p\))`
const STORE = new RegExp(String.raw`\bvmov\w+\s+%ymm\d+,\s*${STACK_SLOT}\s*$`)
const LOAD = new RegExp(String.raw`\bvmov\w+\s+${STACK_SLOT},\s*%ymm\d+`)

/**
 * Counts, over the same output, the 256-bit instructions and how many of them load a register
 * from the stack slot the instruction before stored one to. AT&T syntax, with or without a
 * space after the comma (llvm-objdump's and binutils').
 */
export function spillCounter() {
  let vector = 0
  let spills = 0
  let stored = null
  return {
    feed(line) {
      if (/\bymm\d/.test(line)) vector += 1
      if (stored !== null && LOAD.exec(line)?.[1] === stored) spills += 1
      stored = STORE.exec(line)?.[1] ?? null
    },
    result: () => ({ vector, spills, perThousand: vector ? (1000 * spills) / vector : 0 }),
  }
}

/** The first disassembler that runs: LLVM's, then binutils'. Null when there is none. */
export function disassembler(candidates = ['llvm-objdump', 'objdump', 'C:\\Program Files\\LLVM\\bin\\llvm-objdump.exe']) {
  return candidates.find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) ?? null
}

/** Disassembles `file` with `tool` and counts as it streams: the text runs to hundreds of MB. */
export function readExecutable(tool, file) {
  return new Promise((resolve, reject) => {
    const wide = wideCounter()
    const spill = spillCounter()
    const child = spawn(tool, ['-d', '--no-show-raw-insn', file], { stdio: ['ignore', 'pipe', 'inherit'] })
    createInterface({ input: child.stdout }).on('line', (line) => {
      wide.feed(line)
      spill.feed(line)
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve({ ...wide.result(), ...spill.result() }) : reject(new Error(`${tool} exited ${code} on ${file}`)),
    )
  })
}

/** A cache's C flags for the Release configuration; null when it does not record any. */
export function releaseFlags(cacheText) {
  return /^CMAKE_C_FLAGS_RELEASE:[A-Z]+=(.*)$/m.exec(cacheText)?.[1].trim() ?? null
}

/** One line per whisper build (two with its Release flags); true when every one is for other machines. */
export function checkConfig(caches, log = console.log) {
  let ok = true
  for (const cache of caches) {
    const text = readFileSync(cache, 'utf8')
    const problems = configProblems(ggmlSettings(text))
    if (problems.length) ok = false
    log(problems.length ? `${cache}: ${problems.join('; ')}` : `${cache}: GGML_NATIVE off, nothing on beyond ${BASELINE.join(' ')}`)
    // Not judged here: the executable is. Printed because it is where an unoptimized one comes from.
    const flags = releaseFlags(text)
    if (flags !== null) log(`  CMAKE_C_FLAGS_RELEASE: ${flags || '(empty)'}`)
  }
  return ok
}

/** What is wrong with what `readExecutable` counted; empty when the executable passes. */
export function executableProblems({ total, perThousand }) {
  const problems = []
  if (total > LIMIT) problems.push('512-bit code that runs whatever the CPU is')
  if (perThousand > SPILL_LIMIT) problems.push('256-bit code compiled without optimization')
  return problems
}

/** Two lines per executable, and what failed when something did; true when all pass. */
export async function checkExecutables(files, tool, log = console.log) {
  let ok = true
  for (const file of files) {
    const read = await readExecutable(tool, file)
    log(`${file}: ${read.total} instructions touch a 512-bit register (limit ${LIMIT})`)
    log(
      `  ${read.spills} of its ${read.vector} 256-bit instructions reload what the one before stored: ` +
        `${read.perThousand.toFixed(1)} in a thousand (limit ${SPILL_LIMIT})`,
    )
    const problems = executableProblems(read)
    if (problems.length) {
      ok = false
      log(`  FAILED: ${problems.join('; ')}`)
      if (read.total > LIMIT) log(`  most of the 512-bit ones in: ${topSymbols(read.bySymbol).join(', ')}`)
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

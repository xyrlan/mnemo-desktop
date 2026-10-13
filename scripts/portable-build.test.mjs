import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APP_BIN,
  BASELINE,
  LIMIT,
  SPILL_LIMIT,
  checkConfig,
  configProblems,
  executableProblems,
  executables,
  ggmlSettings,
  isOff,
  releaseFlags,
  spillCounter,
  topSymbols,
  whisperCaches,
  wideCounter,
} from './portable-build.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** A CMakeCache.txt as ggml writes it, with these options on and the rest of the x86 ones off. */
const cache = (native, on = []) =>
  [
    '# This is the CMakeCache file.',
    'CMAKE_BUILD_TYPE:STRING=Release',
    `GGML_NATIVE:BOOL=${native}`,
    '//ADVANCED property for variable: GGML_NATIVE',
    'GGML_NATIVE-ADVANCED:INTERNAL=1',
    ...['SSE42', 'AVX', 'AVX2', 'AVX512', 'AVX512_VBMI', 'AVX_VNNI', 'AMX_TILE', 'BMI2', 'FMA', 'F16C'].map(
      (name) => `GGML_${name}:BOOL=${on.includes(name) ? 'ON' : 'OFF'}`,
    ),
    'GGML_METAL:BOOL=OFF',
    'GGML_OPENMP:UNINITIALIZED=OFF',
  ].join('\n')

const count = (lines) => {
  const c = wideCounter()
  lines.forEach(c.feed)
  return c.result()
}

test('the baseline is the one voice.rs checks the CPU for', () => {
  const rust = readFileSync(join(ROOT, 'src-tauri/src/voice.rs'), 'utf8')
  const list = /pub const BASELINE: \[&str; \d+\] = \[([^\]]+)\]/.exec(rust)[1]
  const features = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1].replace('.', '').toUpperCase())
  expect(features).toEqual(BASELINE)
})

test('both workflows ask for a build that is not tuned to the runner, and both read what came out', () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const yml = readFileSync(join(ROOT, '.github/workflows', name), 'utf8')
    expect(yml, name).toMatch(/^ {2}GGML_NATIVE: 'OFF'$/m)
    expect(yml, name).toMatch(/run: node scripts\/portable-build\.mjs/)
  }
})

test('on Windows both workflows define MSVC’s Release flags before anything is built or restored', () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const yml = readFileSync(join(ROOT, '.github/workflows', name), 'utf8')
    for (const lang of ['C', 'CXX']) expect(yml, name).toContain(`echo "CMAKE_${lang}_FLAGS_RELEASE=/MD /O2 /Ob2 /DNDEBUG" >> "$GITHUB_ENV"`)
    const at = yml.indexOf('CMAKE_C_FLAGS_RELEASE=')
    // Windows only: these are MSVC's flags, and the build script would hand them to gcc and clang too.
    expect(yml.lastIndexOf("if: runner.os == 'Windows'", at), name).toBeGreaterThan(yml.lastIndexOf('- name:', at))
    expect(at, name).toBeLessThan(yml.indexOf('pnpm install'))
    // The cache is keyed on CMAKE_*, because whisper's build script does not rerun when they change.
    if (name === 'ci.yml') {
      expect(at).toBeLessThan(yml.indexOf('swatinem/rust-cache'))
      expect(yml).toMatch(/env-vars: .*\bCMAKE\b/)
    }
  }
})

test('a cache value is off the way CMake reads it', () => {
  for (const v of ['OFF', 'off', '0', 'FALSE', 'NO', 'N', '', 'IGNORE', 'NOTFOUND', 'X-NOTFOUND']) expect(isOff(v), v).toBe(true)
  for (const v of ['ON', '1', 'TRUE', 'YES', 'native']) expect(isOff(v), v).toBe(false)
})

test('the GGML entries of a cache are read by name, whatever their type', () => {
  const s = ggmlSettings(cache('OFF', ['AVX2']))
  expect(s.GGML_NATIVE).toBe('OFF')
  expect(s.GGML_AVX2).toBe('ON')
  expect(s.GGML_OPENMP).toBe('OFF')
  expect(Object.keys(s).some((k) => k.includes('ADVANCED'))).toBe(false)
  expect(s.CMAKE_BUILD_TYPE).toBeUndefined()
})

test('a build tuned to its machine is a problem, whatever else it has on', () => {
  // What every release up to v0.5.0 was configured with.
  expect(configProblems(ggmlSettings(cache('ON')))).toEqual(['GGML_NATIVE=ON, so it is tuned to the machine that built it'])
  expect(configProblems(ggmlSettings('CMAKE_BUILD_TYPE:STRING=Release'))).toEqual(['GGML_NATIVE is not in the cache'])
})

test('with native off, ggml’s own defaults are the baseline and pass', () => {
  expect(configProblems(ggmlSettings(cache('OFF', ['SSE42', 'AVX', 'AVX2', 'BMI2', 'FMA', 'F16C'])))).toEqual([])
  // MSVC has no FMA or F16C option; a cross-compiled build turns every set off.
  expect(configProblems(ggmlSettings(cache('OFF', ['SSE42', 'AVX', 'AVX2', 'BMI2'])))).toEqual([])
  expect(configProblems(ggmlSettings(cache('OFF')))).toEqual([])
})

test('an instruction set beyond the baseline is named, native or not', () => {
  expect(configProblems(ggmlSettings(cache('OFF', ['AVX2', 'AVX512', 'AVX_VNNI'])))).toEqual([
    'on beyond the baseline: GGML_AVX512, GGML_AVX_VNNI',
  ])
  expect(configProblems(ggmlSettings(cache('ON', ['AMX_TILE'])))).toHaveLength(2)
})

test('512-bit instructions are counted by the symbol they are in', () => {
  const { total, bySymbol } = count([
    'Disassembly of section .text:',
    '',
    '0000000000401000 <ggml_vec_dot_f32>:',
    '  401000:       vxorps  %xmm0, %xmm0, %xmm0',
    '  401004:       vmovups %zmm0, 0x100(%rbp)',
    '  40100b:       vmovups 0x100(%rbp), %zmm0',
    '  401012:       vaddps  %ymm1, %ymm2, %ymm3',
    '0000000000402000 <_RNvNtNtCs9_9crc32fast11specialized9pclmulqdq16calculate_avx512>:',
    '  402000:       vpclmulqdq      $0x0, %zmm4, %zmm1, %zmm5',
    '0000000000403000 <main>:',
    '  403000:       callq   0x401000 <ggml_vec_dot_f32>',
  ])
  expect(total).toBe(3)
  expect(bySymbol.get('ggml_vec_dot_f32')).toBe(2)
  expect(topSymbols(bySymbol)).toEqual([
    '2 ggml_vec_dot_f32',
    '1 _RNvNtNtCs9_9crc32fast11specialized9pclmulqdq16calculate_avx512',
  ])
})

test('an executable with no symbols counts into one bucket, Intel syntax included', () => {
  // The instruction v0.5.0 for Windows died on (#308), as llvm-objdump prints it.
  const { total, bySymbol } = count(['140e35322:      vxorps  %xmm0, %xmm0, %xmm0', '140e35326:      vmovups %zmm0, 0x100(%rbp)', ' 1000: vmovups zmmword ptr [rbp + 256], zmm0'])
  expect(total).toBe(2)
  expect(topSymbols(bySymbol)).toEqual(['2 (no symbol)'])
})

test('a register stored to the stack and loaded straight back is counted, in both syntaxes', () => {
  const c = spillCounter()
  ;[
    // llvm-objdump, as MSVC compiled whisper's intrinsics without optimization (#312).
    '140e35326:      vmovups %ymm0, 0x100(%rbp)',
    '140e3532d:      vmovups 0x100(%rbp), %ymm0',
    '140e35334:      vmovups %ymm0, 0x2c0(%rbp)',
    '140e3533b:      leaq    0x300(%rbp), %rax',
    // binutils: no space after the comma.
    '  401000:\tvmovaps %ymm1,-0x40(%rsp)',
    '  401004:\tvmovaps -0x40(%rsp),%ymm2',
    // Another slot, and a register operand: neither is a reload.
    '  401008:\tvmovaps %ymm1,0x20(%rsp)',
    '  40100c:\tvmovaps 0x40(%rsp),%ymm2',
    '  401010:\tvaddps  %ymm1, %ymm2, %ymm3',
  ].forEach(c.feed)
  expect(c.result()).toEqual({ vector: 8, spills: 2, perThousand: 250 })
  expect(spillCounter().result()).toEqual({ vector: 0, spills: 0, perThousand: 0 })
})

test('an executable is judged on both counts, with the published ones on either side of each limit', () => {
  expect(executableProblems({ total: 26, perThousand: 0.5 })).toEqual([]) // v0.5.0 for Linux
  expect(executableProblems({ total: 0, perThousand: 0 })).toEqual([]) // Apple silicon: no such registers
  expect(executableProblems({ total: 26, perThousand: 129.1 })).toEqual(['256-bit code compiled without optimization']) // v0.5.1 for Windows
  expect(executableProblems({ total: 10871, perThousand: 129.1 })).toHaveLength(2) // v0.5.0 for Windows
  expect(0.5).toBeLessThan(SPILL_LIMIT)
  expect(129.1).toBeGreaterThan(SPILL_LIMIT)
})

test('a cache’s Release flags are read for the line that explains a failure', () => {
  expect(releaseFlags('CMAKE_C_FLAGS_RELEASE:STRING=/MD /O2 /Ob2 /DNDEBUG\nCMAKE_CXX_FLAGS_RELEASE:STRING=x')).toBe('/MD /O2 /Ob2 /DNDEBUG')
  // What cmake-rs writes when nothing defined them first: no /O flag at all.
  expect(releaseFlags('CMAKE_C_FLAGS_RELEASE:UNINITIALIZED= -nologo -MD -Brepro')).toBe('-nologo -MD -Brepro')
  expect(releaseFlags(cache('OFF'))).toBeNull()
})

test('the limit sits between a routine picked at run time and a library built for AVX-512', () => {
  expect(26).toBeLessThan(LIMIT) // v0.5.0's Linux binary: crc32fast, nothing else
  expect(10871).toBeGreaterThan(LIMIT) // v0.5.0's Windows executable
})

test('whisper builds and executables are found with and without a target triple', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mnemo-portable-'))
  try {
    expect(whisperCaches(join(dir, 'missing'))).toEqual([])
    const plain = join(dir, 'release/build/whisper-rs-sys-aaaa/out/build')
    const cross = join(dir, 'x86_64-apple-darwin/release/build/whisper-rs-sys-bbbb/out/build')
    for (const d of [plain, cross, join(dir, 'release/build/whisper-rs-sys-cccc'), join(dir, 'release/build/cpal-dddd/out/build'), join(dir, 'debug/build')]) {
      mkdirSync(d, { recursive: true })
    }
    writeFileSync(join(plain, 'CMakeCache.txt'), cache('OFF'))
    writeFileSync(join(cross, 'CMakeCache.txt'), cache('ON'))
    writeFileSync(join(dir, 'release/build/cpal-dddd/out/build/CMakeCache.txt'), cache('ON'))
    expect(whisperCaches(dir)).toEqual([join(plain, 'CMakeCache.txt'), join(cross, 'CMakeCache.txt')])

    writeFileSync(join(dir, 'release', `${APP_BIN}.exe`), '')
    writeFileSync(join(dir, 'x86_64-apple-darwin/release', APP_BIN), '')
    writeFileSync(join(dir, 'release', `${APP_BIN}-mcp`), '')
    expect(executables(dir)).toEqual([join(dir, 'release', `${APP_BIN}.exe`), join(dir, 'x86_64-apple-darwin/release', APP_BIN)])

    const lines = []
    expect(checkConfig(whisperCaches(dir), (l) => lines.push(l))).toBe(false)
    expect(lines[0]).toBe(`${join(plain, 'CMakeCache.txt')}: GGML_NATIVE off, nothing on beyond ${BASELINE.join(' ')}`)
    expect(lines[1]).toContain('GGML_NATIVE=ON')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { behind, kindOf, measure, reached, references } from '../bundle.mjs'
import { clock, cpuShares, engineOf, gpuShare, treeOf } from '../rest.mjs'
import { opening, withOpening } from '../serve.mjs'
import { median, summarize } from '../view-change.mjs'

test('the bundle: sizes in all and by kind, with a dev build’s own file left out', () => {
  const files = [
    { file: 'index.html', bytes: 1000 },
    { file: 'assets/main-a1.js', bytes: 3_000_000 },
    { file: 'assets/main-a1.css', bytes: 200_000 },
    { file: 'assets/boot-b2.webm', bytes: 100_000 },
    { file: 'world.capture.json', bytes: 9_000_000 },
  ]
  const m = measure(files)
  assert.equal(m.total, 3_301_000)
  assert.equal(m.files, 4)
  assert.equal(m.within, true)
  assert.deepEqual(m.leftOut, [{ file: 'world.capture.json', bytes: 9_000_000 }])
  assert.equal(m.byKind.scripts, 3_000_000)
  assert.equal(m.byKind['art (clips and stills)'], 100_000)
  assert.equal(measure([{ file: 'a.js', bytes: 7 * 1024 * 1024 }]).within, false)
  assert.equal(kindOf('assets/x.woff2'), 'fonts')
  assert.equal(kindOf('assets/readme.txt'), 'other')
})

test('the bundle: what the pages reach only through a door is the door’s', () => {
  const files = ['index.html', 'main.js', 'shared.js', 'Editor-1.js', 'ts.worker.js', 'lang.js', 'orphan.js'].map((file) => ({ file, bytes: 10 }))
  const text = { 'index.html': 'main.js', 'main.js': 'shared.js Editor-1.js', 'shared.js': '', 'Editor-1.js': 'ts.worker.js lang.js shared.js', 'ts.worker.js': '', 'lang.js': '', 'orphan.js': '' }
  const refs = references(files, (f) => text[f])
  assert.deepEqual([...reached(files, refs)].sort(), ['Editor-1.js', 'index.html', 'lang.js', 'main.js', 'shared.js', 'ts.worker.js'])
  const b = behind(files, refs, ['Editor-'])
  // the editor, its worker and its language; not what the app reaches without it
  assert.equal(b.files, 3)
  assert.equal(b.bytes, 30)
  assert.deepEqual(b.unreached, ['orphan.js'])
  assert.equal(behind(files, refs, ['nothing-']).bytes, 0)
})

test('at rest: the tree of a process is itself and whatever descends from it', () => {
  const all = [
    { pid: 1, ppid: 0, name: 'app' },
    { pid: 2, ppid: 1, name: 'webview' },
    { pid: 3, ppid: 2, name: 'renderer' },
    { pid: 9, ppid: 0, name: 'the installed app' },
    { pid: 10, ppid: 9, name: 'its webview' },
  ]
  assert.deepEqual(
    treeOf(all, 1).map((p) => p.pid),
    [1, 2, 3],
  )
  assert.deepEqual(
    treeOf(all, 9).map((p) => p.pid),
    [9, 10],
  )
  assert.deepEqual(treeOf(all, 404), [])
})

test('at rest: CPU is each process’s processor time over the wall time, as a share of one core', () => {
  const before = [
    { pid: 1, name: 'app', cpuSeconds: 10 },
    { pid: 2, name: 'renderer', cpuSeconds: 100 },
  ]
  const after = [
    { pid: 1, name: 'app', cpuSeconds: 10.6 },
    { pid: 2, name: 'renderer', cpuSeconds: 103 },
    { pid: 3, name: 'new', cpuSeconds: 5 },
  ]
  const cpu = cpuShares(before, after, 60)
  assert.equal(cpu.rows[0].percent.toFixed(2), '1.00')
  assert.equal(cpu.rows[1].percent.toFixed(2), '5.00')
  // one that started in between counts for nothing it was not seen to use
  assert.equal(cpu.rows[2].percent, 0)
  assert.equal(cpu.total.toFixed(2), '6.00')
  assert.equal(clock('01:02:03'), 3723)
  assert.equal(clock('2-00:00:10.50'), 172810.5)
  assert.equal(clock('00:07'), 7)
})

test('at rest: the GPU share is the busiest engine type over the tree, mean and peak', () => {
  assert.deepEqual(engineOf('pid_1234_luid_0x00000000_0x0000d3c5_phys_0_eng_3_engtype_3D'), { pid: 1234, type: '3D' })
  assert.equal(engineOf('_total'), null)
  const samples = [
    [
      { pid: 1, type: '3D', percent: 2 },
      { pid: 2, type: '3D', percent: 1 },
      { pid: 2, type: 'VideoDecode', percent: 0.5 },
      { pid: 99, type: '3D', percent: 50 },
    ],
    [{ pid: 1, type: '3D', percent: 1 }],
  ]
  const gpu = gpuShare(samples, [1, 2])
  assert.equal(gpu.mean, 2)
  assert.equal(gpu.peak, 3)
  assert.equal(gpu.samples, 2)
  assert.equal(gpuShare([], [1]), null)
})

test('a change of view: the median and the slowest per pair, and whether the slowest is within the budget', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  const s = summarize([
    { from: 'orbit', to: 'console', shown: 40, settled: 360 },
    { from: 'orbit', to: 'console', shown: 60, settled: 380 },
    { from: 'console', to: 'score', shown: 90, settled: 400 },
  ])
  assert.deepEqual(
    s.rows.map((r) => [r.pair, r.n, r.shown.median, r.shown.worst]),
    [
      ['orbit → console', 2, 50, 60],
      ['console → score', 1, 90, 90],
    ],
  )
  assert.equal(s.within, true)
  assert.equal(summarize([{ from: 'a', to: 'b', shown: 101, settled: 400 }]).within, false)
  // a view that never showed is not within anything
  const never = summarize([{ from: 'a', to: 'b', shown: null, settled: null }])
  assert.equal(never.within, false)
  assert.equal(never.rows[0].shown.missed, 1)
})

test('serving the bundle: the page is told where to open before the app runs', () => {
  const line = opening({ world: 'capture', view: 'score', motion: 'full' })
  assert.match(line, /localStorage\.setItem\("mnemo\.world", "capture"\)/)
  assert.match(line, /localStorage\.setItem\("mnemo\.route", "#v=score"\)/)
  assert.match(line, /localStorage\.setItem\("mnemo\.boot", "0"\)/)
  // a live world is the core's: the kept choice of another world goes
  const live = opening({ world: 'live', view: 'orbit', motion: 'reduced' })
  assert.doesNotMatch(live, /setItem\("mnemo\.world"/)
  assert.match(live, /removeItem\('mnemo\.world'\)/)
  assert.equal(withOpening('<html><head><title>x</title></head></html>', '<script>1</script>'), '<html><head><script>1</script><title>x</title></head></html>')
  assert.equal(withOpening('<p>no head</p>', '<script>1</script>'), '<script>1</script><p>no head</p>')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SIZE, parseArgs } from '../shot.mjs'

test('the contract form parses, --size defaulting', () => {
  assert.deepEqual(parseArgs(['--scenario', 'empty-workspace', '--out', 'a.png']).size, DEFAULT_SIZE)
  const o = parseArgs(['--scenario', 'x', '--out', 'out/a.png', '--size', '800x600'])
  assert.equal(o.scenario, 'x')
  assert.equal(o.out, 'out/a.png')
  assert.deepEqual(o.size, { width: 800, height: 600 })
})

test('refuses what it cannot shoot', () => {
  assert.throws(() => parseArgs(['--out', 'a.png']), /--scenario is required/)
  assert.throws(() => parseArgs(['--scenario', 'x']), /--out is required/)
  assert.throws(() => parseArgs(['--scenario', 'x', '--out', 'a.jpg']), /\.png/)
  assert.throws(() => parseArgs(['--scenario', 'x', '--out', 'a.png', '--size', '800']), /<w>x<h>/)
  assert.throws(() => parseArgs(['--scenario', 'x', '--out', 'a.png', '--size', '0x600']), /<w>x<h>/)
  assert.throws(() => parseArgs(['--scenario', '--out', 'a.png']), /--scenario needs a value/)
  assert.throws(() => parseArgs(['--scenario', 'x', '--out', 'a.png', '--nope']), /unknown argument/)
})

test('--list needs nothing else', () => {
  assert.equal(parseArgs(['--list']).list, true)
})

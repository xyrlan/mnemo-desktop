// The shipped scenarios, shot through the repo's real vite and `src/`.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { loadScenarios } from '../scenario.mjs'
import { shoot } from '../shot.mjs'

let dir
before(async () => {
  await loadScenarios()
  dir = await mkdtemp(path.join(tmpdir(), 'preview-shot-'))
})
after(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function pngSize(file) {
  const b = await readFile(file)
  assert.equal(b.subarray(1, 4).toString(), 'PNG')
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

/** What the workbench drew (its shell's columns and slots, tab groups, sidebar, panes, palette),
 *  and the `inert` it put under the Nexus: none of it is in the app since #459. */
const WORKBENCH = '[data-shell], [data-shell-main], [data-shell-column], [data-shell-slot], [data-shell-workbench], [data-tab-groups], [data-tab-group-id], [data-left-sidebar], .pane[data-pane], [data-palette], [inert]'

/** The page's Nexus, drawer and workbench, as a test reads them after the shot. */
const look = (page) =>
  page.evaluate((workbench) => {
    const drawer = document.querySelector('[data-nexus-drawer]')
    return {
      nexus: !!document.querySelector('[data-nexus-view] [data-ship-scene]'),
      workbench: [...document.querySelectorAll(workbench)].map((e) => e.outerHTML.slice(0, 80)),
      drawer: drawer && getComputedStyle(drawer).display !== 'none',
      tabs: [...document.querySelectorAll('[data-drawer-tab]')].map((t) => t.getAttribute('data-drawer-tab')),
      text: drawer?.textContent ?? '',
    }
  }, WORKBENCH)

test('nexus: the Nexus renders with no page error and no workbench element in the DOM', async () => {
  const out = path.join(dir, 'nexus.png')
  const { pageErrors, inspected } = await shoot({ scenario: 'nexus', out, log: () => {}, inspect: look })
  assert.deepEqual(pageErrors, [])
  assert.equal(inspected.nexus, true)
  assert.deepEqual(inspected.workbench, [])
  assert.deepEqual(await pngSize(out), { width: 1440, height: 900 })
})

test('empty-workspace: a fresh boot renders the Nexus, every launch command answered, no page error', async () => {
  const out = path.join(dir, 'nested', 'empty.png')
  const { unanswered, pageErrors, inspected } = await shoot({ scenario: 'empty-workspace', out, size: { width: 1024, height: 640 }, log: () => {}, inspect: look })
  assert.deepEqual(unanswered, [])
  assert.deepEqual(pageErrors, [])
  assert.equal(inspected.nexus, true)
  assert.deepEqual(inspected.workbench, [])
  assert.deepEqual(inspected.tabs, [])
  assert.deepEqual(await pngSize(out), { width: 1024, height: 640 })
})

test('terminal-pane: a saved workspace’s pane comes back as a drawer session, its pty spawned and showing the fixture output', async () => {
  const out = path.join(dir, 'terminal.png')
  const lines = []
  const { unanswered, pageErrors, inspected } = await shoot({ scenario: 'terminal-pane', out, trace: true, log: (l) => lines.push(l), inspect: look })
  assert.deepEqual(unanswered, [])
  assert.deepEqual(pageErrors, [])
  assert.ok(lines.some((l) => l.startsWith('ipc pty_spawn ') && l.includes('__CHANNEL__:')), 'the restored pane spawned a pty with an output channel')
  assert.equal(inspected.nexus, true)
  assert.deepEqual(inspected.workbench, [])
  assert.equal(inspected.drawer, true)
  assert.deepEqual(inspected.tabs, ['session:1'])
  assert.match(inspected.text, /shell · mnemo-desktop/)
  assert.deepEqual(await pngSize(out), { width: 1440, height: 900 })
})

test('an unknown scenario names the ones there are', async () => {
  await assert.rejects(shoot({ scenario: 'nope', out: path.join(dir, 'x.png') }), /no scenario named nope \(have: .*empty-workspace/)
})

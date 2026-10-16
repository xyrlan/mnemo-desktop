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

/** The bridge and the fleet's command line as drawn (#469). */
const bridge = (page) =>
  page.evaluate(() => {
    const box = (e) => {
      if (!e) return null
      const r = e.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }
    }
    const b = document.querySelector('.ship-bridge')
    const line = document.querySelector('[data-fleet-prompt]')
    const input = line?.querySelector('input')
    const lb = box(line)
    const hit = lb && document.elementFromPoint((lb.left + lb.right) / 2, lb.top + 12)
    return {
      bridge: box(b),
      quiet: b.hasAttribute('data-quiet'),
      // A blocked child's own answer is not the prompt.
      inputs: [...b.querySelectorAll('input')].filter((i) => !i.closest('.ship-blocked')).length,
      hint: b.querySelector('.ship-line-hint')?.textContent ?? null,
      line: lb,
      focused: !!input && document.activeElement === input,
      typed: input?.value ?? null,
      verbs: [...document.querySelectorAll('[data-fleet-verbs] [role="option"] code')].map((c) => c.textContent),
      onTop: !!hit && !!line?.contains(hit),
      // The deck's COMMAND column (`.ship-cmd`), and the deck it stands in.
      column: box(document.querySelector('[data-deck] .ship-cmd')),
      deck: box(document.querySelector('[data-deck]')),
    }
  })

test('nexus: the bridge holds no input, only what waits and the `/ commands` hint (#469)', async () => {
  const { pageErrors, inspected: b } = await shoot({ scenario: 'nexus', out: path.join(dir, 'nexus-bridge.png'), log: () => {}, inspect: bridge })
  assert.deepEqual(pageErrors, [])
  assert.equal(b.inputs, 0)
  assert.equal(b.line, null)
  assert.equal(b.quiet, false)
  assert.equal(b.hint, '/ commands')
})

test('empty-workspace: with nothing waiting the bridge is one line (#469)', async () => {
  const { pageErrors, inspected: b } = await shoot({ scenario: 'empty-workspace', out: path.join(dir, 'empty-bridge.png'), size: { width: 1024, height: 640 }, log: () => {}, inspect: bridge })
  assert.deepEqual(pageErrors, [])
  assert.equal(b.quiet, true)
  assert.equal(b.inputs, 0)
  assert.ok(b.bridge.height <= 40, `the quiet bridge is ${b.bridge.height} px tall`)
})

test('nexus-command: `/` opens the command line over the bridge’s top edge, focused, every verb suggested (#469)', async () => {
  const out = path.join(dir, 'nexus-command.png')
  const typing = async (page) => {
    const value = () => page.$eval('[data-fleet-prompt] input', (i) => i.value)
    await page.keyboard.press('Escape')
    // Typed straight after `/`, with no wait: it lands after the `/` the line opens with.
    await page.keyboard.press('/')
    await page.keyboard.type('me')
    const typed = await value()
    await page.keyboard.press('Tab')
    const tab = await value()
    await page.keyboard.press('Enter')
    const out = await page.$eval('[data-fleet-out]', (o) => o.textContent)
    await page.keyboard.press('Escape')
    return { typed, tab, out, closed: !(await page.$('[data-fleet-prompt]')) }
  }
  const { pageErrors, inspected } = await shoot({ scenario: 'nexus-command', out, log: () => {}, inspect: async (page) => ({ b: await bridge(page), keys: await typing(page) }) })
  const { b, keys } = inspected
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(keys, { typed: '/me', tab: '/merge green', out: 'merge 1 green PR: #684 — type /yes within 20 s to confirm', closed: true })
  assert.ok(b.line, 'the line is open')
  assert.equal(b.focused, true)
  assert.equal(b.typed, '/')
  assert.deepEqual(b.verbs, ['/msg all <text>', '/msg <#issue | captain> <text>', '/dispatch <repo> #<issue>', '/new <repo>', '/merge green', '/stop all', '/land <feature>'])
  assert.ok(b.line.top < b.bridge.top && b.bridge.top < b.line.bottom, `the line (${b.line.top}–${b.line.bottom}) floats over the bridge's top edge (${b.bridge.top})`)
  assert.equal(b.onTop, true, 'nothing is drawn over the line')
  assert.equal(b.inputs, 0, 'the line is not inside the bridge')
  // The line's styles are its own: the deck's COMMAND column still stands in its deck.
  assert.ok(b.column.left >= b.deck.left - 0.5 && b.column.top >= b.deck.top - 0.5, 'the COMMAND column is inside its deck')
  assert.deepEqual(await pngSize(out), { width: 1440, height: 900 })
})

/** Every quiet captain's chip that covers a captain's sprite or name, or a docked captain (#465):
 *  `[chip, figure]` pairs, by name. */
const overlaps = (page) =>
  page.evaluate(() => {
    const figures = [...document.querySelectorAll('.ship-captain .ship-console img, .ship-captain .ship-cname, .ship-captain .ship-topic, .ship-captain .ship-pact, .ship-docked')]
    const chips = [...document.querySelectorAll('.ship-chip-captain')]
    const named = (e) => `${e.className} ${(e.closest('[data-ship-id]')?.getAttribute('data-ship-id') ?? '').slice(0, 8)}`
    const out = []
    for (const c of chips) {
      const a = c.getBoundingClientRect()
      for (const f of figures) {
        const b = f.getBoundingClientRect()
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push([named(c), named(f)])
      }
    }
    return { chips: chips.length, captains: document.querySelectorAll('.ship-captain').length, out }
  })

for (const [scenario, size] of [
  ['nexus-quiet', { width: 1440, height: 900 }],
  ['nexus-quiet', { width: 1160, height: 900 }],
  ['nexus', { width: 1440, height: 900 }],
  ['nexus', { width: 1024, height: 768 }],
]) {
  test(`${scenario} at ${size.width}x${size.height}: no quiet captain's chip covers a captain (#465)`, async () => {
    const out = path.join(dir, `${scenario}-${size.width}.png`)
    const { pageErrors, inspected } = await shoot({ scenario, out, size, log: () => {}, inspect: overlaps })
    assert.deepEqual(pageErrors, [])
    assert.ok(inspected.chips > 0 && inspected.captains > 0, `drew ${inspected.chips} chips and ${inspected.captains} captains`)
    assert.deepEqual(inspected.out, [])
  })
}

/** The drawer's header as drawn (#467): its pills (each with its label's box and whether it
 *  overflows it), the `+N` pill, the shown session's line, and any name line inside the panel. */
const header = (page) =>
  page.evaluate(() => {
    const box = (e) => {
      const r = e.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
    }
    const drawn = (e) => e && !e.hasAttribute('data-overflow') && getComputedStyle(e).visibility !== 'hidden'
    const strip = document.querySelector('[data-drawer-head] .dw-pills')
    const pills = [...document.querySelectorAll('[data-drawer-tab]')].map((p) => {
      const label = p.querySelector('[data-drawer-tab-label]')
      return { id: p.getAttribute('data-drawer-tab'), text: p.textContent, drawn: drawn(p), active: p.getAttribute('aria-selected') === 'true', box: box(p), label: box(label), clipped: label.scrollWidth > label.clientWidth }
    })
    const more = document.querySelector('[data-drawer-more]')
    const panel = [...document.querySelectorAll('[data-drawer-panel]')].find((p) => getComputedStyle(p).display !== 'none')
    return {
      heads: document.querySelectorAll('[data-drawer-head]').length,
      lines: [...document.querySelectorAll('[data-drawer-line]')].map(box),
      strip: box(strip),
      pills,
      more: drawn(more) ? { text: more.textContent, box: box(more) } : null,
      panel: panel ? box(panel) : null,
      inPanel: panel ? panel.querySelectorAll('[data-drawer-line], [data-drawer-crumbs], [data-drawer-name], [data-drawer-state]').length : -1,
    }
  })

const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5

/** The guard of #467: one header above the panel, every pill drawn readable and apart, two rows at most. */
function assertOneHeader(h) {
  assert.equal(h.heads, 1)
  assert.equal(h.lines.length, 1, 'the shown session is said once')
  assert.ok(h.panel, 'a panel is shown')
  assert.ok(h.lines[0].bottom <= h.panel.top + 0.5, 'the session line is above the panel')
  assert.equal(h.inPanel, 0, 'no second name line inside the panel')
  const drawn = h.pills.filter((p) => p.drawn)
  const boxes = [...drawn.map((p) => [p.text, p.box]), ...(h.more ? [[h.more.text, h.more.box]] : [])]
  for (const p of drawn) {
    assert.ok(!p.clipped, `${p.text}: its label is cut short`)
    assert.ok(p.label.left >= p.box.left - 0.5 && p.label.right <= p.box.right + 0.5, `${p.text}: its label is wider than its pill`)
  }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i][1], boxes[j][1]), `${boxes[i][0]} overlaps ${boxes[j][0]}`)
  for (const [text, b] of boxes) assert.ok(b.top >= h.strip.top - 0.5 && b.bottom <= h.strip.bottom + 0.5 && b.right <= h.strip.right + 0.5, `${text} is outside the header`)
  assert.ok(new Set(boxes.map(([, b]) => Math.round(b.top))).size <= 2, 'two rows at most')
  assert.ok(drawn.some((p) => p.active), 'the shown session’s pill is drawn')
}

for (const [size, drawer] of [
  [{ width: 1440, height: 900 }, 'wide'],
  [{ width: 1000, height: 760 }, '420 px'],
]) {
  test(`nexus-drawer at ${size.width}x${size.height} (drawer ${drawer}): one header, all seven pills readable (#467)`, async () => {
    const out = path.join(dir, `nexus-drawer-${size.width}.png`)
    const { pageErrors, inspected: h } = await shoot({ scenario: 'nexus-drawer', out, size, log: () => {}, inspect: header })
    assert.deepEqual(pageErrors, [])
    assertOneHeader(h)
    assert.deepEqual(
      h.pills.filter((p) => p.drawn).map((p) => p.text),
      ['#465', '◆ Subscriber', '#471', '$ mnemo-desktop', '● Windows build', '#482', '$ mnemo'],
    )
    assert.equal(h.more, null)
  })
}

test('nexus-drawer at the narrowest drawer (380 px): two rows, then +N, whose menu shows the rest (#467)', async () => {
  const out = path.join(dir, 'nexus-drawer-940.png')
  const { pageErrors, inspected } = await shoot({
    scenario: 'nexus-drawer',
    out,
    size: { width: 940, height: 760 },
    log: () => {},
    inspect: async (page) => {
      const before = await header(page)
      await page.click('[data-drawer-more]')
      const items = await page.$$eval('[data-nx-menu] [role="menuitem"]', (els) => els.map((e) => e.textContent))
      await page.click('[data-nx-menu] [role="menuitem"]')
      return { before, items, after: await header(page) }
    },
  })
  assert.deepEqual(pageErrors, [])
  const { before, items, after } = inspected
  assertOneHeader(before)
  const hidden = before.pills.filter((p) => !p.drawn)
  assert.ok(hidden.length > 0, 'some pills are behind +N')
  assert.equal(before.more?.text, `+${hidden.length}`)
  assert.equal(new Set(before.pills.filter((p) => p.drawn).map((p) => Math.round(p.box.top))).size, 2, 'the pills wrap to two rows')
  assert.equal(items.length, hidden.length)
  // Picked from the menu, a session is shown, and its pill drawn.
  assertOneHeader(after)
  const picked = after.pills.find((p) => p.active)
  assert.equal(picked.id, hidden[0].id)
  assert.ok(picked.drawn)
})

test('an unknown scenario names the ones there are', async () => {
  await assert.rejects(shoot({ scenario: 'nope', out: path.join(dir, 'x.png') }), /no scenario named nope \(have: .*empty-workspace/)
})

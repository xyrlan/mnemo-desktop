// The shipped scenarios, shot through the repo's real vite and `src/`.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { loadScenarios } from '../scenario.mjs'
import { shoot } from '../shot.mjs'
import { STATE_PROPS } from '../scenarios/nexus-states.mjs'
import { DOCKED_POSES } from '../scenarios/nexus-docks.mjs'
import { BRIEFING } from '../scenarios/nexus-briefing.mjs'

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

/** Each robot as drawn (#473): its label, the prop it holds (`data-prop`, and whether its image is
 *  drawn), any old badge, and any text on the figure besides its tag. */
const figures = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.ship-robot')].map((r) => {
      const tag = r.querySelector('.ship-tag')
      const props = [...r.querySelectorAll('.ship-prop')]
      const img = r.querySelector('.ship-prop img')
      return {
        label: tag.textContent.replace(/^\S+\s/, '').trim(),
        props: props.map((p) => p.getAttribute('data-prop')),
        drawn: !!img && img.complete && img.naturalWidth === 24 && img.getBoundingClientRect().width > 0,
        badge: !!r.querySelector('.ship-ab'),
        extra: r.querySelector('.ship-figure').textContent.replace(tag.textContent, '').trim(),
        name: r.querySelector('.ship-figure').getAttribute('aria-label'),
      }
    }),
  )

test('nexus-states: every robot holds its state\'s prop (or none) and wears no badge (#473)', async () => {
  const out = path.join(dir, 'nexus-states.png')
  const { pageErrors, inspected } = await shoot({ scenario: 'nexus-states', out, log: () => {}, inspect: figures })
  assert.deepEqual(pageErrors, [])
  const drawn = Object.fromEntries(inspected.map((f) => [f.label, f]))
  assert.deepEqual(Object.keys(drawn).sort(), Object.keys(STATE_PROPS).sort())
  for (const [label, prop] of Object.entries(STATE_PROPS)) {
    const f = drawn[label]
    assert.deepEqual(f.props, prop ? [prop] : [], `${label}: props`)
    if (prop) assert.ok(f.drawn, `${label}: its ${prop} drawn`)
    assert.equal(f.badge, false, `${label}: no badge`)
    assert.equal(f.extra, '', `${label}: no glyph on the figure`)
    assert.match(f.name, new RegExp(`^${label}, \\w`), `${label}: its name says its state`)
  }
})

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

/** The deck's label row and the dock pod on main before the archive (b287659, 1440 and 1024 wide):
 *  the name's line, 18.19 px, and the pod, 106 px. The archive must not make either taller (#472). */
const MAIN_LABEL_H = 18.1875
const MAIN_POD_H = 106

/** The archives, the label rows and pods they sit in, what flew, and each figure's count once
 *  every packet has landed. */
const memory = async (page) => {
  const drawn = await page.evaluate(() => ({ flying: document.querySelectorAll('.ship-pk').length, coalesced: [...document.querySelectorAll('.ship-pk-n')].map((e) => e.textContent) }))
  await page.waitForFunction(() => !document.querySelector('.ship-pk'), null, { timeout: 10_000 })
  const landed = await page.evaluate(() => {
    const box = (e) => {
      const r = e.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }
    }
    const archive = (a) => ({
      where: a.closest('[data-deck]') ? 'deck' : a.closest('[data-dock]') ? 'dock' : 'other',
      lv: a.querySelector('.ship-lv')?.textContent ?? null,
      tower: box(a.querySelector('.ship-tower img')),
      src: a.querySelector('.ship-tower img').getAttribute('src'),
      leds: a.querySelectorAll('.ship-tower i').length,
    })
    return {
      archives: [...document.querySelectorAll('[data-archive]')].map(archive),
      labels: [...document.querySelectorAll('.ship-dlabel')].map((l) => ({ ...box(l), name: box(l.querySelector('.ship-dname')), captains: [...l.closest('[data-deck]').querySelectorAll('.ship-captain')].map(box) })),
      pods: [...document.querySelectorAll('.ship-pod')].map(box),
      flown: window.__flown,
      sent: window.__pulses.map((p) => p.kind),
      rules: Object.fromEntries([...document.querySelectorAll('[data-rules]')].map((e) => [e.closest('[data-ship-id]').getAttribute('data-ship-id').slice(0, 8), +e.getAttribute('data-rules')])),
    }
  })
  return { drawn, ...landed }
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test(`nexus-memory at ${size.width}x${size.height}: the archive on the deck and the dock, every kind's packet flown, the label row no taller than on main (#472)`, async () => {
    const out = path.join(dir, `nexus-memory-${size.width}.png`)
    const { pageErrors, inspected: m } = await shoot({ scenario: 'nexus-memory', out, size, log: () => {}, inspect: memory })
    assert.deepEqual(pageErrors, [])
    // The tower and its own project's level (#478), on the deck and in the dock pod.
    assert.deepEqual(m.archives.map((a) => [a.where, a.lv, a.leds, a.tower.height]), [
      ['deck', 'LV7', 5, 24],
      ['dock', 'LV2', 5, 24],
    ])
    for (const a of m.archives) assert.match(a.src, /archive/)
    // The guard: the label row as tall as on main, the tower beside the name and above the captains.
    for (const l of m.labels) {
      assert.ok(l.height <= MAIN_LABEL_H + 0.01, `the deck label row grew: ${l.height} px`)
      const tower = m.archives.find((a) => a.where === 'deck').tower
      assert.ok(tower.left >= l.name.right, 'the tower comes after the name')
      for (const c of l.captains) assert.ok(tower.bottom <= c.top + 0.5, 'the tower stays above the captains')
    }
    for (const p of m.pods) assert.ok(p.height <= MAIN_POD_H + 0.01, `the dock pod grew: ${p.height} px`)
    // Packets were in the air at the shot, one ×2; every kind that flies flew, learned did not.
    assert.ok(m.drawn.flying > 0)
    assert.deepEqual(m.drawn.coalesced, ['×2'])
    for (const k of ['catchup', 'friction', 'briefing', 'enrich', 'tool', 'enforce', 'reflex']) assert.ok(m.flown.includes(k), `no ${k} packet flew`)
    assert.ok(!m.flown.includes('learned'))
    assert.ok(m.sent.includes('learned'))
    // Landed: the enrichment and both reflexes on #682 (one of them joined), the read on #690·a,
    // the reflex on the docked captain.
    assert.deepEqual(m.rules, { d0000001: 3, d0000007: 2, cccccccc: 1 })
  })
}

test('nexus-levels: each deck shows its own project\'s level, a project with nothing on record LV0 (#478)', async () => {
  const out = path.join(dir, 'nexus-levels-1440.png')
  const { pageErrors, inspected } = await shoot({
    scenario: 'nexus-levels',
    out,
    size: { width: 1440, height: 900 },
    log: () => {},
    inspect: async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.ship-lv').length === 3, null, { timeout: 10_000 })
      return page.evaluate(() =>
        [...document.querySelectorAll('[data-archive]')].map((a) => [a.closest('[data-deck]') ? 'deck' : 'dock', a.getAttribute('data-archive-name'), a.querySelector('.ship-lv').textContent]),
      )
    },
  })
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(inspected, [
    ['deck', 'mnemo', 'LV2'],
    ['deck', 'mnemo-desktop', 'LV7'],
    ['dock', 'site', 'LV0'],
  ])
})

test('nexus-briefing: the child whose briefing mnemo writes scans it, and no captain stands for the helper', async () => {
  const out = path.join(dir, 'nexus-briefing.png')
  const { pageErrors, inspected } = await shoot({
    scenario: 'nexus-briefing',
    out,
    log: () => {},
    inspect: async (page) => ({
      robots: await figures(page),
      captains: await page.evaluate(() => document.querySelectorAll('.ship-captain, .ship-chip-captain, .ship-docked').length),
      act: await page.evaluate(() => [...document.querySelectorAll('.ship-bubble')].map((b) => b.textContent).join('\n')),
    }),
  })
  assert.deepEqual(pageErrors, [])
  assert.equal(inspected.captains, 1)
  const drawn = Object.fromEntries(inspected.robots.map((f) => [f.label, f]))
  assert.deepEqual(drawn[BRIEFING.writing].props, ['read'])
  assert.ok(drawn[BRIEFING.writing].drawn)
  assert.match(drawn[BRIEFING.writing].name, /writing its briefing$/)
  for (const label of BRIEFING.not) assert.doesNotMatch(drawn[label].name, /briefing/, label)
  assert.match(inspected.act, /✎ writing its briefing/)
})

test('nexus-docks: the docks at full strength, a parent idle over an hour asleep under a zZ', async () => {
  const out = path.join(dir, 'nexus-docks-1440.png')
  const { pageErrors, inspected } = await shoot({
    scenario: 'nexus-docks',
    out,
    size: { width: 1440, height: 900 },
    log: () => {},
    inspect: async (page) => {
      await page.waitForFunction((n) => document.querySelectorAll('.ship-docked').length === n, Object.keys(DOCKED_POSES).length, { timeout: 10_000 })
      return page.evaluate(() => {
        const docks = getComputedStyle(document.querySelector('.ship-docks'))
        return {
          docks: [docks.opacity, docks.filter],
          docked: [...document.querySelectorAll('.ship-docked')].map((d) => ({
            id: d.getAttribute('data-ship-id'),
            pose: d.getAttribute('data-pose'),
            zz: !!d.querySelector('.ship-fx[data-fx="zz"]'),
            sprite: d.querySelector('img').getAttribute('src').match(/captain-(\w+)/)?.[1],
            still: d.title.split('\n').at(-1),
          })),
        }
      })
    },
  })
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(inspected.docks, ['1', 'none'])
  assert.deepEqual(Object.fromEntries(inspected.docked.map((d) => [d.id, d.pose])), DOCKED_POSES)
  for (const d of inspected.docked) {
    assert.equal(d.zz, d.pose === 'asleep', d.id)
    assert.equal(d.sprite, d.pose, d.id)
  }
  assert.deepEqual(inspected.docked.filter((d) => d.pose === 'asleep' || d.pose === 'idle').map((d) => d.still).sort(), ['asleep for 26 h', 'asleep for 3 h', 'idle for 6 min'])
})

test('an unknown scenario names the ones there are', async () => {
  await assert.rejects(shoot({ scenario: 'nope', out: path.join(dir, 'x.png') }), /no scenario named nope \(have: .*empty-workspace/)
})

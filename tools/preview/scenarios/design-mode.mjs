// Design Mode in a browser pane: a worktree with a Claude session in a terminal on the left and
// a browser pane on the right. The palette's `browser.design-mode` turns it on, the page answers
// that the "Save changes" button was clicked, and the pane's card shows the pick with its
// screenshot, ready for a note to the session.
//
// Headless Chromium has no native child webview, so the page area itself stays empty; the
// screenshot the card shows is the fake page drawn below.
import { deflateSync, crc32 } from 'node:zlib'
import { scenario } from '../scenario.mjs'
import { appIpc, REPO } from '../fixtures/app.mjs'
import { TERMINAL_OUTPUT } from '../fixtures/terminal-output.mjs'

const SESSION = 'b7e1c2d4-0f3a-4c11-9e2d-5a6b7c8d9e0f'
const VIEWPORT = { width: 700, height: 600 }
const SCALE = 2
/** Where the picked button sits on the page, in CSS pixels. */
const BUTTON = { x: 40, y: 120, width: 132, height: 36 }

/** A PNG of the page as a retina WKWebView would snapshot it: a light page, a white card, and
 *  the blue "Save changes" button inside it. */
function pagePng() {
  const w = VIEWPORT.width * SCALE
  const h = VIEWPORT.height * SCALE
  const inRect = (x, y, r) => x >= r.x * SCALE && x < (r.x + r.width) * SCALE && y >= r.y * SCALE && y < (r.y + r.height) * SCALE
  const card = { x: 24, y: 24, width: 652, height: 160 }
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b] = inRect(x, y, BUTTON) ? [37, 99, 235] : inRect(x, y, card) ? [255, 255, 255] : [243, 244, 246]
      raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}

/** What Orca's grab script builds for the button (`src/browser/grab-guest.ts`). */
const PICKED = {
  picked: {
    page: { sanitizedUrl: 'http://localhost:3000/settings', title: 'Settings', viewportWidth: VIEWPORT.width, viewportHeight: VIEWPORT.height, devicePixelRatio: SCALE },
    target: {
      tagName: 'button',
      selector: 'form.settings > button.btn-primary',
      elementPath: 'main > form.settings > .btn-primary',
      cssClasses: 'btn btn-primary',
      textSnippet: 'Save changes',
      htmlSnippet: '<button type="submit" class="btn btn-primary">Save changes</button>',
      accessibility: { role: 'button', accessibleName: 'Save changes' },
      reactComponents: '<SettingsForm>',
      rectViewport: BUTTON,
      computedStyles: { display: 'inline-flex', backgroundColor: 'rgb(37, 99, 235)', color: 'rgb(255, 255, 255)', borderRadius: '6px', fontSize: '14px', padding: '8px 16px' },
    },
    nearbyText: ['Notifications', 'Email me when a run finishes'],
  },
}

let takes = 0

scenario('design-mode', {
  ipc: appIpc({
    home_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: Date.now(), pinned: true, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    // `claude agents`: the session in the terminal is at work.
    mission_snapshot: {
      repos: [{ root: REPO, name: 'mnemo-desktop', parents: [{ session_id: SESSION, pid: 4242, name: 'settings page polish', status: 'busy', cwd: REPO }], missions: [], children: [] }],
      errors: [],
      at: '2026-09-24T12:00:00Z',
    },
    mission_looked: {},
    worktree_list: [{ path: REPO, branch: 'refs/heads/main', head: 'abc123', isMain: true, dispatched: false, dirty: false, setupJob: null }],
    workspace_read: {
      version: 2,
      activeWorktree: REPO,
      worktrees: [
        {
          path: REPO,
          tabs: [{ id: 'tab-1', root: { kind: 'split', dir: 'row', ratio: 0.42, children: [{ kind: 'leaf', pane: 1 }, { kind: 'leaf', pane: 2 }] }, focused: 2 }],
          panes: { 1: { view: 'terminal', cwd: REPO, sessionId: SESSION }, 2: { view: 'browser', props: { url: 'http://localhost:3000/settings' } } },
          activeTab: 'tab-1',
        },
      ],
    },
    workspace_live_sessions: [SESSION],
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => void onOutput.sendBytes(TERMINAL_OUTPUT), 50)
      return 1
    },
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    pty_list: [],
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'main',
    browser_create: null,
    browser_set_bounds: null,
    browser_data_store: 'persistent',
    // The overlay is armed, then the second look finds the button picked.
    mcp_browser_eval: ({ script }) => {
      if (!script.includes('grab.take')) return 'true'
      return JSON.stringify(++takes < 2 ? { armed: true } : PICKED)
    },
    mcp_browser_snapshot: () => ({ mime: 'image/png', data: pagePng() }),
    browser_save_shot: ({ id }) => `/var/folders/preview/T/mnemo-desktop-design/browser-n${Math.abs(id)}-1727190000000.png`,
  }),
  events: [{ event: 'app://action', payload: { id: 'browser.design-mode' }, afterMs: 1500 }],
})

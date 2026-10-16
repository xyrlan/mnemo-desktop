// mnemo's memory on the `nexus` ship (#472): each deck's and dock's archive tower with its own
// project's level beside it (#478), and one `mnemo://pulse` of each kind, so packets are in the air at the shot:
// a briefing at boot, a reflex (twice to one child, so ×2), an MCP read's round trip, an
// enrichment (no session: the file's worktree names the child), enforcement's guard, a friction
// note and a briefing going in, a reflex to the docked captain, and the vault learning a rule.
// Synthetic data. `drive` fires them, once the ship is drawn; `window.__pulses` is the list.
import { getScenario, scenario } from '../scenario.mjs'
import { REPO } from '../fixtures/app.mjs'
import './nexus.mjs'

// The `nexus` scenario's sessions: its children by number, its captains by id.
const child = (n) => `d${String(n).padStart(7, '0')}-4444-4000-8000-00000000000${n % 10}`
const ROUND = 'aaaaaaaa-1111-4000-8000-000000000001'
const DOCKED = 'cccccccc-3333-4000-8000-000000000003'

const ev = (kind, over) => ({ at: Date.now(), kind, project: 'mnemo-desktop', agent: 'mnemo-desktop', slugs: [], ...over })
export const PULSES = [
  ev('catchup', { session_id: child(9), tool: 'session_start.inject', hits: 1 }),
  ev('learned', { slugs: ['shell-group-says-what-a-pane-runs'], hits: 1 }),
  ev('friction', { session_id: ROUND, hits: 1 }),
  ev('briefing', { session_id: child(3), hits: 1 }),
  ev('enrich', { tool: 'Edit', slugs: ['deletion-pieces-need-git-rm'], hits: 1, file_path: `${REPO}-wt-682-1/review.py` }),
  ev('tool', { session_id: child(7), tool: 'list_rules_by_topic', slugs: ['one-session-per-working-tree', 'grep-is-a-proxy-run-the-function'], hits: 2 }),
  ev('enforce', { session_id: child(2), tool: 'git push --force', slugs: ['never-force-push-main'], hits: 1 }),
  ev('reflex', { session_id: child(1), slugs: ['merge-requires-admin'], hits: 1 }),
  ev('reflex', { session_id: child(1), slugs: ['prove-the-result-first'], hits: 1 }),
  ev('reflex', { session_id: DOCKED, project: 'mnemo', agent: 'mnemo', slugs: ['worktree-tests-need-pythonpath-src'], hits: 1 }),
]

export const LEVELS = {
  'mnemo-desktop': { pages: 300, rules_fired: 60, fires: 120 },
  mnemo: { pages: 120, rules_fired: 20, fires: 35 },
}

scenario('nexus-memory', {
  ipc: (cmd, args) => {
    // A vault with some history: level 49 (`levelOf(xpOf(…))`).
    if (cmd === 'vault_level') return { root: '/Users/preview/mnemo', pages: 2413, rules_fired: 386, fires: 576, fired_recent: 320, dormant: 646, label_only: 0, inbox: 195, error: null }
    // Each project's own: mnemo-desktop level 7 (300 + 5·60 + 120 xp), mnemo level 2 (255 xp).
    if (cmd === 'vault_project_levels') return { root: '/Users/preview/mnemo', projects: LEVELS, error: null }
    return getScenario('nexus').ipc(cmd, args)
  },
  drive: async (page) => {
    await page.waitForSelector('[data-archive]')
    await page.evaluate(async (pulses) => {
      window.__pulses = pulses
      // What flew, as it flew, for the tests to read after the shot.
      window.__flown = []
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.matches('.ship-pk')) window.__flown.push(n.getAttribute('data-packet'))
      }).observe(document.querySelector('.ship-memory'), { childList: true })
      for (const p of pulses) {
        window.__previewEmit('mnemo://pulse', { ...p, at: Date.now() })
        await new Promise((r) => setTimeout(r, 90))
      }
    }, PULSES)
  },
})

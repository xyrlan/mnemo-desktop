// A dispatched child's session, open as the only tab: its head (state, branch, model, cost, take
// over, stop), what the vault gave it, and its conversation in the chat, with the footer for
// what it is doing. Three screens, one per footer:
//
// - `mission-session`: parked on a permission prompt — the approval card;
// - `mission-session-question`: asking a question — the question, its suggested reply, the composer;
// - `mission-session-working`: at work — the composer, sending as a message.
//
// The composer and the approval card are the chat-input piece's (`src/chat-input/`): before it
// lands, the pane shows its old reply box in their place.
import { readFileSync } from 'node:fs'
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const ID = 'a43d3832'
const SESSION = '5c2f9e1a-7b44-4d0e-9a13-2e6f8c1d0b77'
const WT = `${HOME}/code/mnemo-desktop-wt-c-checks`
// A real child transcript, scrubbed (src/conversation/fixtures/README.md).
const TRANSCRIPT = readFileSync(new URL('../../../src/conversation/fixtures/bg-child.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean)
const NOW = Date.now()

const child = (over) => ({
  id: ID,
  session_id: SESSION,
  name: 'checks',
  state: 'working',
  tempo: 'active',
  needs: null,
  detail: 'writing the checks panel',
  suggested_reply: null,
  cwd: WT,
  tokens: 412_380,
  live: true,
  updated_at: new Date(NOW - 60_000).toISOString(),
  intent: 'the right sidebar Checks tab',
  branch: 'feat/orca-redesign-e/checks',
  timeline_len: 3,
  parent_session: null,
  waiting_for: null,
  model: 'opus[1m]',
  effort: 'xhigh',
  ...over,
})

const snapshot = (c) => ({
  repos: [
    {
      root: REPO,
      name: 'mnemo-desktop',
      parents: [],
      missions: [{ feature: 'orca-redesign-e', contract_path: `${REPO}/docs/superpowers/contracts/2026-09-24-orca-redesign-e.md`, landable: false, pieces: [{ name: 'checks', branch: c.branch, child: c, pr: null }] }],
      children: [],
    },
  ],
  errors: [],
  at: new Date(NOW).toISOString(),
})

const line = (minutesAgo, state, detail) => ({ at: new Date(NOW - minutesAgo * 60_000).toISOString(), state, detail, text: '' })

function sessionIpc(c, timeline) {
  return appIpc({
    workspace_read: {
      version: 1,
      tabs: [{ id: 'tab-1', root: { kind: 'leaf', pane: 1 }, focused: 1 }],
      panes: { 1: { view: 'mission', props: { id: ID }, title: c.name } },
      activeTab: 'tab-1',
    },
    mission_snapshot: snapshot(c),
    mission_looked: { [ID]: c.timeline_len },
    mission_timeline: { lines: timeline, total: timeline.length },
    mission_mark_looked: null,
    gh_auth: { installed: true, logged: true, login: 'preview', scopes: ['repo'] },
    child_memory: {
      briefing: { path: 'bots/mnemo-desktop/briefings/sessions/f96089d4.md', at: NOW - 3 * 3600_000 },
      injected: [
        { slug: 'glob-import-a-sibling-piece-not-yet-landed', at: NOW - 40 * 60_000 },
        { slug: 'new-ui-inside-app-needs-data-ui', at: NOW - 25 * 60_000 },
        { slug: 'new-ui-inside-app-needs-data-ui', at: NOW - 9 * 60_000 },
      ],
      friction: [{ rule_text: 'Poll gh only while the tab is open.', contradicts: ['checks-poll-every-minute'], injected_in_session: [], at: NOW - 12 * 60_000 }],
      mcp_reads: ['merge-green-prs-myself'],
    },
    conversation_follow: ({ onEvent }) => {
      setTimeout(() => onEvent.send({ kind: 'lines', start: 0, end: TRANSCRIPT.join('\n').length + 1, lines: TRANSCRIPT }), 50)
      return 1
    },
    conversation_unfollow: null,
    usage_log: null,
  })
}

scenario('mission-session', {
  ipc: sessionIpc(child({ tempo: 'blocked', needs: 'approve Bash: gh pr checks 241 --json name,state,link \\\n  | jq \'.[] | select(.state == "FAILURE")\'', waiting_for: 'permission prompt' }), [
    line(40, 'working', 'reading the vendored checks panel'),
    line(2, 'blocked', 'permission prompt'),
  ]),
})

scenario('mission-session-question', {
  ipc: sessionIpc(child({ tempo: 'blocked', needs: 'The contract says Fix starts an agent when the worktree has none. Start it in a new tab, or split beside the checks?', suggested_reply: 'a new tab' }), [
    line(40, 'working', 'reading the vendored checks panel'),
    line(3, 'blocked', 'asked where Fix starts an agent'),
  ]),
})

scenario('mission-session-working', {
  ipc: sessionIpc(child({}), [line(40, 'working', 'reading the vendored checks panel')]),
})

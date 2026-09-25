// A dispatched child's session, open as the only tab: its head (state, branch, model, cost, take
// over, stop), what the vault gave it, and its conversation in the chat, with the footer for
// what it is doing. One screen per kind of block, each answered in the chat (`childAgent`):
//
// - `mission-session`: parked on a permission prompt — the approval card, "don't ask again" under it;
// - `mission-session-ask`: parked on the multiple-choice dialog — the question card and its options;
// - `mission-session-question`: asked as it ended its turn — the question, its suggested reply, the
//   composer, sending as you;
// - `mission-session-working`: at work — the composer, sending as you.
import { readFileSync } from 'node:fs'
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const ID = 'a43d3832'
const SESSION = '5c2f9e1a-7b44-4d0e-9a13-2e6f8c1d0b77'
const WT = `${HOME}/code/mnemo-desktop-wt-c-checks`
// A real child transcript, scrubbed (src/conversation/fixtures/README.md).
const TRANSCRIPT = readFileSync(new URL('../../../src/conversation/fixtures/bg-child.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean)
const NOW = Date.now()

/** The transcript with one more call the child is parked on: no result has come back for it. */
function parkedOn(name, input) {
  const last = JSON.parse(TRANSCRIPT.findLast((l) => JSON.parse(l).uuid))
  const record = {
    parentUuid: last.uuid,
    isSidechain: false,
    type: 'assistant',
    uuid: `preview-${name}`,
    timestamp: new Date(NOW - 60_000).toISOString(),
    sessionId: last.sessionId,
    message: { role: 'assistant', type: 'message', content: [{ type: 'tool_use', id: `toolu_preview_${name}`, name, input }], stop_reason: 'tool_use' },
  }
  return [...TRANSCRIPT, JSON.stringify(record)]
}

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

function sessionIpc(c, timeline, transcript = TRANSCRIPT) {
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
      setTimeout(() => onEvent.send({ kind: 'lines', start: 0, end: transcript.join('\n').length + 1, lines: transcript }), 50)
      return 1
    },
    conversation_unfollow: null,
    usage_log: null,
  })
}

const CHECKS = 'gh pr checks 241 --json name,state,link \\\n  | jq \'.[] | select(.state == "FAILURE")\''
scenario('mission-session', {
  ipc: sessionIpc(
    child({ tempo: 'blocked', needs: `approve Bash: ${CHECKS}`, waiting_for: 'permission prompt' }),
    [line(40, 'working', 'reading the vendored checks panel'), line(2, 'blocked', 'permission prompt')],
    parkedOn('Bash', { command: CHECKS, description: 'List the failing checks of PR 241' }),
  ),
})

scenario('mission-session-ask', {
  ipc: sessionIpc(
    child({ tempo: 'blocked', needs: 'Where does Fix start an agent when the worktree has none?', waiting_for: 'input needed' }),
    [line(40, 'working', 'reading the vendored checks panel'), line(1, 'blocked', 'input needed')],
    parkedOn('AskUserQuestion', {
      questions: [
        {
          question: 'Where does Fix start an agent when the worktree has none?',
          header: 'Fix',
          multiSelect: false,
          options: [
            { label: 'A new tab', description: 'Its own tab, focused, like ⌘T' },
            { label: 'Split beside the checks', description: 'Keeps the failing check in view' },
            { label: 'Ask each time', description: 'A menu on the Fix button' },
          ],
        },
      ],
    }),
  ),
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

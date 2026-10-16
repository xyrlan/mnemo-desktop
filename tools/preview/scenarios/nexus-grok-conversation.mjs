// A Grok Build session running outside the app (#492): its captain sits on a dock, and a click
// opens it in the drawer read-only, its conversation read from `chat_history.jsonl` in its own
// Grok home. `conversation_follow` answers a Grok history only when asked for it with the row's
// kind and home; asked as a Claude transcript (what the drawer asked before #492), it has none,
// and the view would wait for it. Synthetic records in grok 1.0.60's shapes
// (`src/conversation/parse-grok.test.ts`).
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const GROK = '0199f1a2-6b3c-7d4e-8f50-61728394a5b6'
const GROK_HOME = `${HOME}/.grok-work`
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()

const MISSION = {
  repos: [
    {
      root: REPO,
      name: 'mnemo-desktop',
      parents: [
        { session_id: GROK, pid: null, name: 'Tidy the release notes', status: 'idle', cwd: REPO, waiting_for: null, account: 'grok-work', account_env: { config_dir: GROK_HOME, kind: 'grok' } },
      ],
      missions: [],
      children: [],
    },
  ],
  errors: [],
  at: iso(now),
}

const FEED = {
  sessions: { [GROK]: { activity: null, said: null, context: 48_000, model: 'grok-4.7', topic: 'tidy the release notes', title: 'Tidy the release notes', contract: null, ask: null } },
  prs: {},
  rate: null,
  at: now,
}

const NOTES = `${REPO}/docs/RELEASE.md`
const HISTORY = [
  { type: 'system', content: 'You are Grok 4.7 released by xAI.' },
  { type: 'user', content: [{ type: 'text', text: '<user_query>\nTidy docs/RELEASE.md: one line per change, newest first. Reply DONE.\n</user_query>' }], prompt_index: 0 },
  { type: 'assistant', content: "I'll read the notes first.", tool_calls: [{ id: 'call-1', name: 'read_file', arguments: JSON.stringify({ target_file: NOTES }) }], model_id: 'grok-4.7' },
  { type: 'tool_result', tool_call_id: 'call-1', content: '1→## 0.4.1\n2→- fixed the drawer\n3→## 0.4.2\n4→- grok accounts\n' },
  { type: 'assistant', content: '', tool_calls: [{ id: 'call-2', name: 'search_replace', arguments: JSON.stringify({ file_path: NOTES, old_string: '## 0.4.1', new_string: '## 0.4.2\n- grok accounts\n## 0.4.1' }) }], model_id: 'grok-4.7' },
  { type: 'tool_result', tool_call_id: 'call-2', content: `The file ${NOTES} has been updated successfully.` },
  { type: 'assistant', content: 'The notes now read newest first, one line per change.\n\nDONE', model_id: 'grok-4.7' },
].map((r) => JSON.stringify(r))

/** What the core sends: the history from its Grok home, or nothing for a Claude transcript. */
function follow({ kind, home, onEvent }) {
  setTimeout(() => onEvent.send(kind === 'grok' && home === GROK_HOME ? { kind: 'lines', start: 0, end: 4096, lines: HISTORY } : { kind: 'missing' }), 50)
  return 1
}

scenario('nexus-grok-conversation', {
  ipc: appIpc({
    mission_snapshot: MISSION,
    nexus_feed: () => FEED,
    mission_looked: {},
    mission_timeline: { lines: [], total: 0 },
    worktree_list: () => [],
    worktree_diff_files: ({ worktree }) => ({ root: worktree, files: [], truncated: false }),
    conversation_follow: follow,
    conversation_unfollow: null,
    conversation_earlier: () => ({ start: 0, end: 0, lines: [] }),
  }),
  drive: async (page) => {
    await page.locator(`.ship-docked[data-ship-id="${GROK}"]`).click()
  },
})

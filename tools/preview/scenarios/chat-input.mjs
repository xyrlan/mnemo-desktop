// The chat's input parts, three terminal panes on their conversation face: one session idle
// (the composer), one parked on a Bash permission (the approval card), one on an AskUserQuestion
// (the question card). Which part a face shows is chat-view's call (src/conversation/); this
// scenario gives it the three states that call the chat-input parts up.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const WT = `${REPO}-wt-chat-input`
const IDLE = '5c0e7a11-0000-4000-8000-0000000000c1'
const ASKS_PERMISSION = '5c0e7a11-0000-4000-8000-0000000000c2'
const ASKS_QUESTION = '5c0e7a11-0000-4000-8000-0000000000c3'
const at = Date.parse('2026-09-24T12:00:00Z')

let seq = 0
const line = (sessionId, type, message) =>
  JSON.stringify({
    type,
    uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    parentUuid: null,
    isSidechain: false,
    sessionId,
    cwd: WT,
    timestamp: new Date(at + seq * 4000).toISOString(),
    message,
  })
const user = (sessionId, text) => line(sessionId, 'user', { role: 'user', content: text })
const assistant = (sessionId, content) => line(sessionId, 'assistant', { role: 'assistant', model: 'claude-opus-5-5', content })
const text = (t) => ({ type: 'text', text: t })
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input })

const TRANSCRIPTS = {
  [IDLE]: [
    user(IDLE, 'Why does the composer keep the draft after a failed send?'),
    assistant(IDLE, [
      text(
        'So nothing typed is lost: `onSend` rejects when the pane stopped running Claude, and the composer shows why and keeps the draft to send again. Only a send that resolved empties it.',
      ),
    ]),
  ],
  [ASKS_PERMISSION]: [
    user(ASKS_PERMISSION, 'Clean the build output and rebuild.'),
    assistant(ASKS_PERMISSION, [
      text('I will clear `dist/` first.'),
      toolUse('toolu_perm_1', 'Bash', { command: 'rm -rf dist && pnpm build', description: 'Remove the old build output and rebuild' }),
    ]),
  ],
  [ASKS_QUESTION]: [
    user(ASKS_QUESTION, 'Pick an accent for the approval card.'),
    assistant(ASKS_QUESTION, [
      toolUse('toolu_ask_1', 'AskUserQuestion', {
        questions: [
          {
            question: 'Which accent should the approval card use?',
            header: 'Accent',
            multiSelect: false,
            options: [
              { label: 'Primary', description: 'The theme accent, as Orca does' },
              { label: 'Amber', description: 'Warm, reads as caution' },
              { label: 'Neutral', description: 'No accent at all' },
            ],
          },
        ],
      }),
    ]),
  ],
}

// `@` reads the worktree's files through `git ls-files` (a `job_run`); its lines are answered
// every half second, so a composer that asks at any point finds them.
const FILES = [
  'README.md',
  'package.json',
  'src/chat-input/Composer.tsx',
  'src/chat-input/ApprovalCard.tsx',
  'src/chat-input/QuestionCard.tsx',
  'src/chat-input/pty.ts',
  'src/conversation/ConversationView.tsx',
  'src/conversation/cards/tool.tsx',
  'src/ui/command.tsx',
  'tools/preview/scenarios/chat-input.mjs',
]
const read = (id, lines, afterMs) => [
  ...lines.map((line) => ({ event: 'job-line', payload: { id, stream: 'out', line }, afterMs })),
  { event: 'job-exit', payload: { id, code: 0 }, afterMs },
]
const files = []
for (let ms = 1000; ms <= 6000; ms += 500) files.push(...read(`explorer-files:${WT}`, FILES, ms))

const parent = (session_id, name, status, waiting_for = null) => ({ session_id, pid: 4242, name, status, cwd: WT, waiting_for })

let ptys = 0

scenario('chat-input', {
  ipc: appIpc({
    home_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          last_at: at,
          pinned: true,
          hidden: false,
          unresolved: false,
          sessions: [IDLE, ASKS_PERMISSION, ASKS_QUESTION].map((id, i) => ({ id, title: ['Composer drafts', 'Rebuild', 'Accent'][i], cwd: WT, last_at: at, transcript: true, live: 'here', kind: 'interactive', agent: null })),
          children: [],
        },
      ],
      clone_base: '/Users/preview/code',
      errors: [],
      protected: 0,
    },
    worktree_list: ({ repo }) =>
      repo === REPO
        ? [
            { path: REPO, branch: 'main', head: 'a'.repeat(40), isMain: true, dispatched: false, dirty: false, setupJob: null },
            { path: WT, branch: 'feat/orca-redesign-e/chat-input', head: 'b'.repeat(40), isMain: false, dispatched: false, dirty: true, setupJob: null },
          ]
        : [],
    // `claude agents`: idle, parked on a permission, parked on a question.
    mission_snapshot: {
      repos: [
        {
          root: REPO,
          name: 'mnemo-desktop',
          parents: [parent(IDLE, 'Composer drafts', 'idle'), parent(ASKS_PERMISSION, 'Rebuild', 'waiting', 'permission prompt'), parent(ASKS_QUESTION, 'Accent', 'waiting', 'input needed')],
          missions: [],
          children: [],
        },
      ],
      errors: [],
      at: '2026-09-24T12:00:00Z',
    },
    mission_looked: {},
    workspace_read: {
      version: 2,
      activeWorktree: WT,
      worktrees: [
        {
          path: WT,
          tabs: [
            {
              id: 'tab-1',
              root: {
                kind: 'split',
                dir: 'row',
                ratio: 0.34,
                children: [{ kind: 'leaf', pane: 1 }, { kind: 'split', dir: 'row', ratio: 0.5, children: [{ kind: 'leaf', pane: 2 }, { kind: 'leaf', pane: 3 }] }],
              },
              focused: 1,
            },
          ],
          panes: {
            1: { view: 'terminal', cwd: WT, sessionId: IDLE, face: 'conversation' },
            2: { view: 'terminal', cwd: WT, sessionId: ASKS_PERMISSION, face: 'conversation' },
            3: { view: 'terminal', cwd: WT, sessionId: ASKS_QUESTION, face: 'conversation' },
          },
          activeTab: 'tab-1',
        },
      ],
    },
    workspace_live_sessions: [IDLE, ASKS_PERMISSION, ASKS_QUESTION],
    pty_spawn: () => ++ptys,
    pty_write: null,
    pty_resize: null,
    pty_kill: null,
    pty_pid: 4242,
    pty_list: [],
    conversation_follow: ({ sessionId, onEvent }) => {
      const lines = TRANSCRIPTS[sessionId] ?? []
      setTimeout(() => void onEvent.send({ kind: 'lines', start: 0, end: lines.join('\n').length + 1, lines }), 50)
      return Object.keys(TRANSCRIPTS).indexOf(sessionId) + 1
    },
    conversation_unfollow: null,
    usage_log: null,
    chrome_claude_running: true,
    chrome_repo: 'mnemo-desktop',
    chrome_branch: 'feat/orca-redesign-e/chat-input',
    chrome_session: null,
    memory_feed: { project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] },
    // What `/` and `@` read: the home folder (`homeDir()`), the worktree's commands and skills.
    'plugin:path|resolve_directory': HOME,
    fs_list: ({ dir }) => {
      if (dir === `${WT}/.claude/commands`) return [{ name: 'ship.md', is_dir: false }]
      if (dir === `${WT}/.claude/skills`) return [{ name: 'review-pr', is_dir: true }]
      throw `${dir}: No such file or directory (os error 2)`
    },
    job_run: null,
    fs_read: ({ path }) => {
      if (path.endsWith('ship.md')) return '---\ndescription: Push the branch and open its PR\nargument-hint: [title]\n---\n'
      if (path.endsWith('review-pr/SKILL.md')) return '---\nname: review-pr\ndescription: Review a pull request the house way\n---\n'
      throw `${path}: No such file or directory (os error 2)`
    },
  }),
  events: files,
})

// What mnemo learned, as a first run opens it (`src/nexus/boot/first-run.ts`): the Nexus's window
// at the consent, for a repo with Claude Code history and no decision yet. The first run waits out
// the launch's first burst (3 s, `after-startup.ts`): the shot is held past it.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const ipc = (extra = {}) =>
  appIpc({
    home_snapshot: () => ({
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 1790000000, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    }),
    install_review_project: () => ({ project: 'mnemo-desktop', root: REPO }),
    install_review_decided: () => null,
    worktree_list: [],
    install_review_step: ({ step }) =>
      step === 'dry-run'
        ? { stdout: JSON.stringify({ project: 'mnemo-desktop', sessions: 38, calls_estimate: 16, api_price_estimate_usd: 1.1 }), stderr: '', code: 0 }
        : { stdout: JSON.stringify({ project: 'mnemo-desktop', origin: 'backfill', pages: [] }), stderr: '', code: 0 },
    ...extra,
  })

/** Nothing listens: it only holds the shot until the first run has opened its window. */
const HOLD = { event: 'preview://hold', payload: null, afterMs: 3600 }

scenario('learned', { ipc: ipc(), events: [HOLD] })

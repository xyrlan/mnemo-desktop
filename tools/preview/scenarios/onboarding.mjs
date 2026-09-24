// Onboarding, the dialog a first run opens: at setup with Claude Code and mnemo missing, and at
// the "what mnemo learned" consent for a repo with Claude Code history and no decision yet.
import { scenario } from '../scenario.mjs'
import { appIpc, HOME, REPO } from '../fixtures/app.mjs'

const tool = (name, path, version) => ({ name, path, version, managed: false })

scenario('onboarding', {
  ipc: appIpc({
    tools_status: () => [
      tool('git', '/usr/bin/git', 'git version 2.50.1'),
      tool('claude', null, null),
      tool('mnemo', null, null),
      tool('gh', '/opt/homebrew/bin/gh', 'gh version 2.80.0'),
    ],
  }),
})

scenario('onboarding-consent', {
  ipc: appIpc({
    home_snapshot: () => ({
      repos: [{ root: REPO, name: 'mnemo-desktop', last_at: 1790000000, pinned: false, hidden: false, unresolved: false, sessions: [], children: [] }],
      clone_base: `${HOME}/code`,
      errors: [],
      protected: 0,
    }),
    install_review_project: () => ({ project: 'mnemo-desktop', root: REPO }),
    install_review_decided: () => null,
    install_review_step: ({ step }) =>
      step === 'dry-run'
        ? { stdout: JSON.stringify({ project: 'mnemo-desktop', sessions: 38, calls_estimate: 16, api_price_estimate_usd: 1.1 }), stderr: '', code: 0 }
        : { stdout: JSON.stringify({ project: 'mnemo-desktop', origin: 'backfill', pages: [] }), stderr: '', code: 0 },
  }),
})

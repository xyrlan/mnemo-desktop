// What the Rust side says at launch when nothing is going on: no saved workspace, no
// sessions, every tool installed, an empty vault. Scenarios start from this and override the
// commands their screen is about, so a scenario reads as "what is different here".

export const HOME = '/Users/preview'
export const REPO = `${HOME}/code/mnemo-desktop`

const tool = (name, version) => ({ name, path: `/opt/homebrew/bin/${name}`, version, managed: false })

/** Each entry answers one command; a function gets the command's args. */
export const BASE = {
  settings_read: () => ({}),
  settings_write: () => null,
  tools_status: () => [tool('git', 'git version 2.50.1'), tool('claude', '2.4.0 (Claude Code)'), tool('mnemo', 'mnemo 0.9.0'), tool('gh', 'gh version 2.80.0')],
  mcp_socket_path: () => `${HOME}/.mnemo-desktop/mcp.sock`,
  pulse_start: () => null,
  vault_level_best: ({ xp }) => xp,
  vault_level: () => ({
    root: `${HOME}/mnemo`,
    pages: 0,
    rules_fired: 0,
    fires: 0,
    fired_recent: 0,
    dormant: 0,
    label_only: 0,
    inbox: 0,
    error: null,
  }),
  mission_looked: () => null,
  mission_snapshot: () => ({ repos: [], errors: [], at: '2026-09-24T12:00:00Z' }),
  app_build_info: () => ({ version: '0.2.0', sha: 'preview', built_at: 'unknown' }),
  workspace_read: () => ({}),
  workspace_write: () => null,
  home_snapshot: () => ({ repos: [], clone_base: `${HOME}/code`, errors: [], protected: 0 }),
  home_refresh_github: () => null,
  // A pane's chrome: outside any repo, no Claude Code session in it.
  chrome_repo: () => null,
  chrome_branch: () => null,
  chrome_session: () => null,
  // No terminal sessions survive from an earlier run; the Memory panel has nothing for the project.
  pty_list: () => [],
  memory_feed: () => ({ project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] }),
  // No project to offer "what mnemo learned" for, so that screen never opens by itself.
  install_review_project: () => null,
}

/**
 * An `ipc` for `scenario()`: `overrides` first, then {@link BASE}. An override is a function of
 * the command's args, or a plain value returned as is. A command neither knows answers
 * `undefined`, which the page receives as `null` and `shot.mjs` lists after the shot.
 */
export function appIpc(overrides = {}) {
  return (cmd, args) => {
    const answer = Object.hasOwn(overrides, cmd) ? overrides[cmd] : BASE[cmd]
    return typeof answer === 'function' ? answer(args) : answer
  }
}

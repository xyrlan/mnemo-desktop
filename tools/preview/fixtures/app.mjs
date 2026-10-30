// What the Rust side says at launch when nothing is going on: no saved workspace, no
// sessions, every tool installed, an empty vault. Scenarios start from this and override the
// commands their screen is about, so a scenario reads as "what is different here".

export const HOME = '/Users/preview'
export const REPO = `${HOME}/code/mnemo-desktop`

const tool = (name, version) => ({ name, path: `/opt/homebrew/bin/${name}`, version, managed: false })

/** Each entry answers one command; a function gets the command's args. */
export const BASE = {
  // No settings file yet: the defaults.
  settings_read: () => ({}),
  settings_write: () => null,
  // A first run with no saved dictation language sets the one the system's languages suggest (#357).
  voice_set_language: () => null,
  tools_status: () => [tool('git', 'git version 2.50.1'), tool('claude', '2.4.0 (Claude Code)'), tool('mnemo', 'mnemo 0.9.0'), tool('gh', 'gh version 2.80.0')],
  // The desktop MCP served, as on macOS (`Serving`, src/mcp/serving.ts).
  mcp_socket_path: () => ({ socket: `${HOME}/.mnemo-desktop/mcp.sock`, unavailable: null }),
  pulse_start: () => null,
  vault_level_best: ({ xp }) => xp,
  // Each project's level (#478): none on record, every deck LV0; the best offered is the best.
  vault_project_levels: () => ({ root: `${HOME}/mnemo`, projects: {}, error: null }),
  vault_project_levels_best: ({ xp }) => xp,
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
  // Nothing newer on GitHub: no release toast over the shots (#366).
  app_newer_release: () => null,
  workspace_read: () => ({}),
  workspace_write: () => null,
  home_snapshot: () => ({ repos: [], clone_base: `${HOME}/code`, errors: [], protected: 0 }),
  home_refresh_github: () => null,
  // No Claude Code session in any terminal.
  chrome_session: () => null,
  // James's orb (#506): on, as with no `voice.orb` in jarvis.json; nothing is going on, so it stays down.
  jarvis_orb_enabled: () => true,
  // No terminal sessions survive from an earlier run; the Memory panel has nothing for the project.
  pty_list: () => [],
  memory_feed: () => ({ project: 'mnemo-desktop', briefing: null, fired: [], learned: [], inbox: [] }),
  // One Claude account, the default, with no plan usage read yet.
  accounts_list: () => ({ active: 'default', accounts: [{ id: 'default', label: 'Default', configDir: `${HOME}/.claude`, isDefault: true, email: null, problem: null, unshared: [] }] }),
  accounts_panes: () => ({}),
  plan_usage: () => ({ limits: [], plan: null, fetchedAt: Date.now(), stale: null }),
  // No project to offer "what mnemo learned" for, so that screen never opens by itself.
  install_review_project: () => null,
  // Nexus v2: its feed (empty fleet) and the usage rows it writes while shown.
  nexus_feed: () => ({ sessions: {}, prs: {}, rate: null, at: Date.now() }),
  usage_log: () => null,
  // James's brain (#503): the local model, as with no `brain` in jarvis.json.
  jarvis_brain: () => ({ kind: 'local' }),
  // A search of the web (jarvis-research), at either speed: one made-up answer and its source.
  jarvis_research: ({ question, deep }) => ({
    summary: deep ? 'Pesquisei com calma: há duas opções boas.' : 'Achei a resposta.',
    details: `O que a web diz sobre «${question}», em detalhe.`,
    sources: [{ title: 'Example', url: 'https://example.com/' }],
  }),
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

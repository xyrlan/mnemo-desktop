/** What the setup screen knows about the four programs the app runs, and how each OS installs
 *  the ones a click opens a terminal for. Pure, so every OS's route is a unit test on any OS. */

export type ToolName = 'git' | 'gh' | 'claude' | 'mnemo'

/** One row of `tools_status`: `path` is the executable found on the app's PATH (null when
 *  missing), `version` the first line of its `--version`, `managed` true when the app installed it. */
export type ToolStatus = { name: ToolName; path: string | null; version: string | null; managed: boolean }

/** The order the setup screen lists them in. */
export const TOOLS: ToolName[] = ['git', 'claude', 'mnemo', 'gh']

/** What each one is for, as the setup screens say it. */
export const WHAT: Record<ToolName, string> = {
  git: 'worktrees, branches and diffs',
  claude: 'Claude Code, which runs every session',
  mnemo: 'rules, briefings and dispatch',
  gh: 'issues and pull requests on GitHub',
}

/** Without these two the app does nothing useful: either missing opens setup at launch. */
export const ESSENTIAL: ToolName[] = ['claude', 'mnemo']

export type Os = 'mac' | 'windows' | 'linux'

/** `navigator.platform` is `MacIntel` in WKWebView, `Win32` in WebView2 and `Linux x86_64` in
 *  WebKitGTK. Anything else is taken for a Mac, the platform the app was first built on. */
export function osOf(platform: string): Os {
  if (/^win/i.test(platform)) return 'windows'
  if (/linux|bsd|x11/i.test(platform)) return 'linux'
  return 'mac'
}

export const currentOs = (): Os => osOf(typeof navigator === 'undefined' ? '' : navigator.platform)

export const found = (rows: ToolStatus[], name: ToolName) => rows.find((r) => r.name === name)?.path ?? null

/** `1.10.0` from `mnemo 1.10.0` (`--version`'s first line) or from `v1.10.0` (a release tag):
 *  the last X.Y.Z it ends with, as numbers. Null for anything else, a prerelease suffix included. */
function numbers(s: string): [number, number, number] | null {
  const m = /(?:^|[\sv])(\d+)\.(\d+)\.(\d+)$/.exec(s.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Whether release `tag` is later than the installed mnemo (its `--version` line). A version
 *  either side cannot read is not newer: Setup offers nothing rather than something wrong. The
 *  same rule as the app's own release check (`src-tauri/src/newer_release.rs`, `newer`). */
export function newerMnemo(installed: string | null, tag: string | null): boolean {
  const [i, t] = [installed && numbers(installed), tag && numbers(tag)]
  if (!i || !t) return false
  const d = t.findIndex((n, k) => n !== i[k])
  return d >= 0 && t[d] > i[d]
}

/** The mnemo found is the one the app installed: the only one Setup ever offers to update. */
export const managedMnemo = (rows: ToolStatus[] | null) => !!rows?.some((r) => r.name === 'mnemo' && r.path && r.managed)

/** What an Update button does, said beside it on both setup screens. */
export const UPDATE_HINT =
  "downloads it into the app's own folder, checks it, swaps it in whole, then refreshes mnemo's hooks; the mnemo you have stays if anything fails before the swap"

/** Setup opens by itself when `claude` or `mnemo` is missing; a row `tools_status` left out
 *  counts as missing. */
export const needsSetup = (rows: ToolStatus[]) => ESSENTIAL.some((n) => !found(rows, n))

/** `command` is typed into a new terminal tab; `shows` is the short form a label prints. */
export type Route = { command: string; shows: string }

const same = (command: string): Route => ({ command, shows: command })

/** Linux has no one package manager: `sh -c` picks the first one present, so the line works
 *  whatever the user's own shell is. */
function linuxPackage(pkg: { apt: string; dnf: string; pacman: string; zypper: string }, docs: string): Route {
  const tries = [
    ['apt-get', `sudo apt-get install -y ${pkg.apt}`],
    ['dnf', `sudo dnf install -y ${pkg.dnf}`],
    ['pacman', `sudo pacman -S --noconfirm ${pkg.pacman}`],
    ['zypper', `sudo zypper install -y ${pkg.zypper}`],
  ]
  const chain = tries.map(([bin, run], i) => `${i ? 'elif' : 'if'} command -v ${bin} >/dev/null; then ${run}`).join('; ')
  return {
    command: `sh -c '${chain}; else echo "no apt-get, dnf, pacman or zypper here: see ${docs}"; fi'`,
    shows: `sudo apt-get install ${pkg.apt} (or dnf, pacman, zypper)`,
  }
}

/** Claude Code's native installer (code.claude.com/docs/en/setup), then `claude` itself, which
 *  asks the user to log in on its first run. It is started by its absolute path: the tab's PATH
 *  was set before the installer put anything in `~/.local/bin`. A pane's shell on Windows is
 *  `cmd.exe` (`COMSPEC`), so Windows gets the CMD form. */
function claudeRoute(os: Os): Route {
  if (os === 'windows') {
    const install = 'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd'
    return { command: `${install} && "%USERPROFILE%\\.local\\bin\\claude.exe"`, shows: install }
  }
  const install = 'curl -fsSL https://claude.ai/install.sh | bash'
  return { command: `${install} && ~/.local/bin/claude`, shows: install }
}

/** How this OS installs a tool from a terminal. `mnemo` has none: the app installs it itself
 *  (`tools_install_mnemo`). `brew` exists only on a Mac. */
export function installRoute(tool: Exclude<ToolName, 'mnemo'>, os: Os): Route {
  switch (tool) {
    case 'claude':
      return claudeRoute(os)
    case 'git':
      if (os === 'mac') return same('xcode-select --install')
      if (os === 'windows') return same('winget install --id Git.Git -e --source winget')
      return linuxPackage({ apt: 'git', dnf: 'git', pacman: 'git', zypper: 'git' }, 'https://git-scm.com/downloads/linux')
    case 'gh':
      if (os === 'mac') return same('brew install gh')
      if (os === 'windows') return same('winget install --id GitHub.cli -e --source winget')
      return linuxPackage({ apt: 'gh', dnf: 'gh', pacman: 'github-cli', zypper: 'gh' }, 'https://github.com/cli/cli#installation')
  }
}

import { installRoute, needsSetup, osOf, type ToolName, type ToolStatus } from './tools'

const row = (name: ToolName, path: string | null = `/bin/${name}`): ToolStatus => ({ name, path, version: path && `${name} 1.0`, managed: false })
const all = (missing: ToolName[] = []) => (['git', 'gh', 'claude', 'mnemo'] as ToolName[]).map((n) => row(n, missing.includes(n) ? null : `/bin/${n}`))

test('osOf reads each webview’s navigator.platform, and takes the unknown for a Mac', () => {
  expect(osOf('MacIntel')).toBe('mac')
  expect(osOf('Win32')).toBe('windows')
  expect(osOf('Linux x86_64')).toBe('linux')
  expect(osOf('Linux aarch64')).toBe('linux')
  expect(osOf('')).toBe('mac')
})

test('setup is needed when claude or mnemo is missing, never for git or gh alone', () => {
  expect(needsSetup(all())).toBe(false)
  expect(needsSetup(all(['claude']))).toBe(true)
  expect(needsSetup(all(['mnemo']))).toBe(true)
  expect(needsSetup(all(['claude', 'mnemo', 'git', 'gh']))).toBe(true)
  expect(needsSetup(all(['git', 'gh']))).toBe(false)
  // A tool the status left out is missing, not present.
  expect(needsSetup(all().filter((r) => r.name !== 'mnemo'))).toBe(true)
})

test('Claude Code installs through its native installer for this OS, then starts claude to log in', () => {
  const mac = installRoute('claude', 'mac')
  expect(mac.shows).toBe('curl -fsSL https://claude.ai/install.sh | bash')
  expect(mac.command).toBe('curl -fsSL https://claude.ai/install.sh | bash && ~/.local/bin/claude')
  expect(installRoute('claude', 'linux')).toEqual(mac)
  // The pane's shell on Windows is cmd.exe: the CMD form, not PowerShell's irm | iex.
  const win = installRoute('claude', 'windows')
  expect(win.shows).toBe('curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd')
  expect(win.command).toBe(`${win.shows} && "%USERPROFILE%\\.local\\bin\\claude.exe"`)
})

test('brew is only a Mac route: Windows installs with winget, Linux with whichever package manager it has', () => {
  expect(installRoute('gh', 'mac').command).toBe('brew install gh')
  expect(installRoute('gh', 'windows').command).toBe('winget install --id GitHub.cli -e --source winget')
  expect(installRoute('git', 'windows').command).toBe('winget install --id Git.Git -e --source winget')
  expect(installRoute('git', 'mac').command).toBe('xcode-select --install')
  for (const tool of ['git', 'gh'] as const)
    for (const os of ['windows', 'linux'] as const) expect(installRoute(tool, os).command).not.toContain('brew')

  const gh = installRoute('gh', 'linux').command
  expect(gh).toMatch(/^sh -c '[^']*'$/)
  expect(gh).toContain('if command -v apt-get >/dev/null; then sudo apt-get install -y gh')
  expect(gh).toContain('elif command -v dnf >/dev/null; then sudo dnf install -y gh')
  // Arch names the package differently.
  expect(gh).toContain('then sudo pacman -S --noconfirm github-cli')
  expect(gh).toContain('elif command -v zypper >/dev/null; then sudo zypper install -y gh')
  expect(gh).toMatch(/; else echo "[^"]*https:\/\/github.com\/cli\/cli#installation"; fi'$/)
  expect(installRoute('git', 'linux').command).toContain('then sudo apt-get install -y git')
})

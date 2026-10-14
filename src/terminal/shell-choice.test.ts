import { shellActions } from './shell-choice'
import type { Shells } from '../pty/shells'

const windows: Shells = {
  shells: [
    { id: 'cmd', label: 'Command Prompt', kind: 'cmd', path: 'C:\\Windows\\system32\\cmd.exe' },
    { id: 'powershell', label: 'Windows PowerShell', kind: 'powershell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
    { id: 'git-bash', label: 'Git Bash', kind: 'posix', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
  ],
  current: 'cmd',
  kind: 'cmd',
}

test('the palette offers each installed shell, the current one marked, and saves the one run', async () => {
  const chosen: string[] = []
  const actions = shellActions(windows, async (id) => void chosen.push(id))
  expect(actions.map((a) => [a.id, a.title])).toEqual([
    ['terminal.shell.cmd', 'New terminals start Command Prompt (current)'],
    ['terminal.shell.powershell', 'New terminals start Windows PowerShell'],
    ['terminal.shell.git-bash', 'New terminals start Git Bash'],
  ])
  await actions[2].run()
  expect(chosen).toEqual(['git-bash'])
})

test('nothing is offered before the app has asked, on macOS and Linux, or with one shell', () => {
  expect(shellActions(null, async () => {})).toEqual([])
  expect(shellActions({ shells: [], current: null, kind: 'posix' }, async () => {})).toEqual([])
  expect(shellActions({ ...windows, shells: windows.shells.slice(0, 1) }, async () => {})).toEqual([])
})

import { homeDir } from '@tauri-apps/api/path'
import { openSession } from '../../drawer/open'

let home: Promise<string> | null = null

/** Runs `command` in a terminal the drawer shows, started in the home folder: an installer, a
 *  sign-in. `label` names its tab. A home folder that could not be read is asked again next time. */
export async function inTerminal(command: string, label: string): Promise<void> {
  home ??= homeDir().catch((e: unknown) => {
    home = null
    throw e
  })
  await openSession({ kind: 'command', root: await home, command, label })
}

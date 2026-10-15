import { invoke } from '@tauri-apps/api/core'
import { loadShells, type Shells } from '../pty/shells'
import { onWindows } from '../pty/typed'

/** Which shell a new terminal starts on Windows (#360) is asked once at launch, so the app types
 *  into a terminal it has just spawned in that shell's words (`paneShell`). The Settings window
 *  chooses it, and asks again after each choice. */
if (onWindows()) void loadShells(() => invoke<Shells>('pty_shells'))

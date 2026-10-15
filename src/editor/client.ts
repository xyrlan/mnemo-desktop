import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

/** Mirrors `fs::Entry` in src-tauri/src/fs.rs. */
export type Entry = { name: string; is_dir: boolean }

/** What the chat's catalog reads off disk (`chat-input/catalog.ts`): a file, a folder, home. */
export interface FsClient {
  read(path: string): Promise<string>
  list(dir: string): Promise<Entry[]>
  home(): Promise<string>
}

let home: Promise<string> | null = null

export const tauriFs: FsClient = {
  read: (path) => invoke<string>('fs_read', { path }),
  list: (dir) => invoke<Entry[]>('fs_list', { dir }),
  home: () => (home ??= homeDir().then((h) => h.replace(/\/+$/, '') || '/')),
}

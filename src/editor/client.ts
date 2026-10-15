import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

/** Mirrors `fs::Entry` in src-tauri/src/fs.rs. */
export type Entry = { name: string; is_dir: boolean }
/** Mirrors `fs::Loaded`: the text, and the stamp of the bytes on disk it came from. */
export type Loaded = { text: string; stamp: string }
/** Mirrors `fs::Saved`. */
export type Saved = { status: 'written'; stamp: string } | { status: 'changed' } | { status: 'gone' }

export interface FsClient {
  read(path: string): Promise<string>
  load(path: string): Promise<Loaded>
  /** Writes unless `expected` is given and the file no longer has that stamp, or is gone. */
  write(path: string, contents: string, expected?: string): Promise<Saved>
  list(dir: string): Promise<Entry[]>
  home(): Promise<string>
}

let home: Promise<string> | null = null

export const tauriFs: FsClient = {
  read: (path) => invoke<string>('fs_read', { path }),
  load: (path) => invoke<Loaded>('fs_load', { path }),
  write: (path, contents, expected) => invoke<Saved>('fs_write', { path, contents, expected: expected ?? null }),
  list: (dir) => invoke<Entry[]>('fs_list', { dir }),
  home: () => (home ??= homeDir().then((h) => h.replace(/\/+$/, '') || '/')),
}

import { invoke } from '@tauri-apps/api/core'

/** A published release newer than the running build (`newer_release.rs`). `told`: an earlier
 *  run already announced it, so it is only shown where the version is. */
export type NewerRelease = { version: string; url: string; told: boolean }

/** What came back, when it is a release; anything else (an old build, a mock) is none. */
function asRelease(r: unknown): NewerRelease | null {
  const o = r as Partial<NewerRelease> | null
  return o && typeof o.version === 'string' && typeof o.url === 'string' ? { version: o.version, url: o.url, told: o.told === true } : null
}

let cached: Promise<NewerRelease | null> | undefined
/** Asked once per app run. Offline, or outside Tauri, there is none: the reason goes to the
 *  console and nowhere else, since no one needs to hear that a check they never asked for failed. */
export function newerRelease(): Promise<NewerRelease | null> {
  cached ??= invoke<unknown>('app_newer_release').then(asRelease, (why) => {
    console.warn('could not check for a newer release:', why)
    return null
  })
  return cached
}

/** `mnemo 0.5.4 is out` beside the about line. */
export function newerLine(r: NewerRelease | null): string {
  return r ? `${r.version} is out` : ''
}

/** Opens the release's page in the person's browser. */
export function openRelease(r: NewerRelease): Promise<void> {
  return invoke<void>('browser_open_external', { url: r.url })
}

type Tell = (title: string, opts: { id: string; description: string; duration: number; action: { label: string; onClick: () => void } }) => void

/** Says a newer release is out, once per version (`told` carries that across runs): quietly,
 *  a toast with the link, gone on its own. */
export async function tellNewerRelease(tell: Tell, ask: () => Promise<NewerRelease | null> = newerRelease): Promise<void> {
  const r = await ask()
  if (!r || r.told) return
  tell(`mnemo ${r.version} is out`, {
    // One toast however often this runs in a run (StrictMode mounts twice).
    id: 'newer-release',
    description: 'A newer release than the one running. Its page has the installers.',
    duration: 15_000,
    action: { label: 'Open', onClick: () => void openRelease(r).catch((why) => console.warn('could not open the release page:', why)) },
  })
}

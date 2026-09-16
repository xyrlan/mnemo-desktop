import { invoke } from '@tauri-apps/api/core'

/** What `build.rs` stamped into the binary that is running this window. */
export type BuildInfo = { version: string; sha: string; built_at: string }

/** `mnemo 0.1.0 · 9f3ab21 · built 2026-09-15 13:49 UTC` — the palette's about line.
 *  The sha is the point: a version alone cannot tell a bundle built this morning from
 *  one built before the merge you are looking for. Parts the build could not stamp are
 *  left out rather than shown as `unknown`; with nothing to say the line is empty. */
export function aboutLine(info: BuildInfo | null): string {
  if (!info) return ''
  const parts = [`mnemo ${info.version}`]
  if (info.sha && info.sha !== 'unknown') parts.push(info.sha)
  if (info.built_at && info.built_at !== 'unknown') parts.push(`built ${info.built_at}`)
  return parts.join(' · ')
}

let cached: Promise<BuildInfo | null> | undefined
/** Asked once per app run. Outside Tauri (browser dev, tests) there is no one to ask: null. */
export function buildInfo(): Promise<BuildInfo | null> {
  cached ??= invoke<BuildInfo>('app_build_info').catch(() => null)
  return cached
}

import { run } from './registry'

export type Platform = 'mac' | 'other'

export function actionForKey(e: KeyboardEvent, platform: Platform): string | null {
  const mod = platform === 'mac' ? e.metaKey : e.ctrlKey
  if (!mod) return null
  const k = e.key.toLowerCase()
  if (e.altKey && !e.shiftKey) {
    const m: Record<string, string> = {
      arrowleft: 'focus.left',
      arrowright: 'focus.right',
      arrowup: 'focus.up',
      arrowdown: 'focus.down',
    }
    return m[k] ?? null
  }
  if (e.altKey) return null
  if (e.shiftKey) {
    const m: Record<string, string> = { d: 'pane.split.col', '[': 'tab.prev', '{': 'tab.prev', ']': 'tab.next', '}': 'tab.next' }
    return m[k] ?? null
  }
  if (/^[1-9]$/.test(k)) return `tab.go.${k}`
  const m: Record<string, string> = { t: 'tab.new', d: 'pane.split.row', w: 'pane.close', k: 'palette.open' }
  return m[k] ?? null
}

export function detectPlatform(): Platform {
  return navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
}

export function installKeys(platform: Platform = detectPlatform()): () => void {
  const handler = (e: KeyboardEvent) => {
    const id = actionForKey(e, platform)
    if (!id) return
    e.preventDefault()
    e.stopPropagation()
    run(id)
  }
  window.addEventListener('keydown', handler, true)
  return () => window.removeEventListener('keydown', handler, true)
}

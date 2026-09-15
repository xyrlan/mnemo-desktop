import type { ITheme } from '@xterm/xterm'

export type VarReader = (name: string) => string

export const cssVar: VarReader = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function xtermTheme(read: VarReader = cssVar): ITheme {
  return {
    background: read('--bg'),
    foreground: read('--fg'),
    cursor: read('--fg'),
    selectionBackground: read('--ansi-bright-black'),
    black: read('--ansi-black'),
    red: read('--ansi-red'),
    green: read('--ansi-green'),
    yellow: read('--ansi-yellow'),
    blue: read('--ansi-blue'),
    magenta: read('--ansi-magenta'),
    cyan: read('--ansi-cyan'),
    white: read('--ansi-white'),
    brightBlack: read('--ansi-bright-black'),
    brightRed: read('--ansi-bright-red'),
    brightGreen: read('--ansi-bright-green'),
    brightYellow: read('--ansi-bright-yellow'),
    brightBlue: read('--ansi-bright-blue'),
    brightMagenta: read('--ansi-bright-magenta'),
    brightCyan: read('--ansi-bright-cyan'),
    brightWhite: read('--ansi-bright-white'),
  }
}

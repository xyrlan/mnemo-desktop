# ConPTY 1.24.261001001, from Windows Terminal

`conpty.dll` and `x64/OpenConsole.exe`, as the NuGet package
[`Microsoft.Windows.Console.ConPTY` 1.24.261001001](https://www.nuget.org/packages/Microsoft.Windows.Console.ConPTY/1.24.261001001)
ships them (`runtimes/win-x64/native/conpty.dll`, `build/native/runtimes/x64/OpenConsole.exe`).
MIT, from [microsoft/terminal](https://github.com/microsoft/terminal): `LICENSE`.

`tauri.windows.conf.json` installs them beside `mnemo-desktop.exe`. portable-pty loads a
`conpty.dll` found there in place of the one in `kernel32.dll` (`load_conpty` in its
`win/psuedocon.rs`), and that `conpty.dll` starts the `OpenConsole.exe` in the `x64` folder next
to itself. With no `x64/OpenConsole.exe` beside it, a pane's shell never shows anything.

## Why

The pseudoconsole Windows 10 has in `kernel32.dll` scrolls a pane's output out of the screen
without passing it on: the terminal keeps no scrollback, and the wheel has nothing to scroll.
Measured on 2026-10-16 on Windows 10 22H2 (19045), with portable-pty 0.9.0 and a headless
xterm.js 6.0.0 of 100×30. Claude Code 2.1.302 was asked to print 1 to 120, and then got ten
wheel-up notches:

| pseudoconsole | buffer after the answer | lines on screen after the wheel |
|---|---|---|
| `kernel32.dll` | normal, 30 lines: no scrollback | 100–120 (nothing moved) |
| this `conpty.dll` | alternate, mouse reporting on | 81–101 |

This `conpty.dll` passes the program's mouse modes and the terminal's mouse reports through, as
Windows Terminal's does, so Claude Code draws full-screen and scrolls itself, as it does on a Mac.

## Checksums

```
5afea6c9480e2c7dfd195376dd10996b0ae25cdc6f014e6247fd8aedc8c34852  conpty.dll
6f8e68dec4e8e5e15a54ecc8afa127b0e62139edc004ffbb4892125ff01d5737  x64/OpenConsole.exe
```

x64 only: the Windows release is built on x64 (`release.yml`).

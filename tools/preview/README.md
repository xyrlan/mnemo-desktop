# Preview harness

Shoots a screen of the real app — `src/`, served by the repo's own vite config — in headless
Chromium, with Tauri's IPC answered from a scenario instead of the Rust side. No Tauri build,
no running app, no Chrome extension.

```sh
pnpm install                                   # the repo's own deps: the harness uses its vite
pnpm --dir tools/preview install               # playwright, on its own lockfile
pnpm --dir tools/preview exec playwright install chromium   # once per machine

node tools/preview/shot.mjs --scenario terminal-pane --out /tmp/terminal.png
node tools/preview/shot.mjs --scenario empty-workspace --out /tmp/home.png --size 1280x800
node tools/preview/shot.mjs --list
```

`--size <w>x<h>` defaults to `1440x900`, at a device scale of 1. `--trace` prints every command
the app sent and what the scenario answered; `--settle <ms>` waits longer before the shot
(default 400). After the shot, stderr lists the commands the scenario answered nothing to and
any error the page threw — both mean the screen may not be what the app would show.

## Scenarios

One file per scenario in `scenarios/`; every file there is loaded, so adding one touches
nothing else.

```js
import { scenario } from '../scenario.mjs'
import { appIpc } from '../fixtures/app.mjs'

scenario('job-running', {
  // `appIpc` answers everything the app asks at launch; override what this screen is about.
  ipc: appIpc({
    home_snapshot: { repos: [/* … */], clone_base: '/Users/preview/code', errors: [], protected: 0 },
    pty_spawn: ({ onOutput }) => {
      setTimeout(() => onOutput.sendBytes('hello\r\n'), 50)
      return 1
    },
  }),
  events: [{ event: 'job-line', payload: { id: 'j1', line: 'building…' }, afterMs: 800 }],
})
```

- **`ipc(cmd, args)`** runs in Node, for every `invoke`. Return the reply (or a promise of it);
  throw to make `invoke` reject with the message, as a command returning `Err` does. Returning
  `undefined` answers `null` and gets the command listed after the shot.
- **Channels.** An argument that was a `Channel` in the page arrives as a `PreviewChannel`:
  `send(message)` delivers one message, `sendBytes(textOrBytes)` sends it as the `Vec<u8>` a pty
  sends.
- **`events`** are emitted inside the page, each `afterMs` after the document loads, to whatever
  `listen` registered. An event whose listener is not up yet is lost, as it would be from Rust:
  give it an `afterMs`. The shot waits for the last one.
- Events the page itself emits reach its own listeners and never reach `ipc`.

`fixtures/app.mjs` is the launch state with nothing going on; the first two scenarios are the app
as it stands today. `terminal-pane` restores its tab through `workspace_read`, so a change to the
saved workspace format means updating that fixture.

## Tests

```sh
pnpm --dir tools/preview test
```

The last of them shoot both scenarios through the real vite, so they need the repo's deps too.

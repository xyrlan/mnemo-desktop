# Preview harness

Shoots a screen of the real app — `src/`, served by the repo's own vite config — in headless
Chromium, with Tauri's IPC answered from a scenario instead of the Rust side. No Tauri build,
no running app, no Chrome extension.

```sh
pnpm install                                   # the repo's own deps: the harness uses its vite
pnpm --dir tools/preview install               # playwright, on its own lockfile
pnpm --dir tools/preview exec playwright install chromium   # once per machine

node tools/preview/shot.mjs --scenario terminal-pane --out /tmp/terminal.png
node tools/preview/shot.mjs --scenario empty-workspace --out /tmp/nexus.png --size 1280x800
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
- **`storage`** (optional) is what the app kept in `localStorage` from a last run, set before its
  code runs: `{ 'mnemo.nexus-drawer.v1': JSON.stringify(…) }`. Values are strings.
- **`drive`** (optional) is what a user did before the shot: `async (page) => {…}`, given the
  Playwright page once the app is up and settled (`page.keyboard.press('/')`). The shot waits
  `--settle` again after it.

`fixtures/app.mjs` is the launch state with nothing going on. `empty-workspace` is the app as a
fresh boot opens it: the Nexus, empty. `terminal-pane` restores a saved tab through
`workspace_read` and shows it as a drawer session, so a change to the saved workspace format means
updating that fixture. `nexus-quiet` is a crowded COMMAND column with the drawer open: two
captains with two-line names over eight quiet captains' chips (#465). `nexus-drawer` is the
drawer open on seven sessions kept from a last run (three children, two captains with long titles,
two shells): one header of session pills (#467); shoot it at `--size 940x760` for the narrowest
drawer, where the pills wrap to two rows and the rest are behind `+N`. `nexus-command` is the
`nexus` ship with `/` pressed: the fleet's command line over the bridge, every verb suggested
(#469). `nexus-memory` is the `nexus` ship with mnemo's memory at work (#472): the archive tower and
the vault's `LV` beside the deck's name and in the dock pod, and one `mnemo://pulse` of each kind
fired once the ship is drawn, so packets are in the air at the shot (a reflex twice to one child,
joined as `×2`).

## Tests

```sh
pnpm --dir tools/preview test
```

The last of them shoot `nexus`, `nexus-quiet`, `nexus-drawer`, `nexus-command`, `nexus-memory`, `empty-workspace` and `terminal-pane` through the
real vite and look at the page they drew (no workbench element, the drawer's tabs, no quiet
captain's chip over a captain, the drawer's one header with every pill readable and apart, no
input on the bridge, the command line open with its verbs, every kind's packet flown and the deck's
label row no taller than before the archive), so they need the repo's deps too.

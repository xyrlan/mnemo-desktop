# Shell + Free Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri 2 desktop app that opens the user's login shell in xterm.js panes with tabs, splits and a ⌘K palette, good enough to replace Warp for daily use.

**Architecture:** Rust core owns PTYs (`portable-pty`) behind four commands and streams raw bytes to the webview through a Tauri `Channel`. The React front-end keeps a pure layout tree (tabs → split/leaf nodes) in a zustand store; each leaf mounts one xterm.js terminal. A typed action registry drives both shortcuts and the palette.

**Tech Stack:** Tauri 2.11, portable-pty 0.9, React 19, TypeScript 5.9, Vite 8, @xterm/xterm 6, zustand 5, cmdk 1, vitest 5, pnpm.

Spec: `docs/superpowers/specs/2026-09-14-shell-terminal-design.md`.

---

## File structure

```
package.json, pnpm-lock.yaml, vite.config.ts, tsconfig.json, index.html
src/
  main.tsx                 React entry
  App.tsx                  tab bar + active tab's tree + palette
  theme.css                CSS custom properties, font-face, base styles
  theme.ts                 reads the CSS vars into an xterm ITheme
  layout/tree.ts           pure functions over Node/Tab (split, close, focus, neighbours)
  layout/tree.test.ts
  layout/store.ts          zustand store; the only place that calls pty spawn/kill
  pty/client.ts            thin wrappers over invoke() + Channel for the four commands
  terminal/TerminalPane.tsx one xterm per leaf, resize, OSC 7 cwd, title, exit/error states
  layout/SplitView.tsx     renders Node recursively with draggable dividers
  actions/registry.ts      Action type + registry + built-in actions
  actions/keys.ts          keyboard shortcut → action id
  palette/Palette.tsx      cmdk over the registry
src-tauri/
  Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json
  src/main.rs              calls mnemo_desktop_lib::run()
  src/lib.rs               builder, state, command registration, smoke hook
  src/pty.rs               PtyManager (no Tauri types) + unit tests
  src/commands.rs          #[tauri::command] wrappers, Channel plumbing
.github/workflows/ci.yml, release.yml
README.md
```

`pty.rs` deliberately has no Tauri dependency so its tests run with plain `cargo test`. The commands layer adapts it.

---

### Task 1: Scaffold the repo

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `.gitignore`
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/icons/` (generated)

- [ ] **Step 1: package.json**

```json
{
  "name": "mnemo-desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.11.1",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-webgl": "^0.19.0",
    "@xterm/xterm": "^6.0.0",
    "@fontsource/jetbrains-mono": "^5.3.0",
    "cmdk": "^1.1.1",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.4",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.1.1",
    "jsdom": "^26.0.0",
    "typescript": "^5.9.3",
    "vite": "^8.3.0",
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 2: vite.config.ts, tsconfig.json, index.html, .gitignore**

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mnemo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
src-tauri/target
src-tauri/gen
.DS_Store
```

- [ ] **Step 3: minimal React entry**

`src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './theme.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

`src/App.tsx` (placeholder replaced in Task 8):
```tsx
export default function App() {
  return <div className="app">mnemo</div>
}
```

`src/theme.css` (placeholder replaced in Task 4):
```css
html, body, #root { height: 100%; margin: 0; }
```

- [ ] **Step 4: Rust crate**

`src-tauri/Cargo.toml`:
```toml
[package]
name = "mnemo-desktop"
version = "0.1.0"
edition = "2021"
rust-version = "1.80"

[lib]
name = "mnemo_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
portable-pty = "0.9"
log = "0.4"
env_logger = "0.11"
```

`src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/src/main.rs`:
```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mnemo_desktop_lib::run()
}
```

`src-tauri/src/lib.rs` (grows in Task 3):
```rust
pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running mnemo-desktop");
}
```

`src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "mnemo",
  "version": "0.1.0",
  "identifier": "sh.mnemo.desktop",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "mnemo",
        "width": 1280,
        "height": 800,
        "minWidth": 600,
        "minHeight": 400
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`src-tauri/capabilities/default.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 5: install, generate icons, verify dev build compiles**

```bash
cd /Users/xyrlan/github/mnemo-desktop
pnpm install
python3 - <<'EOF'
# 1024x1024 placeholder PNG (solid colour) for icon generation
import struct, zlib
w=h=1024
raw=b''.join(b'\x00'+bytes([0x12,0x14,0x1a,0xff])*w for _ in range(h))
def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
open('app-icon.png','wb').write(png)
EOF
pnpm tauri icon app-icon.png
cargo build --manifest-path src-tauri/Cargo.toml
pnpm build
```
Expected: `cargo build` finishes with no errors (first build several minutes); `pnpm build` emits `dist/`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + React + Vite app"
```

---

### Task 2: PTY manager in Rust (no Tauri types)

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod pty;`)

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/pty.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn sh_echo(manager: &PtyManager) -> (PaneId, mpsc::Receiver<Event>) {
        let (tx, rx) = mpsc::channel();
        let sink = move |e: Event| { let _ = tx.send(e); };
        let id = manager
            .spawn(SpawnOptions {
                program: Some("/bin/sh".into()),
                args: vec!["-c".into(), "printf hi".into()],
                cwd: None,
                cols: 80,
                rows: 24,
                login: false,
            }, Box::new(sink))
            .expect("spawn");
        (id, rx)
    }

    fn collect(rx: &mpsc::Receiver<Event>) -> (Vec<u8>, Option<Option<i32>>) {
        let mut out = Vec::new();
        let mut exit = None;
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(Event::Output(b)) => out.extend(b),
                Ok(Event::Exit(code)) => { exit = Some(code); break; }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            }
        }
        (out, exit)
    }

    #[test]
    fn spawn_streams_output_then_exit() {
        let m = PtyManager::new();
        let (_id, rx) = sh_echo(&m);
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("hi"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn ids_are_unique_and_increasing() {
        let m = PtyManager::new();
        let (a, _ra) = sh_echo(&m);
        let (b, _rb) = sh_echo(&m);
        assert!(b > a);
    }

    #[test]
    fn resize_live_pty_ok() {
        let m = PtyManager::new();
        let (tx, _rx) = mpsc::channel();
        let id = m.spawn(SpawnOptions {
            program: Some("/bin/sh".into()), args: vec!["-c".into(), "sleep 1".into()],
            cwd: None, cols: 80, rows: 24, login: false,
        }, Box::new(move |e| { let _ = tx.send(e); })).unwrap();
        m.resize(id, 120, 40).expect("resize");
        m.kill(id);
    }

    #[test]
    fn kill_is_idempotent_and_unknown_is_noop() {
        let m = PtyManager::new();
        let (id, rx) = sh_echo(&m);
        let _ = collect(&rx);
        m.kill(id);
        m.kill(id);
        m.kill(999_999);
    }

    #[test]
    fn write_reaches_the_child() {
        let m = PtyManager::new();
        let (tx, rx) = mpsc::channel();
        let id = m.spawn(SpawnOptions {
            program: Some("/bin/sh".into()), args: vec!["-c".into(), "read x; printf \"got:%s\" \"$x\"".into()],
            cwd: None, cols: 80, rows: 24, login: false,
        }, Box::new(move |e| { let _ = tx.send(e); })).unwrap();
        m.write(id, b"abc\n").expect("write");
        let (out, exit) = collect(&rx);
        assert!(String::from_utf8_lossy(&out).contains("got:abc"), "got {:?}", out);
        assert_eq!(exit, Some(Some(0)));
    }

    #[test]
    fn write_after_exit_is_error() {
        let m = PtyManager::new();
        let (id, rx) = sh_echo(&m);
        let _ = collect(&rx);
        std::thread::sleep(Duration::from_millis(50));
        assert!(m.write(id, b"x").is_err());
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pty
```
Expected: compile error, `PtyManager` not found.

- [ ] **Step 3: Implement**

Top of `src-tauri/src/pty.rs`:
```rust
//! PTY ownership. No Tauri types here so `cargo test` covers it directly.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

pub type PaneId = u32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Output(Vec<u8>),
    Exit(Option<i32>),
}

pub type Sink = Box<dyn Fn(Event) + Send + Sync + 'static>;

pub struct SpawnOptions {
    /// `None` = the user's default shell.
    pub program: Option<String>,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
    /// Add `-l` on POSIX so the login profile loads.
    pub login: bool,
}

struct Handle {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    next: AtomicU32,
    handles: Arc<Mutex<HashMap<PaneId, Handle>>>,
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() }
        })
    }
}

impl PtyManager {
    pub fn new() -> Self { Self { next: AtomicU32::new(1), handles: Default::default() } }

    pub fn spawn(&self, opts: SpawnOptions, sink: Sink) -> Result<PaneId, String> {
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize { rows: opts.rows, cols: opts.cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty: {e}"))?;

        let program = opts.program.unwrap_or_else(default_shell);
        let mut cmd = CommandBuilder::new(&program);
        if opts.login && !cfg!(windows) { cmd.arg("-l"); }
        for a in &opts.args { cmd.arg(a); }
        if let Some(cwd) = &opts.cwd { cmd.cwd(cwd); }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("MNEMO_DESKTOP", "1");

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn {program}: {e}"))?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(|e| format!("reader: {e}"))?;
        let writer = pair.master.take_writer().map_err(|e| format!("writer: {e}"))?;

        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let handles = Arc::clone(&self.handles);
        let sink = Arc::new(sink);

        handles.lock().unwrap().insert(id, Handle { master: pair.master, writer, child });

        let reader_sink = Arc::clone(&sink);
        thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let mut buf = [0u8; 8192];
                    loop {
                        match reader.read(&mut buf) {
                            Ok(0) => break,
                            Ok(n) => reader_sink(Event::Output(buf[..n].to_vec())),
                            Err(_) => break,
                        }
                    }
                }));
                if result.is_err() { log::error!("pty reader {id} panicked"); }
                let code = {
                    let mut map = handles.lock().unwrap();
                    map.remove(&id).and_then(|mut h| h.child.wait().ok()).map(|s| s.exit_code() as i32)
                };
                reader_sink(Event::Exit(code));
            })
            .map_err(|e| format!("thread: {e}"))?;

        Ok(id)
    }

    pub fn write(&self, id: PaneId, data: &[u8]) -> Result<(), String> {
        let mut map = self.handles.lock().unwrap();
        let h = map.get_mut(&id).ok_or_else(|| format!("pane {id} not found"))?;
        h.writer.write_all(data).map_err(|e| format!("write: {e}"))
    }

    pub fn resize(&self, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.handles.lock().unwrap();
        let h = map.get(&id).ok_or_else(|| format!("pane {id} not found"))?;
        h.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize: {e}"))
    }

    /// Idempotent. Unknown ids are a no-op. The reader thread emits `Exit` when the PTY closes.
    pub fn kill(&self, id: PaneId) {
        let mut map = self.handles.lock().unwrap();
        if let Some(h) = map.get_mut(&id) {
            let _ = h.child.kill();
        }
    }

    pub fn kill_all(&self) {
        let ids: Vec<PaneId> = self.handles.lock().unwrap().keys().copied().collect();
        for id in ids { self.kill(id); }
    }
}
```

Add to `src-tauri/src/lib.rs` above `pub fn run()`:
```rust
pub mod pty;
```

- [ ] **Step 4: Run tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pty
```
Expected: `test result: ok. 6 passed`. On Windows CI the `/bin/sh` tests are skipped by adding `#[cfg(unix)]` on the `tests` module (do that now: `#[cfg(all(test, unix))] mod tests`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat(pty): PtyManager with spawn/write/resize/kill and reader thread"
```

---

### Task 3: Tauri commands over the manager

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: commands.rs**

```rust
use crate::pty::{Event, PaneId, PtyManager, SpawnOptions};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

pub struct PtyState(pub PtyManager);

#[derive(Serialize, Clone)]
struct ExitPayload { code: Option<i32> }

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> Result<PaneId, String> {
    // The reader thread learns its own id from the first Exit payload target, so we
    // capture a slot it fills after spawn returns.
    let id_slot = std::sync::Arc::new(std::sync::Mutex::new(None::<PaneId>));
    let slot = id_slot.clone();
    let sink = Box::new(move |e: Event| match e {
        Event::Output(bytes) => {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes));
        }
        Event::Exit(code) => {
            let id = slot.lock().unwrap().unwrap_or(0);
            let _ = app.emit(&format!("pty://exit/{id}"), ExitPayload { code });
        }
    });
    let id = state.0.spawn(
        SpawnOptions { program: None, args: vec![], cwd, cols, rows, login: true },
        sink,
    )?;
    *id_slot.lock().unwrap() = Some(id);
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: PaneId, data: String) -> Result<(), String> {
    state.0.write(id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
    state.0.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: PaneId) {
    state.0.kill(id)
}
```

Note the id-slot: `Exit` can only fire after `spawn` has returned and filled the slot (the child must at least start), so `unwrap_or(0)` is never hit in practice; it exists so a pathological instant-exit cannot panic.

- [ ] **Step 2: lib.rs**

```rust
pub mod commands;
pub mod pty;

use commands::PtyState;
use tauri::Manager;

pub fn run() {
    env_logger::init();
    tauri::Builder::default()
        .manage(PtyState(pty::PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.state::<PtyState>().0.kill_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running mnemo-desktop");
}
```

- [ ] **Step 3: Compile**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```
Expected: success. If `Emitter` is unresolved, it is `use tauri::Emitter;` (Tauri 2 trait).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src
git commit -m "feat(core): expose pty_spawn/write/resize/kill commands with raw output channel"
```

---

### Task 4: Theme

**Files:**
- Create: `src/theme.css`, `src/theme.ts`, `src/theme.test.ts`

- [ ] **Step 1: theme.css**

```css
@import '@fontsource/jetbrains-mono/400.css';
@import '@fontsource/jetbrains-mono/700.css';

:root {
  --bg: #0f1116;
  --bg-elev: #161923;
  --fg: #d6dae3;
  --fg-muted: #7c8394;
  --accent: #7aa2f7;
  --border: #262a36;
  --border-focus: var(--accent);

  --ansi-black: #1a1d27;
  --ansi-red: #f7768e;
  --ansi-green: #9ece6a;
  --ansi-yellow: #e0af68;
  --ansi-blue: #7aa2f7;
  --ansi-magenta: #bb9af7;
  --ansi-cyan: #7dcfff;
  --ansi-white: #a9b1d6;
  --ansi-bright-black: #414868;
  --ansi-bright-red: #ff9eb3;
  --ansi-bright-green: #b9f27c;
  --ansi-bright-yellow: #ffc777;
  --ansi-bright-blue: #9ab8ff;
  --ansi-bright-magenta: #d0b3ff;
  --ansi-bright-cyan: #a6e3ff;
  --ansi-bright-white: #c0caf5;

  --font-mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  --font-size: 13px;
  --tabbar-h: 34px;
}

html, body, #root { height: 100%; margin: 0; background: var(--bg); color: var(--fg); }
body { font-family: var(--font-mono); font-size: var(--font-size); font-variant-ligatures: none; overflow: hidden; }
* { box-sizing: border-box; }

.app { display: flex; flex-direction: column; height: 100%; }
.tabbar { height: var(--tabbar-h); display: flex; align-items: stretch; background: var(--bg-elev); border-bottom: 1px solid var(--border); user-select: none; }
.tab { padding: 0 14px; display: flex; align-items: center; color: var(--fg-muted); border-right: 1px solid var(--border); cursor: default; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab.active { color: var(--fg); background: var(--bg); }
.tab-new { padding: 0 12px; display: flex; align-items: center; color: var(--fg-muted); cursor: default; }
.workspace { flex: 1; min-height: 0; position: relative; }

.split { display: flex; width: 100%; height: 100%; }
.split.row { flex-direction: row; }
.split.col { flex-direction: column; }
.divider { background: var(--border); flex: 0 0 4px; }
.split.row > .divider { cursor: col-resize; }
.split.col > .divider { cursor: row-resize; }

.pane { position: relative; width: 100%; height: 100%; border: 1px solid var(--border); padding: 4px; background: var(--bg); }
.pane.focused { border-color: var(--border-focus); }
.pane .xterm { height: 100%; }
.pane-message { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--fg-muted); background: rgba(15,17,22,.85); text-align: center; padding: 16px; }
.pane-message button { margin-left: 8px; background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border); padding: 4px 10px; font: inherit; }

.palette-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; justify-content: center; padding-top: 12vh; }
.palette { width: 520px; max-height: 60vh; background: var(--bg-elev); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; font: inherit; }
.palette [cmdk-input] { width: 100%; padding: 12px 14px; background: transparent; border: 0; border-bottom: 1px solid var(--border); color: var(--fg); font: inherit; outline: none; }
.palette [cmdk-list] { max-height: calc(60vh - 48px); overflow: auto; padding: 6px; }
.palette [cmdk-item] { padding: 8px 10px; border-radius: 4px; display: flex; justify-content: space-between; color: var(--fg); }
.palette [cmdk-item][data-selected='true'] { background: var(--bg); color: var(--accent); }
.palette .shortcut { color: var(--fg-muted); }
```

- [ ] **Step 2: theme.ts test**

`src/theme.test.ts`:
```ts
import { xtermTheme } from './theme'

test('xterm theme maps CSS variables', () => {
  const read = (name: string) => ({ '--bg': '#000000', '--fg': '#ffffff', '--ansi-red': '#ff0000' } as Record<string, string>)[name] ?? '#123456'
  const t = xtermTheme(read)
  expect(t.background).toBe('#000000')
  expect(t.foreground).toBe('#ffffff')
  expect(t.red).toBe('#ff0000')
  expect(t.brightWhite).toBe('#123456')
})
```

- [ ] **Step 3: theme.ts**

```ts
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
```

- [ ] **Step 4: Run, commit**

```bash
pnpm test
git add src/theme.css src/theme.ts src/theme.test.ts
git commit -m "feat(ui): single mnemo theme and xterm palette"
```

---

### Task 5: Pure layout tree

**Files:**
- Create: `src/layout/tree.ts`, `src/layout/tree.test.ts`

- [ ] **Step 1: Tests**

```ts
import { leaf, splitAt, closeLeaf, leaves, replaceRatio, neighbour, type Node, type Rect } from './tree'

const L = (p: number): Node => ({ kind: 'leaf', pane: p })

test('splitAt replaces the leaf with a split holding old and new', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect(t).toEqual({ kind: 'split', dir: 'row', ratio: 0.5, children: [L(1), L(2)] })
})

test('splitAt on a nested leaf', () => {
  const t = splitAt({ kind: 'split', dir: 'row', ratio: 0.5, children: [L(1), L(2)] }, 2, 3, 'col')
  expect(leaves(t)).toEqual([1, 2, 3])
  expect((t as any).children[1]).toEqual({ kind: 'split', dir: 'col', ratio: 0.5, children: [L(2), L(3)] })
})

test('closeLeaf promotes the sibling', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect(closeLeaf(t, 1)).toEqual(L(2))
  expect(closeLeaf(t, 2)).toEqual(L(1))
})

test('closeLeaf of the only leaf returns null', () => {
  expect(closeLeaf(L(1), 1)).toBeNull()
})

test('closeLeaf of unknown pane returns the same tree', () => {
  const t = L(1)
  expect(closeLeaf(t, 9)).toBe(t)
})

test('replaceRatio clamps to [0.1, 0.9]', () => {
  const t = splitAt(L(1), 1, 2, 'row')
  expect((replaceRatio(t, [], 0.01) as any).ratio).toBe(0.1)
  expect((replaceRatio(t, [], 0.99) as any).ratio).toBe(0.9)
  expect((replaceRatio(t, [], 0.3) as any).ratio).toBe(0.3)
})

test('neighbour picks the nearest pane in a direction by rect', () => {
  const rects = new Map<number, Rect>([
    [1, { x: 0, y: 0, w: 100, h: 100 }],
    [2, { x: 100, y: 0, w: 100, h: 100 }],
    [3, { x: 0, y: 100, w: 200, h: 100 }],
  ])
  expect(neighbour(1, 'right', rects)).toBe(2)
  expect(neighbour(2, 'left', rects)).toBe(1)
  expect(neighbour(1, 'down', rects)).toBe(3)
  expect(neighbour(3, 'up', rects)).toBe(1)
  expect(neighbour(1, 'up', rects)).toBeNull()
})
```

- [ ] **Step 2: Run to fail**

`pnpm test src/layout` → module not found.

- [ ] **Step 3: Implement**

```ts
export type PaneId = number
export type Dir = 'row' | 'col'
export type Node =
  | { kind: 'leaf'; pane: PaneId }
  | { kind: 'split'; dir: Dir; ratio: number; children: [Node, Node] }
export type Path = (0 | 1)[]
export type Rect = { x: number; y: number; w: number; h: number }
export type Side = 'left' | 'right' | 'up' | 'down'

export const leaf = (pane: PaneId): Node => ({ kind: 'leaf', pane })

export function leaves(n: Node): PaneId[] {
  return n.kind === 'leaf' ? [n.pane] : [...leaves(n.children[0]), ...leaves(n.children[1])]
}

export function splitAt(n: Node, target: PaneId, fresh: PaneId, dir: Dir): Node {
  if (n.kind === 'leaf') {
    return n.pane === target ? { kind: 'split', dir, ratio: 0.5, children: [n, leaf(fresh)] } : n
  }
  return { ...n, children: [splitAt(n.children[0], target, fresh, dir), splitAt(n.children[1], target, fresh, dir)] }
}

/** Returns null when the tree becomes empty, the same object when the pane is absent. */
export function closeLeaf(n: Node, target: PaneId): Node | null {
  if (n.kind === 'leaf') return n.pane === target ? null : n
  const [a, b] = n.children
  const a2 = closeLeaf(a, target)
  if (a2 === null) return b
  const b2 = closeLeaf(b, target)
  if (b2 === null) return a
  if (a2 === a && b2 === b) return n
  return { ...n, children: [a2, b2] }
}

export function replaceRatio(n: Node, path: Path, ratio: number): Node {
  if (n.kind === 'leaf') return n
  if (path.length === 0) return { ...n, ratio: Math.min(0.9, Math.max(0.1, ratio)) }
  const [head, ...rest] = path
  const children: [Node, Node] = [n.children[0], n.children[1]]
  children[head] = replaceRatio(children[head], rest, ratio)
  return { ...n, children }
}

export function neighbour(from: PaneId, side: Side, rects: Map<PaneId, Rect>): PaneId | null {
  const me = rects.get(from)
  if (!me) return null
  const cx = me.x + me.w / 2, cy = me.y + me.h / 2
  let best: PaneId | null = null, bestD = Infinity
  for (const [id, r] of rects) {
    if (id === from) continue
    const ox = r.x + r.w / 2, oy = r.y + r.h / 2
    const ok =
      side === 'right' ? r.x >= me.x + me.w - 1 :
      side === 'left' ? r.x + r.w <= me.x + 1 :
      side === 'down' ? r.y >= me.y + me.h - 1 :
      r.y + r.h <= me.y + 1
    if (!ok) continue
    const d = (ox - cx) ** 2 + (oy - cy) ** 2
    if (d < bestD) { bestD = d; best = id }
  }
  return best
}
```

- [ ] **Step 4: Run, commit**

```bash
pnpm test src/layout
git add src/layout
git commit -m "feat(layout): pure split tree with split/close/ratio/neighbour"
```

---

### Task 6: PTY client and store

**Files:**
- Create: `src/pty/client.ts`, `src/layout/store.ts`, `src/layout/store.test.ts`

- [ ] **Step 1: client.ts**

```ts
import { invoke, Channel } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type PaneId = number

export interface PtyClient {
  spawn(opts: { cwd?: string; cols: number; rows: number; onOutput: (bytes: Uint8Array) => void }): Promise<PaneId>
  write(id: PaneId, data: string): Promise<void>
  resize(id: PaneId, cols: number, rows: number): Promise<void>
  kill(id: PaneId): Promise<void>
  onExit(id: PaneId, cb: (code: number | null) => void): Promise<UnlistenFn>
}

export const tauriPty: PtyClient = {
  async spawn({ cwd, cols, rows, onOutput }) {
    const ch = new Channel<ArrayBuffer | number[]>()
    ch.onmessage = (m) => onOutput(m instanceof ArrayBuffer ? new Uint8Array(m) : Uint8Array.from(m))
    return invoke<PaneId>('pty_spawn', { cwd: cwd ?? null, cols, rows, onOutput: ch })
  },
  write: (id, data) => invoke('pty_write', { id, data }),
  resize: (id, cols, rows) => invoke('pty_resize', { id, cols, rows }),
  kill: (id) => invoke('pty_kill', { id }),
  onExit: (id, cb) => listen<{ code: number | null }>(`pty://exit/${id}`, (e) => cb(e.payload.code)),
}
```

- [ ] **Step 2: store test**

`src/layout/store.test.ts`:
```ts
import { createStore } from './store'
import type { PtyClient } from '../pty/client'

function fakePty(): PtyClient & { killed: number[] } {
  let next = 1
  const killed: number[] = []
  return {
    killed,
    spawn: async () => next++,
    write: async () => {},
    resize: async () => {},
    kill: async (id) => { killed.push(id) },
    onExit: async () => () => {},
  }
}

test('boot creates one tab with one pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  const st = s.getState()
  expect(st.tabs).toHaveLength(1)
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: 1 })
  expect(st.tabs[0].focused).toBe(1)
})

test('split focuses the new pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  const t = s.getState().tabs[0]
  expect(t.focused).toBe(2)
  expect(t.root.kind).toBe('split')
})

test('closing the last pane of the last tab opens a fresh tab', async () => {
  const pty = fakePty()
  const s = createStore(pty)
  await s.getState().newTab()
  await s.getState().closePane()
  const st = s.getState()
  expect(pty.killed).toEqual([1])
  expect(st.tabs).toHaveLength(1)
  expect(st.tabs[0].root).toEqual({ kind: 'leaf', pane: 2 })
})

test('closing a pane in a split promotes the sibling and focuses it', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().split('row')
  await s.getState().closePane()
  const t = s.getState().tabs[0]
  expect(t.root).toEqual({ kind: 'leaf', pane: 1 })
  expect(t.focused).toBe(1)
})

test('goToTab and cycle', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  await s.getState().newTab()
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
  s.getState().goToTab(0)
  expect(s.getState().activeTab).toBe(s.getState().tabs[0].id)
  s.getState().cycleTab(-1)
  expect(s.getState().activeTab).toBe(s.getState().tabs[1].id)
})

test('setCwd and setTitle update the pane record', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().setCwd(1, '/tmp')
  s.getState().setTitle(1, 'vim')
  expect(s.getState().panes[1]).toEqual({ id: 1, cwd: '/tmp', title: 'vim' })
})

test('paneExited marks the pane', async () => {
  const s = createStore(fakePty())
  await s.getState().newTab()
  s.getState().paneExited(1, 0)
  expect(s.getState().panes[1].exitCode).toBe(0)
})
```

- [ ] **Step 3: store.ts**

```ts
import { createStore as createZustand, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { closeLeaf, leaf, leaves, replaceRatio, splitAt, type Dir, type Node, type PaneId, type Path } from './tree'
import { tauriPty, type PtyClient } from '../pty/client'

export type Tab = { id: string; root: Node; focused: PaneId }
export type Pane = { id: PaneId; cwd?: string; title?: string; exitCode?: number | null; error?: string }

export type State = {
  tabs: Tab[]
  activeTab: string
  panes: Record<PaneId, Pane>
  paletteOpen: boolean
  // pane output subscribers, keyed by pane; set by TerminalPane on mount
  sinks: Record<PaneId, (b: Uint8Array) => void>
}

export type Actions = {
  newTab(cwd?: string): Promise<void>
  split(dir: Dir): Promise<void>
  closePane(): Promise<void>
  focusPane(id: PaneId): void
  goToTab(index: number): void
  cycleTab(delta: 1 | -1): void
  setRatio(path: Path, ratio: number): void
  setCwd(id: PaneId, cwd: string): void
  setTitle(id: PaneId, title: string): void
  paneExited(id: PaneId, code: number | null): void
  attachSink(id: PaneId, sink: (b: Uint8Array) => void): void
  setPalette(open: boolean): void
}

export type Store = StoreApi<State & Actions>

const DEFAULT_COLS = 80, DEFAULT_ROWS = 24

export function createStore(pty: PtyClient): Store {
  return createZustand<State & Actions>((set, get) => {
    const active = () => get().tabs.find((t) => t.id === get().activeTab)!

    async function spawnPane(cwd?: string): Promise<PaneId> {
      const id = await pty.spawn({
        cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS,
        onOutput: (b) => get().sinks[id]?.(b),
      })
      set((s) => ({ panes: { ...s.panes, [id]: { id, cwd } } }))
      pty.onExit(id, (code) => get().paneExited(id, code))
      return id
    }

    return {
      tabs: [], activeTab: '', panes: {}, paletteOpen: false, sinks: {},

      async newTab(cwd) {
        const pane = await spawnPane(cwd)
        const tab: Tab = { id: `tab-${pane}`, root: leaf(pane), focused: pane }
        set((s) => ({ tabs: [...s.tabs, tab], activeTab: tab.id }))
      },

      async split(dir) {
        const tab = active()
        const cwd = get().panes[tab.focused]?.cwd
        const fresh = await spawnPane(cwd)
        set((s) => ({
          tabs: s.tabs.map((t) => t.id === tab.id ? { ...t, root: splitAt(t.root, tab.focused, fresh, dir), focused: fresh } : t),
        }))
      },

      async closePane() {
        const tab = active()
        const closing = tab.focused
        await pty.kill(closing)
        const root = closeLeaf(tab.root, closing)
        set((s) => {
          const panes = { ...s.panes }; delete panes[closing]
          const sinks = { ...s.sinks }; delete sinks[closing]
          if (root === null) {
            const tabs = s.tabs.filter((t) => t.id !== tab.id)
            const idx = s.tabs.findIndex((t) => t.id === tab.id)
            const next = tabs[Math.max(0, idx - 1)]
            return { tabs, activeTab: next?.id ?? '', panes, sinks }
          }
          const focused = leaves(root)[0]
          return { tabs: s.tabs.map((t) => t.id === tab.id ? { ...t, root, focused } : t), panes, sinks }
        })
        if (get().tabs.length === 0) await get().newTab()
      },

      focusPane(id) {
        set((s) => ({ tabs: s.tabs.map((t) => t.id === s.activeTab ? { ...t, focused: id } : t) }))
      },

      goToTab(index) {
        const t = get().tabs[index]
        if (t) set({ activeTab: t.id })
      },

      cycleTab(delta) {
        const { tabs, activeTab } = get()
        const i = tabs.findIndex((t) => t.id === activeTab)
        set({ activeTab: tabs[(i + delta + tabs.length) % tabs.length].id })
      },

      setRatio(path, ratio) {
        set((s) => ({ tabs: s.tabs.map((t) => t.id === s.activeTab ? { ...t, root: replaceRatio(t.root, path, ratio) } : t) }))
      },

      setCwd(id, cwd) { set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], cwd } } })) },
      setTitle(id, title) { set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], title } } })) },
      paneExited(id, code) { set((s) => ({ panes: { ...s.panes, [id]: { ...s.panes[id], exitCode: code } } })) },
      attachSink(id, sink) { set((s) => ({ sinks: { ...s.sinks, [id]: sink } })) },
      setPalette(open) { set({ paletteOpen: open }) },
    }
  })
}

export const store = createStore(tauriPty)
export const useApp = <T,>(sel: (s: State & Actions) => T) => useStore(store, sel)
export { DEFAULT_COLS, DEFAULT_ROWS }
```

- [ ] **Step 4: Run, commit**

```bash
pnpm test src/layout
git add src/pty src/layout
git commit -m "feat(store): tabs/panes store over an injectable PTY client"
```

---

### Task 7: TerminalPane

**Files:**
- Create: `src/terminal/TerminalPane.tsx`

- [ ] **Step 1: Component**

```tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { tauriPty } from '../pty/client'
import { store, useApp } from '../layout/store'
import { xtermTheme } from '../theme'

/** OSC 7 payload: file://host/path → path (percent-decoded). */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  return m ? decodeURIComponent(m[1]) : null
}

export default function TerminalPane({ id }: { id: number }) {
  const host = useRef<HTMLDivElement>(null)
  const focused = useApp((s) => s.tabs.find((t) => t.id === s.activeTab)?.focused === id)
  const pane = useApp((s) => s.panes[id])

  useEffect(() => {
    const el = host.current!
    const term = new Terminal({
      theme: xtermTheme(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10_000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    try { term.loadAddon(new WebglAddon()) } catch (e) { console.warn('webgl unavailable, canvas fallback', e) }
    fit.fit()

    store.getState().attachSink(id, (b) => term.write(b))
    const data = term.onData((d) => { void tauriPty.write(id, d) })
    const title = term.onTitleChange((t) => store.getState().setTitle(id, t))
    term.parser.registerOscHandler(7, (d) => { const p = parseOsc7(d); if (p) store.getState().setCwd(id, p); return true })

    const ro = new ResizeObserver(() => {
      fit.fit()
      void tauriPty.resize(id, term.cols, term.rows)
    })
    ro.observe(el)
    void tauriPty.resize(id, term.cols, term.rows)

    const onClick = () => store.getState().focusPane(id)
    el.addEventListener('mousedown', onClick)

    return () => {
      ro.disconnect(); data.dispose(); title.dispose(); term.dispose()
      el.removeEventListener('mousedown', onClick)
    }
  }, [id])

  useEffect(() => {
    if (focused) host.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [focused])

  const exited = pane?.exitCode !== undefined
  return (
    <div className={`pane${focused ? ' focused' : ''}`} onKeyDown={exited ? () => void store.getState().closePane() : undefined} tabIndex={exited ? 0 : -1}>
      <div ref={host} style={{ height: '100%' }} />
      {exited && <div className="pane-message">[process exited with code {pane?.exitCode ?? '?'}] press any key to close</div>}
      {pane?.error && (
        <div className="pane-message">
          {pane.error}
          <button onClick={() => void store.getState().closePane()}>close</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Test parseOsc7**

`src/terminal/osc7.test.ts`:
```ts
import { parseOsc7 } from './TerminalPane'

test('parses file URL with host', () => {
  expect(parseOsc7('file://mac.local/Users/x/github')).toBe('/Users/x/github')
})
test('parses without host and decodes', () => {
  expect(parseOsc7('file:///tmp/a%20b')).toBe('/tmp/a b')
})
test('rejects other payloads', () => {
  expect(parseOsc7('nonsense')).toBeNull()
})
```

Importing `TerminalPane.tsx` in jsdom pulls xterm; if the import fails under vitest, move `parseOsc7` to `src/terminal/osc7.ts` and import it from both places.

- [ ] **Step 3: Run, commit**

```bash
pnpm test src/terminal
git add src/terminal
git commit -m "feat(terminal): xterm pane with fit/webgl, OSC 7 cwd, title, exit state"
```

---

### Task 8: SplitView, tab bar, App

**Files:**
- Create: `src/layout/SplitView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: SplitView**

```tsx
import { useRef } from 'react'
import type { Node, Path } from './tree'
import { store } from './store'
import TerminalPane from '../terminal/TerminalPane'

export default function SplitView({ node, path = [] }: { node: Node; path?: Path }) {
  const ref = useRef<HTMLDivElement>(null)
  if (node.kind === 'leaf') return <TerminalPane id={node.pane} />

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const box = ref.current!.getBoundingClientRect()
    const move = (ev: MouseEvent) => {
      const ratio = node.dir === 'row' ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height
      store.getState().setRatio(path, ratio)
    }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const pct = `${node.ratio * 100}%`
  return (
    <div ref={ref} className={`split ${node.dir}`}>
      <div style={{ flex: `0 0 calc(${pct} - 2px)`, minWidth: 0, minHeight: 0 }}>
        <SplitView node={node.children[0]} path={[...path, 0]} />
      </div>
      <div className="divider" onMouseDown={onDown} />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <SplitView node={node.children[1]} path={[...path, 1]} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: App**

```tsx
import { useEffect } from 'react'
import { store, useApp } from './layout/store'
import SplitView from './layout/SplitView'
import Palette from './palette/Palette'
import { installKeys } from './actions/keys'

export default function App() {
  const tabs = useApp((s) => s.tabs)
  const activeTab = useApp((s) => s.activeTab)
  const panes = useApp((s) => s.panes)

  useEffect(() => {
    if (store.getState().tabs.length === 0) void store.getState().newTab()
    return installKeys()
  }, [])

  const active = tabs.find((t) => t.id === activeTab)
  return (
    <div className="app">
      <div className="tabbar">
        {tabs.map((t, i) => (
          <div key={t.id} className={`tab${t.id === activeTab ? ' active' : ''}`} onMouseDown={() => store.getState().goToTab(i)}>
            {panes[t.focused]?.title || 'shell'}
          </div>
        ))}
        <div className="tab-new" onMouseDown={() => void store.getState().newTab()}>+</div>
      </div>
      <div className="workspace">
        {tabs.map((t) => (
          <div key={t.id} style={{ position: 'absolute', inset: 0, display: t.id === activeTab ? 'block' : 'none' }}>
            <SplitView node={t.root} />
          </div>
        ))}
      </div>
      {active && <Palette />}
    </div>
  )
}
```

Inactive tabs stay mounted but hidden so their terminals keep scrollback and state.

- [ ] **Step 3: Commit** (compiles after Task 9 and 10 exist; commit together with Task 10 if `tsc` complains about the missing imports)

```bash
git add src/layout/SplitView.tsx src/App.tsx
git commit -m "feat(ui): tab bar, split view with draggable dividers"
```

---

### Task 9: Action registry and shortcuts

**Files:**
- Create: `src/actions/registry.ts`, `src/actions/keys.ts`, `src/actions/keys.test.ts`

- [ ] **Step 1: registry.ts**

```ts
import { store } from '../layout/store'
import { neighbour, type Rect, type Side } from '../layout/tree'

export type Action = { id: string; title: string; shortcut?: string; run: () => void | Promise<void> }

const actions: Action[] = []
export function register(a: Action) { actions.push(a) }
export function all(): Action[] { return actions }
export function run(id: string) { const a = actions.find((x) => x.id === id); if (a) void a.run() }

function paneRects(): Map<number, Rect> {
  const m = new Map<number, Rect>()
  document.querySelectorAll<HTMLElement>('.pane[data-pane]').forEach((el) => {
    const r = el.getBoundingClientRect()
    m.set(Number(el.dataset.pane), { x: r.left, y: r.top, w: r.width, h: r.height })
  })
  return m
}

function focusToward(side: Side) {
  const s = store.getState()
  const tab = s.tabs.find((t) => t.id === s.activeTab)
  if (!tab) return
  const next = neighbour(tab.focused, side, paneRects())
  if (next !== null) s.focusPane(next)
}

const s = () => store.getState()
register({ id: 'tab.new', title: 'New tab', shortcut: '⌘T', run: () => s().newTab() })
register({ id: 'pane.split.row', title: 'Split right', shortcut: '⌘D', run: () => s().split('row') })
register({ id: 'pane.split.col', title: 'Split down', shortcut: '⌘⇧D', run: () => s().split('col') })
register({ id: 'pane.close', title: 'Close pane', shortcut: '⌘W', run: () => s().closePane() })
register({ id: 'pane.new.samecwd', title: 'New tab in same directory', run: () => { const st = s(); const tab = st.tabs.find((t) => t.id === st.activeTab); return st.newTab(tab && st.panes[tab.focused]?.cwd) } })
register({ id: 'tab.prev', title: 'Previous tab', shortcut: '⌘⇧[', run: () => s().cycleTab(-1) })
register({ id: 'tab.next', title: 'Next tab', shortcut: '⌘⇧]', run: () => s().cycleTab(1) })
for (let i = 1; i <= 9; i++) register({ id: `tab.go.${i}`, title: `Go to tab ${i}`, shortcut: `⌘${i}`, run: () => s().goToTab(i - 1) })
register({ id: 'focus.left', title: 'Focus pane left', shortcut: '⌘⌥←', run: () => focusToward('left') })
register({ id: 'focus.right', title: 'Focus pane right', shortcut: '⌘⌥→', run: () => focusToward('right') })
register({ id: 'focus.up', title: 'Focus pane up', shortcut: '⌘⌥↑', run: () => focusToward('up') })
register({ id: 'focus.down', title: 'Focus pane down', shortcut: '⌘⌥↓', run: () => focusToward('down') })
register({ id: 'palette.open', title: 'Command palette', shortcut: '⌘K', run: () => s().setPalette(true) })
```

Add `data-pane={id}` to the `.pane` div in `TerminalPane.tsx` so `paneRects()` can find it.

- [ ] **Step 2: keys test**

`src/actions/keys.test.ts`:
```ts
import { actionForKey } from './keys'

const ev = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent

test('mac bindings', () => {
  expect(actionForKey(ev('t', { metaKey: true }), 'mac')).toBe('tab.new')
  expect(actionForKey(ev('d', { metaKey: true }), 'mac')).toBe('pane.split.row')
  expect(actionForKey(ev('D', { metaKey: true, shiftKey: true }), 'mac')).toBe('pane.split.col')
  expect(actionForKey(ev('ArrowLeft', { metaKey: true, altKey: true }), 'mac')).toBe('focus.left')
  expect(actionForKey(ev('3', { metaKey: true }), 'mac')).toBe('tab.go.3')
  expect(actionForKey(ev('k', { metaKey: true }), 'mac')).toBe('palette.open')
  expect(actionForKey(ev('t', { ctrlKey: true }), 'mac')).toBeNull()
})

test('other platforms use ctrl', () => {
  expect(actionForKey(ev('t', { ctrlKey: true }), 'other')).toBe('tab.new')
  expect(actionForKey(ev('t', { metaKey: true }), 'other')).toBeNull()
})
```

- [ ] **Step 3: keys.ts**

```ts
import { run } from './registry'

export type Platform = 'mac' | 'other'

export function actionForKey(e: KeyboardEvent, platform: Platform): string | null {
  const mod = platform === 'mac' ? e.metaKey : e.ctrlKey
  if (!mod) return null
  const k = e.key.toLowerCase()
  if (e.altKey && !e.shiftKey) {
    return ({ arrowleft: 'focus.left', arrowright: 'focus.right', arrowup: 'focus.up', arrowdown: 'focus.down' } as Record<string, string>)[k] ?? null
  }
  if (e.shiftKey) {
    return ({ d: 'pane.split.col', '[': 'tab.prev', '{': 'tab.prev', ']': 'tab.next', '}': 'tab.next' } as Record<string, string>)[k] ?? null
  }
  if (/^[1-9]$/.test(k)) return `tab.go.${k}`
  return ({ t: 'tab.new', d: 'pane.split.row', w: 'pane.close', k: 'palette.open' } as Record<string, string>)[k] ?? null
}

export function installKeys(): () => void {
  const platform: Platform = navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'other'
  const handler = (e: KeyboardEvent) => {
    const id = actionForKey(e, platform)
    if (!id) return
    e.preventDefault(); e.stopPropagation()
    run(id)
  }
  window.addEventListener('keydown', handler, true)
  return () => window.removeEventListener('keydown', handler, true)
}
```

The listener is in the capture phase so xterm never sees the chord.

- [ ] **Step 4: Run, commit**

```bash
pnpm test src/actions
git add src/actions src/terminal/TerminalPane.tsx
git commit -m "feat(actions): typed registry and keyboard chords"
```

---

### Task 10: Palette

**Files:**
- Create: `src/palette/Palette.tsx`

- [ ] **Step 1: Component**

```tsx
import { Command } from 'cmdk'
import { useEffect } from 'react'
import { store, useApp } from '../layout/store'
import { all, run } from '../actions/registry'

export default function Palette() {
  const open = useApp((s) => s.paletteOpen)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') store.getState().setPalette(false) }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  if (!open) return null
  return (
    <div className="palette-overlay" onMouseDown={() => store.getState().setPalette(false)}>
      <Command className="palette" onMouseDown={(e) => e.stopPropagation()} label="Commands">
        <Command.Input autoFocus placeholder="Type a command…" />
        <Command.List>
          <Command.Empty>No matches</Command.Empty>
          {all().filter((a) => a.id !== 'palette.open').map((a) => (
            <Command.Item key={a.id} value={a.title} onSelect={() => { store.getState().setPalette(false); run(a.id) }}>
              <span>{a.title}</span>
              {a.shortcut && <span className="shortcut">{a.shortcut}</span>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
```

- [ ] **Step 2: Type-check, build, run the app**

```bash
pnpm build
pnpm tauri dev
```
Manual check list: shell prompt appears with your zsh config; typing works; `⌘T`, `⌘D`, `⌘⇧D`, `⌘W`, `⌘K`, `⌘1`; drag divider; resize window reflows; `exit` shows the exited overlay and a key closes it; closing the window leaves no `zsh` orphans (`pgrep -fl "zsh -l"` before/after).

- [ ] **Step 3: Commit**

```bash
git add src
git commit -m "feat(palette): cmdk palette over the action registry"
```

---

### Task 11: Smoke hook in the core

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the smoke path**

In `run()` before `.run(...)`, add a `.setup(...)`:
```rust
        .setup(|app| {
            if std::env::var("MNEMO_DESKTOP_SMOKE").is_ok() {
                let state = app.state::<PtyState>();
                let (tx, rx) = std::sync::mpsc::channel();
                let id = state.0.spawn(
                    pty::SpawnOptions { program: None, args: vec![], cwd: None, cols: 80, rows: 24, login: true },
                    Box::new(move |e| { let _ = tx.send(e); }),
                )?;
                state.0.write(id, b"exit\n")?;
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
                let mut ok = false;
                while std::time::Instant::now() < deadline {
                    if let Ok(pty::Event::Exit(_)) = rx.recv_timeout(std::time::Duration::from_millis(100)) { ok = true; break; }
                }
                let handle = app.handle().clone();
                std::thread::spawn(move || { std::thread::sleep(std::time::Duration::from_millis(200)); handle.exit(if ok { 0 } else { 1 }); });
            }
            Ok(())
        })
```

- [ ] **Step 2: Verify locally**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
MNEMO_DESKTOP_SMOKE=1 ./src-tauri/target/debug/mnemo-desktop; echo "exit=$?"
```
Expected: window flashes, `exit=0`. (Debug binary needs `dist/` present from `pnpm build`, or run through `pnpm tauri dev` with the env set.)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(core): MNEMO_DESKTOP_SMOKE self-test exits 0 when a shell round-trips"
```

---

### Task 12: CI and release

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `README.md`

- [ ] **Step 1: ci.yml**

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with: { workspaces: src-tauri }
      - if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      - run: pnpm tauri build --ci
      - if: runner.os != 'Windows'
        run: |
          bin=$(find src-tauri/target/release -maxdepth 1 -type f -name mnemo-desktop | head -1)
          MNEMO_DESKTOP_SMOKE=1 xvfb-run -a "$bin" || MNEMO_DESKTOP_SMOKE=1 "$bin"
        shell: bash
```

On macOS `xvfb-run` does not exist, hence the `||` fallback; on Linux install `xvfb` alongside webkit. Add `xvfb` to the apt line.

- [ ] **Step 2: release.yml**

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            args: --target aarch64-apple-darwin
          - os: macos-latest
            args: --target x86_64-apple-darwin
          - os: ubuntu-latest
            args: ''
          - os: windows-latest
            args: ''
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: aarch64-apple-darwin,x86_64-apple-darwin }
      - if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - run: pnpm install --frozen-lockfile
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: mnemo-desktop ${{ github.ref_name }}
          releaseDraft: false
          args: ${{ matrix.args }}
```

- [ ] **Step 3: README.md**

```markdown
# mnemo-desktop

Desktop shell for the mnemo agentic development environment. Sub-project 1: a terminal with tabs, splits and a command palette — enough to replace your daily terminal so the mission cockpit (sub-project 2) can live on screen.

## Dev

    pnpm install
    pnpm tauri dev

## Test

    pnpm test                                   # front-end
    cargo test --manifest-path src-tauri/Cargo.toml   # core

## Shortcuts

⌘T new tab · ⌘W close pane · ⌘D split right · ⌘⇧D split down · ⌘⌥arrows focus · ⌘1-9 tab · ⌘⇧[ ] cycle · ⌘K palette (Ctrl on Linux/Windows)

Specs and plans: `docs/superpowers/`.
```

- [ ] **Step 4: Commit, push, watch CI**

```bash
git add .github README.md
git commit -m "ci: test, build and smoke on three platforms; release on tag"
git push
gh run watch
```
Expected: macOS and Linux green including smoke; Windows build green (its `pty` unit tests are `cfg(unix)`-gated, smoke skipped). Read each job, not the rollup.

---

## Self-review

**Spec coverage:** §4.1 commands/events → Tasks 2–3; shell/env/login → Task 2; cwd via OSC 7 → Task 7 + store; kill on window close → Task 3 `on_window_event`; §4.2 → Task 7; §5 tree, ops, shortcuts, focus border → Tasks 5, 6, 8, 9; tab title from OSC 0/2 → Task 7 `onTitleChange` + Task 8; §6 registry + palette → Tasks 9–10; §7 theme/font → Task 4; §8 errors: spawn failure surfaces as a rejected `newTab`/`split` promise — **gap**: the store must catch it and set `panes[id].error`. Fix: in `spawnPane`, wrap `pty.spawn` in try/catch; on failure allocate a synthetic negative id, set `{ id, error: String(e) }`, and still insert the leaf so the pane renders the message with the close button (Task 7 already renders `pane.error`). Add to Task 6 store.ts:

```ts
    let synthetic = -1
    async function spawnPane(cwd?: string): Promise<PaneId> {
      try {
        const id = await pty.spawn({ cwd, cols: DEFAULT_COLS, rows: DEFAULT_ROWS, onOutput: (b) => get().sinks[id]?.(b) })
        set((s) => ({ panes: { ...s.panes, [id]: { id, cwd } } }))
        pty.onExit(id, (code) => get().paneExited(id, code))
        return id
      } catch (e) {
        const id = synthetic--
        set((s) => ({ panes: { ...s.panes, [id]: { id, error: String(e) } } }))
        return id
      }
    }
```
and a store test: `spawn` rejecting → `panes[-1].error` set, tab still has one leaf. `closePane` on a negative id calls `pty.kill(-1)`, which the core treats as unknown → no-op. §9 tests → Tasks 2, 5, 6, 9, 11, 12. §10 layout/CI → Tasks 1, 12. §12 DoD → manual day of use after Task 12.

**Placeholders:** none.

**Type consistency:** `PaneId` is `number` in TS and `u32` in Rust; negative synthetic ids never cross the IPC boundary except via `pty_kill`, where `u32` deserialisation of `-1` would **fail**. Fix in Task 6 `closePane`: `if (closing > 0) await pty.kill(closing)`. `Event`/`Sink`/`SpawnOptions` names match between Tasks 2, 3, 11. Store action names (`newTab`, `split`, `closePane`, `focusPane`, `goToTab`, `cycleTab`, `setRatio`, `setCwd`, `setTitle`, `paneExited`, `attachSink`, `setPalette`) match their uses in Tasks 7–10.

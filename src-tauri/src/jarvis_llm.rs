//! Jarvis's local model, running (#505): NVIDIA Nemotron 3.5 Bolt E4B under llama.cpp's
//! `llama-server`, with its vision projector so the same model reads screenshots (#507).
//!
//! `jarvis_llm_ensure` gets what is missing into `~/.mnemo-desktop/models/jarvis/` (shared by the
//! debug and release builds), checks each file against its sha256 before it is used, and starts
//! one server for the app. A download that fails keeps what it brought and the next try goes on
//! from there (`voice::download`); a file whose checksum is wrong is deleted, never used.
//!
//! The server listens on 127.0.0.1 only, on a free port that stays in this module: the panel
//! talks to it through `jarvis_llm_chat`, never by address. It never outlives the app:
//! - on Windows it is put in a job object that kills it when the app's last handle to the job
//!   closes, which the system does when the app exits, crashes or is ended from Task Manager;
//! - on Linux the kernel sends it `SIGKILL` when the thread that started it ends
//!   (`PR_SET_PDEATHSIG`), and that thread lives exactly as long as the server is ours;
//! - on every OS `jarvis_llm_stop` and the app's own exit (`plugin`) stop it. On macOS that is
//!   all there is: a crash of the app leaves it running (macOS is out of #503's scope).
//!
//! The config's `model` section (`llamaServer`, `model`, `mmproj`, `~` is home) points at files
//! already on disk; each one named skips its download and its checksum: it is the maintainer's
//! own file. `"mmproj": false` runs without a projector, for a model the default one does not
//! fit. Off Windows the release ships no build this app can use, so `llama-server` comes from
//! the config or the PATH.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;

/// What `jarvis_llm_ensure` reports while it gets the model running; `LlmSetup` in
/// `src/jarvis/client.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LlmSetup {
    Download { file: String, done: u64, total: u64 },
    Verifying { file: String },
    Starting,
    Ready { vision: bool },
}

/// A file Jarvis downloads, and what it must be.
#[derive(Debug, Clone, Copy)]
pub struct Want<'a> {
    pub file: &'a str,
    pub url: &'a str,
    pub bytes: u64,
    pub sha256: &'a str,
}

pub const MODEL: Want<'static> = Want {
    file: "Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf",
    url: "https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Bolt-E4B-4GB/resolve/main/Nemotron-3.5-Bolt-E4B-Q4_K_M.gguf",
    bytes: 6_180_446_208,
    sha256: "5442bfb3b1384ff3774c9989e9457dad81bbb5830fbcf96adfdde40078831d5a",
};

/// NVIDIA publishes no projector for Bolt E4B; this is unsloth's, made from NVIDIA's weights.
pub const MMPROJ: Want<'static> = Want {
    file: "mmproj-Q8_0.gguf",
    url: "https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF/resolve/main/mmproj-Q8_0.gguf",
    bytes: 559_875_776,
    sha256: "6e0602540b342560e0ec62b182e8ea3bf54cc8e352b5e912f20cbb7a847cf23d",
};

/// llama.cpp's release whose CUDA build runs the model (#504, #511).
pub const LLAMA_BUILD: &str = "b11756";

/// The Windows CUDA build, and the CUDA runtime it needs beside it. Both unpack flat into one dir.
pub const LLAMA_ZIPS: [Want<'static>; 2] = [
    Want {
        file: "llama-b11756-bin-win-cuda-12.4-x64.zip",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b11756/llama-b11756-bin-win-cuda-12.4-x64.zip",
        bytes: 271_945_043,
        sha256: "bfb275464b8ef633a12d96f454e5fcf2efc642d926043208ce95d33449dad0e0",
    },
    Want {
        file: "cudart-llama-bin-win-cuda-12.4-x64.zip",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b11756/cudart-llama-bin-win-cuda-12.4-x64.zip",
        bytes: 391_443_627,
        sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
    },
];

/// How long llama-server may take to load the model and answer `/health`.
const START_TIMEOUT: Duration = Duration::from_secs(300);

/// `~/.mnemo-desktop/models/jarvis`, for both builds.
pub fn models_dir() -> PathBuf {
    crate::app_dir::shared_dir_in(&crate::app_dir::home()).join("models").join("jarvis")
}

/// What the last server wrote, for the error of one that would not start.
fn server_log_path() -> PathBuf {
    crate::app_dir::app_dir().join("jarvis-llama-server.log")
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------------------
// Files

/// `want` in `dir`, downloaded first if it is not there. A file lands under its own name only
/// once its sha256 matched, so one found there is used without hashing 6 GB again. On the way it
/// is `<file>.download` (whole, not yet checked), and `<file>.download.part` before that.
pub fn fetch(want: &Want, dir: &Path, on: &dyn Fn(LlmSetup)) -> Result<PathBuf, String> {
    let path = dir.join(want.file);
    if size(&path) == Some(want.bytes) {
        return Ok(path);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let staged = dir.join(format!("{}.download", want.file));
    if size(&staged) != Some(want.bytes) {
        let file = want.file.to_string();
        crate::voice::download(want.url, &staged, want.bytes, crate::voice::STALL, |done, total| {
            on(LlmSetup::Download { file: file.clone(), done, total })
        })
        .map_err(|e| format!("{}: {e}", want.file))?;
    }
    on(LlmSetup::Verifying { file: want.file.to_string() });
    let got = sha256_of(&staged)?;
    if got != want.sha256 {
        let _ = std::fs::remove_file(&staged);
        return Err(format!(
            "{}: its sha256 is {got}, not the published {}; it was deleted, and the next try downloads it again",
            want.file, want.sha256
        ));
    }
    std::fs::rename(&staged, &path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

fn size(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

fn sha256_of(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// What the server runs on: the executable, the model, and the projector when there is one.
#[derive(Debug, Clone, PartialEq)]
pub struct Files {
    pub server: PathBuf,
    pub model: PathBuf,
    pub mmproj: Option<PathBuf>,
}

/// A path of the config's `model` section: `Some(Some(p))` for a path, `Some(None)` for `false`
/// (none wanted), `None` when it names none.
fn configured(section: &serde_json::Value, key: &str, home: &Path) -> Result<Option<Option<PathBuf>>, String> {
    match section.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Bool(false)) => Ok(Some(None)),
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => {
            let path = expand(s.trim(), home);
            if path.is_file() {
                Ok(Some(Some(path)))
            } else {
                Err(format!("jarvis.json: model.{key} is {}, and there is no file there", path.display()))
            }
        }
        Some(other) => Err(format!("jarvis.json: model.{key} must be a path, not {other}")),
    }
}

/// `~/x` or `~\x` under `home`; anything else as written.
fn expand(p: &str, home: &Path) -> PathBuf {
    match p.strip_prefix("~/").or_else(|| p.strip_prefix("~\\")) {
        Some(rest) => home.join(rest),
        None if p == "~" => home.to_path_buf(),
        None => PathBuf::from(p),
    }
}

/// The files the server needs, out of the config's `model` section and `dir`, downloading into
/// `dir` what the config does not name. `server` finds llama-server when the config names none.
pub fn files(section: &serde_json::Value, home: &Path, dir: &Path, server: &dyn Fn(&Path, &dyn Fn(LlmSetup)) -> Result<PathBuf, String>, on: &dyn Fn(LlmSetup)) -> Result<Files, String> {
    // The whole section is read first: a mistake in it is said before gigabytes download.
    let (named_server, named_model, named_mmproj) = (configured(section, "llamaServer", home)?, configured(section, "model", home)?, configured(section, "mmproj", home)?);
    let server = match named_server {
        Some(Some(p)) => p,
        _ => server(dir, on)?,
    };
    let model = match named_model {
        Some(Some(p)) => p,
        _ => fetch(&MODEL, dir, on)?,
    };
    let mmproj = match named_mmproj {
        Some(p) => p,
        None => Some(fetch(&MMPROJ, dir, on)?),
    };
    Ok(Files { server, model, mmproj })
}

/// llama-server where the config names none: on Windows the release's CUDA build, downloaded and
/// unpacked into `<dir>/llama-<build>`; elsewhere the one on the PATH.
fn default_server(dir: &Path, on: &dyn Fn(LlmSetup)) -> Result<PathBuf, String> {
    if cfg!(windows) {
        windows_server(dir, on)
    } else {
        let path = crate::tools::pane_path();
        crate::tools::Lookup::native().find("llama-server", &path).ok_or_else(|| {
            format!(
                "llama-server is not on the PATH. Install llama.cpp, or name its llama-server as model.llamaServer in {}",
                crate::jarvis::config_path().display()
            )
        })
    }
}

/// The release's build in `<dir>/llama-<build>`. Both archives are checked, unpacked into a
/// scratch dir that is renamed into place whole, and deleted.
fn windows_server(dir: &Path, on: &dyn Fn(LlmSetup)) -> Result<PathBuf, String> {
    let home = dir.join(format!("llama-{LLAMA_BUILD}"));
    let exe = home.join("llama-server.exe");
    if exe.is_file() {
        return Ok(exe);
    }
    let zips = LLAMA_ZIPS.iter().map(|w| fetch(w, dir, on)).collect::<Result<Vec<_>, _>>()?;
    let scratch = dir.join(format!("llama-{LLAMA_BUILD}.unpacking"));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch).map_err(|e| format!("{}: {e}", scratch.display()))?;
    for zip in &zips {
        unzip(zip, &scratch)?;
    }
    if !scratch.join("llama-server.exe").is_file() {
        return Err(format!("{} holds no llama-server.exe", LLAMA_ZIPS[0].file));
    }
    let _ = std::fs::remove_dir_all(&home);
    std::fs::rename(&scratch, &home).map_err(|e| format!("{}: {e}", home.display()))?;
    for zip in &zips {
        let _ = std::fs::remove_file(zip);
    }
    Ok(exe)
}

/// Unpacks `zip` into `into` with the `tar` Windows ships (bsdtar, which reads zip), named by its
/// full path: Git's GNU tar, often first on the PATH, reads no zip.
fn unzip(zip: &Path, into: &Path) -> Result<(), String> {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let tar = root.join("System32").join("tar.exe");
    let out = crate::proc::command(&tar)
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(into)
        .output()
        .map_err(|e| format!("{}: {e}", tar.display()))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("unpacking {}: {}", zip.display(), String::from_utf8_lossy(&out.stderr).trim()))
    }
}

// ---------------------------------------------------------------------------------------
// The server

/// llama-server's arguments: the model on the GPU whole, flash attention off (it crashes these
/// runs on Windows, ggml-org/llama.cpp#30436), reasoning on with a budget of 64 tokens (#511),
/// and nothing listening beyond this machine.
pub fn server_args(files: &Files, port: u16) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec!["-m".into(), files.model.clone().into()];
    if let Some(mmproj) = &files.mmproj {
        args.extend(["--mmproj".into(), mmproj.clone().into()]);
    }
    for a in ["--host", "127.0.0.1", "--port", &port.to_string(), "--jinja", "-ngl", "999", "-c", "16384", "-fa", "off", "--reasoning-budget", "64"] {
        args.push(a.into());
    }
    args
}

/// A port no one listens on now, for the server to take.
fn free_port() -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("no free port: {e}"))?;
    listener.local_addr().map(|a| a.port()).map_err(|e| format!("no free port: {e}"))
}

/// The server this app runs: the child, where it listens, and what ties its life to the app's.
struct Server {
    child: Child,
    port: u16,
    vision: bool,
    /// Set once `/health` answered: before that a chat is refused.
    ready: bool,
    /// Which start this is, so a start that was stopped and replaced knows it.
    serial: u64,
    _tie: Tie,
}

impl Server {
    fn end(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static SERVER: Mutex<Option<Server>> = Mutex::new(None);
/// One `ensure` at a time: a second waits, then finds the first one's server running.
static SETUP: Mutex<()> = Mutex::new(());
static SERIAL: Mutex<u64> = Mutex::new(0);

/// Holds the server's life to the app's; see the module doc.
#[cfg(windows)]
struct Tie(windows_sys::Win32::Foundation::HANDLE);

// The job handle is only closed, from whichever thread drops it.
#[cfg(windows)]
unsafe impl Send for Tie {}

#[cfg(windows)]
impl Drop for Tie {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// Starts `cmd` in a job that kills it once the app's handle to the job closes. The handle is
/// never inheritable, so the server holds no handle to its own job.
#[cfg(windows)]
fn spawn_tied(mut cmd: std::process::Command) -> Result<(Child, Tie), String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(format!("llama-server: no job object ({})", std::io::Error::last_os_error()));
    }
    let tie = Tie(job);
    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let set = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if set == 0 {
        return Err(format!("llama-server: the job object took no limit ({})", std::io::Error::last_os_error()));
    }
    let mut child = cmd.spawn().map_err(|e| format!("llama-server could not start: {e}"))?;
    if unsafe { AssignProcessToJobObject(job, child.as_raw_handle() as _) } == 0 {
        let e = std::io::Error::last_os_error();
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("llama-server: it could not be tied to the app ({e}), so it was stopped"));
    }
    Ok((child, tie))
}

/// The thread that started the server, parked until this is dropped: Linux's parent-death
/// signal follows the starting thread, not the process.
#[cfg(unix)]
#[allow(dead_code)]
struct Tie(std::sync::mpsc::Sender<()>);

#[cfg(unix)]
fn spawn_tied(mut cmd: std::process::Command) -> Result<(Child, Tie), String> {
    #[cfg(target_os = "linux")]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    let (started, child) = std::sync::mpsc::channel();
    let (keep, parked) = std::sync::mpsc::channel::<()>();
    std::thread::Builder::new()
        .name("jarvis-llm".into())
        .spawn(move || {
            let _ = started.send(cmd.spawn());
            // Returns once `Tie` drops its sender: the server is stopped or no longer ours.
            let _ = parked.recv();
        })
        .map_err(|e| format!("llama-server: {e}"))?;
    let child = child.recv().map_err(|e| format!("llama-server: {e}"))?.map_err(|e| format!("llama-server could not start: {e}"))?;
    Ok((child, Tie(keep)))
}

/// The last lines the server wrote, for an error about it.
fn log_tail(path: &Path) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    lines[lines.len().saturating_sub(8)..].join("\n")
}

fn agent(timeout: Option<Duration>) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(5)))
        .timeout_global(timeout)
        .http_status_as_error(false)
        .build()
        .new_agent()
}

/// Gets the model running: what is missing is downloaded and checked, then llama-server starts
/// unless it already runs, and this returns once it answers `/health`.
pub fn ensure(on: &dyn Fn(LlmSetup)) -> Result<(), String> {
    let _one = lock(&SETUP);
    {
        let mut server = lock(&SERVER);
        if let Some(s) = server.as_mut() {
            if s.ready && matches!(s.child.try_wait(), Ok(None)) {
                on(LlmSetup::Ready { vision: s.vision });
                return Ok(());
            }
            if let Some(s) = server.take() {
                s.end();
            }
        }
    }
    let section = crate::jarvis::section("model")?;
    let files = files(&section, &crate::app_dir::home(), &models_dir(), &default_server, on)?;
    on(LlmSetup::Starting);
    let port = free_port()?;
    let log = server_log_path();
    if let Some(d) = log.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let out = std::fs::File::create(&log).map_err(|e| format!("{}: {e}", log.display()))?;
    let err = out.try_clone().map_err(|e| format!("{}: {e}", log.display()))?;
    let mut cmd = crate::proc::command(&files.server);
    cmd.args(server_args(&files, port)).stdin(std::process::Stdio::null()).stdout(out).stderr(err);
    if let Some(dir) = files.server.parent() {
        cmd.current_dir(dir);
    }
    let (child, tie) = spawn_tied(cmd)?;
    let serial = {
        let mut n = lock(&SERIAL);
        *n += 1;
        *n
    };
    let vision = files.mmproj.is_some();
    *lock(&SERVER) = Some(Server { child, port, vision, ready: false, serial, _tie: tie });
    log::info!("jarvis: llama-server starting (vision {vision})");

    let health = agent(Some(Duration::from_secs(2)));
    let started = Instant::now();
    loop {
        {
            let mut server = lock(&SERVER);
            let Some(s) = server.as_mut().filter(|s| s.serial == serial) else {
                return Err("llama-server was stopped before it was ready".into());
            };
            if let Ok(Some(status)) = s.child.try_wait() {
                server.take();
                return Err(format!("llama-server exited while starting ({status}):\n{}", log_tail(&log)));
            }
        }
        if let Ok(r) = health.get(&format!("http://127.0.0.1:{port}/health")).call() {
            if r.status().as_u16() == 200 {
                break;
            }
        }
        if started.elapsed() > START_TIMEOUT {
            if let Some(s) = lock(&SERVER).take() {
                s.end();
            }
            return Err(format!("llama-server did not answer within {} s, so it was stopped:\n{}", START_TIMEOUT.as_secs(), log_tail(&log)));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    match lock(&SERVER).as_mut().filter(|s| s.serial == serial) {
        Some(s) => s.ready = true,
        None => return Err("llama-server was stopped before it was ready".into()),
    }
    log::info!("jarvis: llama-server ready in {:.1} s", started.elapsed().as_secs_f32());
    on(LlmSetup::Ready { vision });
    Ok(())
}

/// Stops the server, if one runs, freeing its VRAM.
pub fn stop() {
    if let Some(s) = lock(&SERVER).take() {
        s.end();
        log::info!("jarvis: llama-server stopped");
    }
}

// ---------------------------------------------------------------------------------------
// Chat

/// Reads an SSE body, handing each `data:` object to `send` parsed, in order, until `[DONE]`.
/// llama-server reports a failure mid-stream as an `error:` line, which is the error here; a
/// stream that ends without `[DONE]` was cut and is one too.
pub fn read_stream(body: impl BufRead, mut send: impl FnMut(serde_json::Value) -> Result<(), String>) -> Result<(), String> {
    for line in body.lines() {
        let line = line.map_err(|e| format!("llama-server: the stream broke: {e}"))?;
        let line = line.trim_end_matches('\r');
        if let Some(data) = field(line, "data") {
            if data == "[DONE]" {
                return Ok(());
            }
            let value = serde_json::from_str(data).map_err(|e| format!("llama-server sent a chunk that is not JSON ({e}): {data}"))?;
            send(value)?;
        } else if let Some(error) = field(line, "error") {
            return Err(format!("llama-server: {}", error_message(error)));
        }
        // Blank lines end an event; `:` comments, `event:` and `id:` carry nothing for the panel.
    }
    Err("llama-server: the stream ended before [DONE]".into())
}

/// The value of an SSE `name:` line, without the one space after the colon.
fn field<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let rest = line.strip_prefix(name)?.strip_prefix(':')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

/// What an error body says: `{"error": {"message": …}}`, as llama-server and OpenAI send it, or
/// the text itself.
fn error_message(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| {
            let e = v.get("error").unwrap_or(&v);
            e.get("message").and_then(|m| m.as_str()).map(str::to_string).or_else(|| e.as_str().map(str::to_string))
        })
        .unwrap_or_else(|| text.trim().to_string())
}

/// POSTs `body` as given to `<base>/v1/chat/completions` and hands `send` every object the
/// answer streams. An HTTP error is the error, with what the server said. A body that asked for
/// no stream gets its one answer handed over whole.
pub fn chat_at(base: &str, body: &serde_json::Value, send: impl FnMut(serde_json::Value) -> Result<(), String>) -> Result<(), String> {
    let text = serde_json::to_string(body).map_err(|e| e.to_string())?;
    let response = agent(None)
        .post(&format!("{base}/v1/chat/completions"))
        .header("Content-Type", "application/json")
        .send(text)
        .map_err(|e| format!("llama-server: {e}"))?;
    let status = response.status().as_u16();
    let sse = response.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|t| t.starts_with("text/event-stream"));
    let reader = BufReader::new(response.into_body().into_with_config().limit(u64::MAX).reader());
    if !(200..300).contains(&status) {
        let text: String = reader.lines().map_while(Result::ok).collect::<Vec<_>>().join("\n");
        return Err(format!("llama-server answered HTTP {status}: {}", error_message(&text)));
    }
    if sse {
        return read_stream(reader, send);
    }
    let mut send = send;
    let value = serde_json::from_reader(reader).map_err(|e| format!("llama-server sent an answer that is not JSON: {e}"))?;
    send(value)
}

/// `chat_at` the running server.
pub fn chat(body: &serde_json::Value, send: impl FnMut(serde_json::Value) -> Result<(), String>) -> Result<(), String> {
    let port = lock(&SERVER).as_mut().and_then(|s| (s.ready && matches!(s.child.try_wait(), Ok(None))).then_some(s.port));
    let port = port.ok_or("the model is not running: jarvis_llm_ensure starts it")?;
    chat_at(&format!("http://127.0.0.1:{port}"), body, send)
}

// ---------------------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn jarvis_llm_ensure(on: Channel<LlmSetup>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure(&|s| {
            let _ = on.send(s);
        })
    })
    .await
    .map_err(|e| format!("jarvis: {e}"))?
}

#[tauri::command]
pub async fn jarvis_llm_chat(body: serde_json::Value, on: Channel<serde_json::Value>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || chat(&body, |chunk| on.send(chunk).map_err(|e| format!("jarvis: the panel went away ({e})"))))
        .await
        .map_err(|e| format!("jarvis: {e}"))?
}

#[tauri::command]
pub async fn jarvis_llm_stop() {
    let _ = tauri::async_runtime::spawn_blocking(stop).await;
}

/// Stops the server when the app exits normally; see the module doc for the other ways out.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("jarvis-llm")
        .on_event(|_, event| {
            if let tauri::RunEvent::Exit = event {
                stop();
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Read;
    use std::sync::{Arc, Mutex};

    #[test]
    fn setup_serializes_as_the_client_types_it() {
        let cases = [
            (LlmSetup::Download { file: "m.gguf".into(), done: 5, total: 9 }, json!({ "kind": "download", "file": "m.gguf", "done": 5, "total": 9 })),
            (LlmSetup::Verifying { file: "m.gguf".into() }, json!({ "kind": "verifying", "file": "m.gguf" })),
            (LlmSetup::Starting, json!({ "kind": "starting" })),
            (LlmSetup::Ready { vision: true }, json!({ "kind": "ready", "vision": true })),
        ];
        for (setup, want) in cases {
            assert_eq!(serde_json::to_value(&setup).unwrap(), want);
        }
        // The kinds `src/jarvis/client.ts` names, so a rename on either side fails here.
        let client = include_str!("../../src/jarvis/client.ts");
        for kind in ["'download'", "'verifying'", "'starting'", "'ready'"] {
            assert!(client.contains(&format!("kind: {kind}")), "{kind}");
        }
    }

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn body(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 13 % 251) as u8).collect()
    }

    /// A stand-in for Hugging Face: serves `body`, honouring `Range`. The first connection stops
    /// after `cut` bytes and closes; the `Range` each connection asked for is recorded.
    fn serve(body: Vec<u8>, cut: Option<usize>) -> (String, Arc<Mutex<Vec<Option<String>>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let asked = Arc::new(Mutex::new(Vec::new()));
        let seen = asked.clone();
        std::thread::spawn(move || {
            for (n, conn) in listener.incoming().enumerate() {
                let Ok(mut conn) = conn else { return };
                let mut reader = BufReader::new(conn.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = Some(v.trim().trim_end_matches('-').to_string());
                    }
                }
                lock(&seen).push(range.clone());
                let from: usize = range.as_deref().map_or(0, |r| r.parse().unwrap());
                let rest = &body[from..];
                let head = if from > 0 {
                    format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{}\r\n\r\n", rest.len(), body.len() - 1, body.len())
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", rest.len())
                };
                let send = match cut {
                    Some(c) if n == 0 => &rest[..c],
                    _ => rest,
                };
                let _ = conn.write_all(head.as_bytes()).and_then(|_| conn.write_all(send)).and_then(|_| conn.flush());
                // Dropping the connection mid-body is the cut.
            }
        });
        (url, asked)
    }

    fn events() -> (Arc<Mutex<Vec<LlmSetup>>>, impl Fn(LlmSetup)) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        (seen, move |e| lock(&s).push(e))
    }

    #[test]
    fn a_cut_download_resumes_and_lands_once_its_checksum_matches() {
        let data = body(300_000);
        let (url, asked) = serve(data.clone(), Some(100_000));
        let dir = crate::testutil::temp_dir("jarvis-llm-fetch");
        let sum = sha(&data);
        let want = Want { file: "m.gguf", url: &url, bytes: data.len() as u64, sha256: &sum };
        let (seen, on) = events();
        let path = fetch(&want, &dir, &on).unwrap();
        assert_eq!(path, dir.join("m.gguf"));
        assert_eq!(std::fs::read(&path).unwrap(), data);
        // The cut connection was followed by one asking for the rest, not for byte 0.
        assert_eq!(lock(&asked).clone(), vec![None, Some("100000".to_string())]);
        assert!(!dir.join("m.gguf.download").exists() && !dir.join("m.gguf.download.part").exists());
        let seen = lock(&seen).clone();
        assert_eq!(seen.first(), Some(&LlmSetup::Download { file: "m.gguf".into(), done: 0, total: 300_000 }));
        assert_eq!(seen.last(), Some(&LlmSetup::Verifying { file: "m.gguf".into() }));

        // A file in place is used as it is: nothing is asked of the server again.
        fetch(&want, &dir, &|_| {}).unwrap();
        assert_eq!(lock(&asked).len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_download_whose_checksum_is_wrong_is_deleted_and_never_used() {
        let data = body(50_000);
        let (url, _) = serve(data.clone(), None);
        let dir = crate::testutil::temp_dir("jarvis-llm-bad");
        let wrong = sha(b"something else");
        let want = Want { file: "m.gguf", url: &url, bytes: data.len() as u64, sha256: &wrong };
        let err = fetch(&want, &dir, &|_| {}).unwrap_err();
        assert!(err.contains("sha256") && err.contains(&wrong) && err.contains("deleted"), "{err}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "nothing of it is left");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_whole_file_left_unchecked_by_an_earlier_run_is_checked_before_it_lands() {
        let data = body(20_000);
        let dir = crate::testutil::temp_dir("jarvis-llm-staged");
        std::fs::write(dir.join("m.gguf.download"), &data).unwrap();
        let sum = sha(&data);
        // No server: the file is already whole, so only the checksum runs.
        let want = Want { file: "m.gguf", url: "http://127.0.0.1:9/none", bytes: data.len() as u64, sha256: &sum };
        let (seen, on) = events();
        fetch(&want, &dir, &on).unwrap();
        assert_eq!(lock(&seen).clone(), vec![LlmSetup::Verifying { file: "m.gguf".into() }]);
        assert_eq!(std::fs::read(dir.join("m.gguf")).unwrap(), data);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_config_names_files_on_disk_and_skips_their_download() {
        let home = crate::testutil::temp_dir("jarvis-llm-home");
        std::fs::create_dir_all(home.join("llama")).unwrap();
        std::fs::write(home.join("llama").join("llama-server"), "").unwrap();
        std::fs::write(home.join("m.gguf"), "").unwrap();
        let dir = home.join("models");
        let no_server = |_: &Path, _: &dyn Fn(LlmSetup)| -> Result<PathBuf, String> { panic!("the config names the server") };
        let section = json!({ "llamaServer": "~/llama/llama-server", "model": "~/m.gguf", "mmproj": false });
        let got = files(&section, &home, &dir, &no_server, &|_| panic!("nothing downloads")).unwrap();
        assert_eq!(got, Files { server: home.join("llama").join("llama-server"), model: home.join("m.gguf"), mmproj: None });

        let missing = json!({ "llamaServer": "~/llama/llama-server", "model": "~/absent.gguf" });
        let err = files(&missing, &home, &dir, &no_server, &|_| {}).unwrap_err();
        assert!(err.contains("model.model") && err.contains("absent.gguf"), "{err}");
        let wrong = json!({ "model": 7 });
        assert!(files(&wrong, &home, &dir, &no_server, &|_| {}).unwrap_err().contains("must be a path"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_server_takes_the_model_the_projector_and_the_settings_of_the_benchmark() {
        let files = Files { server: "llama-server".into(), model: "/m/model.gguf".into(), mmproj: Some("/m/mmproj.gguf".into()) };
        let args: Vec<String> = server_args(&files, 41234).iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(
            args,
            [
                "-m", "/m/model.gguf", "--mmproj", "/m/mmproj.gguf", "--host", "127.0.0.1", "--port", "41234", "--jinja", "-ngl", "999", "-c", "16384", "-fa", "off",
                "--reasoning-budget", "64"
            ]
        );
        let text_only = Files { mmproj: None, ..files };
        assert!(!server_args(&text_only, 1).iter().any(|a| a == "--mmproj"));
    }

    #[test]
    fn the_stream_hands_over_every_data_object_in_order_until_done() {
        let sse = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n\
                   : a comment\r\n\
                   data: {\"choices\":[{\"delta\":{\"content\":\"Oi\"}}]}\r\n\r\n\
                   event: message\n\
                   data:{\"choices\":[{\"delta\":{\"content\":\", tudo\"}}]}\n\n\
                   data: [DONE]\n\n\
                   data: {\"after\":\"done\"}\n\n";
        let mut got = Vec::new();
        read_stream(sse.as_bytes(), |v| {
            got.push(v);
            Ok(())
        })
        .unwrap();
        assert_eq!(got.len(), 3);
        assert_eq!(got[0]["choices"][0]["delta"]["role"], "assistant");
        assert_eq!(got[1]["choices"][0]["delta"]["content"], "Oi");
        assert_eq!(got[2]["choices"][0]["delta"]["content"], ", tudo");
    }

    #[test]
    fn a_stream_that_fails_or_is_cut_is_an_error() {
        let failed = "data: {\"a\":1}\n\nerror: {\"error\":{\"code\":500,\"message\":\"context full\"}}\n\n";
        let mut n = 0;
        let err = read_stream(failed.as_bytes(), |_| {
            n += 1;
            Ok(())
        })
        .unwrap_err();
        assert_eq!((n, err.as_str()), (1, "llama-server: context full"));
        assert!(read_stream("data: {\"a\":1}\n\n".as_bytes(), |_| Ok(())).unwrap_err().contains("before [DONE]"));
        assert!(read_stream("data: {nope\n\n".as_bytes(), |_| Ok(())).unwrap_err().contains("not JSON"));
        // The panel going away ends the read.
        let err = read_stream("data: {}\n\ndata: {}\n\ndata: [DONE]\n\n".as_bytes(), |_| Err("gone".into())).unwrap_err();
        assert_eq!(err, "gone");
    }

    /// A stand-in llama-server for one request: answers with `status`, `content_type` and `body`,
    /// and hands back what it was sent.
    fn one_answer(status: &str, content_type: &str, body: &str) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let (tx, rx) = std::sync::mpsc::channel();
        let answer = format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            let (mut head, mut len) = (String::new(), 0);
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap();
                }
                if line == "\r\n" {
                    break;
                }
                head.push_str(&line);
            }
            let mut sent = vec![0; len];
            reader.read_exact(&mut sent).unwrap();
            let _ = tx.send(format!("{head}\n{}", String::from_utf8(sent).unwrap()));
            let _ = conn.write_all(answer.as_bytes());
        });
        (base, rx)
    }

    #[test]
    fn a_chat_posts_the_body_as_given_and_streams_the_answer_back() {
        let sse = "data: {\"n\":1}\n\ndata: {\"n\":2}\n\ndata: [DONE]\n\n";
        let (base, sent) = one_answer("200 OK", "text/event-stream", sse);
        let body = json!({ "messages": [{ "role": "user", "content": "oi" }], "stream": true, "tools": [] });
        let mut got = Vec::new();
        chat_at(&base, &body, |v| {
            got.push(v["n"].as_i64().unwrap());
            Ok(())
        })
        .unwrap();
        assert_eq!(got, [1, 2]);
        let sent = sent.recv().unwrap();
        assert!(sent.starts_with("POST /v1/chat/completions "), "{sent}");
        assert_eq!(serde_json::from_str::<serde_json::Value>(sent.split_once("\n\n").unwrap().1).unwrap(), body);
    }

    #[test]
    fn an_http_error_is_the_chat_error_with_what_the_server_said() {
        let (base, _) = one_answer("400 Bad Request", "application/json", "{\"error\":{\"code\":400,\"message\":\"tools are not supported\"}}");
        let err = chat_at(&base, &json!({}), |_| panic!("no chunk")).unwrap_err();
        assert_eq!(err, "llama-server answered HTTP 400: tools are not supported");
    }

    #[test]
    fn an_answer_that_was_not_streamed_is_handed_over_whole() {
        let (base, _) = one_answer("200 OK", "application/json; charset=utf-8", "{\"choices\":[]}");
        let mut got = Vec::new();
        chat_at(&base, &json!({ "stream": false }), |v| {
            got.push(v);
            Ok(())
        })
        .unwrap();
        assert_eq!(got, [json!({ "choices": [] })]);
    }

    /// The live check of #505 on the machine with the model: `jarvis.json`'s `model` section,
    /// one chat, and with `JARVIS_LLM_LIVE_HOLD` set the process waits to be killed, so the
    /// server can be seen to die with it.
    #[test]
    #[ignore = "live: runs the model, and downloads what the config does not name"]
    fn live_ensure_and_chat() {
        let started = Instant::now();
        ensure(&|s| match &s {
            LlmSetup::Download { done, total, .. } if done % (100 << 20) >= 1 << 20 && done != total => {}
            _ => eprintln!("{:>6.1}s setup {}", started.elapsed().as_secs_f32(), serde_json::to_string(&s).unwrap()),
        })
        .unwrap();
        let pid = lock(&SERVER).as_ref().unwrap().child.id();
        eprintln!("llama-server pid {pid}");
        let body = json!({
            "messages": [{ "role": "user", "content": "Diga oi em uma frase curta." }],
            "stream": true, "temperature": 0, "max_tokens": 64,
            "chat_template_kwargs": { "enable_thinking": false, "thinking": false },
        });
        let (asked, mut chunks, mut text) = (Instant::now(), 0, String::new());
        chat(&body, |v| {
            chunks += 1;
            text.push_str(v["choices"][0]["delta"]["content"].as_str().unwrap_or(""));
            Ok(())
        })
        .unwrap();
        eprintln!("chat: {chunks} chunks in {:.2}s: {text:?}", asked.elapsed().as_secs_f32());
        assert!(!text.trim().is_empty());
        if std::env::var_os("JARVIS_LLM_LIVE_HOLD").is_some() {
            eprintln!("held, pid {}", std::process::id());
            loop {
                std::thread::sleep(Duration::from_secs(60));
            }
        }
        stop();
    }

    #[test]
    fn a_chat_with_no_server_running_says_how_to_start_one() {
        stop();
        assert!(chat(&json!({}), |_| Ok(())).unwrap_err().contains("jarvis_llm_ensure"));
    }
}

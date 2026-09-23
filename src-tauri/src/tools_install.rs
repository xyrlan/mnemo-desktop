//! Installs mnemo on a machine that has neither Python nor `mnemo`, then runs `mnemo init`.
//!
//! Each `xyrlan/mnemo` release ships `mnemo-<tag>-<target>.tar.gz` for four targets, each with a
//! `.sha256` beside it. The archive holds one top-level `mnemo/` directory, a PyInstaller onedir
//! bundle: the executable (`mnemo.exe` on Windows) only runs next to its `_internal/`. That
//! directory's contents become `crate::tools::managed_dir("mnemo")`, so the executable sits
//! directly inside it.
//!
//! Nothing unverified runs: an archive is unpacked only after its checksum matches, and a
//! release without one installs nothing. Nothing half-written resolves either: the archive is
//! unpacked into a scratch directory beside the managed one and renamed into place whole, and
//! an earlier copy is renamed aside first and put back if that fails. One install runs at a
//! time; a second click while one is running is refused.
//!
//! Progress goes out as `tools-install` events, one line each, `mnemo init`'s own output
//! included, so the setup screen can show where an install got to and why it stopped.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

pub const EVENT: &str = "tools-install";

const RELEASE_API: &str = "https://api.github.com/repos/xyrlan/mnemo/releases/latest";
/// An archive is ~10 MB; anything past this is not a mnemo release.
const MAX_ARCHIVE: u64 = 256 << 20;
/// Scratch directories are named with this prefix beside the managed one, so a crash's leftovers
/// are recognisable and never where `mnemo` resolves.
const SCRATCH_PREFIX: &str = ".mnemo-install-";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct InstallLine {
    pub tool: String,
    pub message: String,
}

/// The release build that runs on `os`/`arch`, named as `std::env::consts` names them.
pub fn target(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64"),
        ("linux", "x86_64") => Some("linux-x64"),
        // There is no arm64 Windows build; Windows on Arm runs x64 programs itself.
        ("windows", "x86_64" | "aarch64") => Some("win-x64"),
        _ => None,
    }
}

pub fn exe_name(os: &str) -> &'static str {
    if os == "windows" {
        "mnemo.exe"
    } else {
        "mnemo"
    }
}

#[derive(Debug, PartialEq)]
pub struct Release {
    pub tag: String,
    pub asset: String,
    pub archive_url: String,
    pub checksum_url: String,
}

/// The archive and checksum for `target` in a GitHub `releases/latest` response. A release
/// without the checksum is refused here, before anything is downloaded.
pub fn pick_release(json: &str, target: &str) -> Result<Release, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("GitHub sent a release mnemo-desktop cannot read ({e})."))?;
    let tag = v["tag_name"].as_str().ok_or("GitHub sent a release without a tag.")?.to_string();
    let asset = format!("mnemo-{tag}-{target}.tar.gz");
    let url = |name: &str| {
        v["assets"].as_array().into_iter().flatten().find(|a| a["name"] == name).and_then(|a| a["browser_download_url"].as_str()).map(str::to_string)
    };
    let archive_url = url(&asset).ok_or(format!("The latest mnemo release ({tag}) has no build for {target}."))?;
    let checksum_url = url(&format!("{asset}.sha256")).ok_or(format!("The mnemo {tag} release has no checksum for {asset}, so nothing was installed."))?;
    Ok(Release { tag, asset, archive_url, checksum_url })
}

/// The digest in a `.sha256` file (`<hex>  <name>`), lowercased; `None` if it has none.
pub fn parse_checksum(text: &str) -> Option<String> {
    let first = text.split_whitespace().next()?;
    (first.len() == 64 && first.bytes().all(|b| b.is_ascii_hexdigit())).then(|| first.to_ascii_lowercase())
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Checks `archive` against `checksum` (a `.sha256` file's text, `None` when there was none),
/// unpacks it under `scratch` and moves its `mnemo/` into `dest`. `scratch` must be on the same
/// filesystem as `dest` (a sibling is), so both moves are renames. On any failure `dest` is what
/// it was before: an earlier install stays, and no install stays absent.
pub fn install_archive(archive: &Path, checksum: Option<&str>, dest: &Path, exe: &str, scratch: &Path, say: &dyn Fn(String)) -> Result<(), String> {
    let name = archive.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let expected = checksum.and_then(parse_checksum).ok_or(format!("There is no checksum for {name}, so nothing was installed."))?;
    say("Verifying the checksum…".into());
    let actual = sha256_file(archive).map_err(|e| format!("Could not read the downloaded {name}: {e}"))?;
    if actual != expected {
        return Err(format!("{name} does not match its checksum, so nothing was installed. Try again; if it keeps happening, report it at https://github.com/xyrlan/mnemo/issues."));
    }
    say("Checksum matches. Unpacking…".into());
    let unpacked = scratch.join("unpack");
    let file = std::fs::File::open(archive).map_err(|e| format!("Could not read the downloaded {name}: {e}"))?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    tar.set_preserve_permissions(true);
    // `unpack` refuses entries that would land outside `unpacked`.
    tar.unpack(&unpacked).map_err(|e| format!("Could not unpack {name}: {e}"))?;
    let staged = unpacked.join("mnemo");
    if !staged.join(exe).is_file() || !staged.join("_internal").is_dir() {
        return Err(format!("{name} does not hold mnemo/{exe} next to mnemo/_internal/, so nothing was installed."));
    }
    swap_in(&staged, dest, &scratch.join("previous"))
}

/// Renames `staged` to `dest`, moving an existing `dest` to `aside` first and back if the second
/// rename fails. `mnemo` is briefly absent in between, never partial.
fn swap_in(staged: &Path, dest: &Path, aside: &Path) -> Result<(), String> {
    let had = std::fs::symlink_metadata(dest).is_ok();
    if had {
        std::fs::rename(dest, aside).map_err(|e| {
            format!("Could not replace the mnemo in {} ({e}). If mnemo is running, close it and try again.", dest.display())
        })?;
    }
    if let Err(e) = std::fs::rename(staged, dest) {
        if had {
            let _ = std::fs::rename(aside, dest);
        }
        return Err(format!("Could not put mnemo in {} ({e}).", dest.display()));
    }
    Ok(())
}

/// Scratch directories an interrupted install left beside `dest`.
fn clear_leftovers(parent: &Path) {
    for entry in std::fs::read_dir(parent).into_iter().flatten().flatten() {
        if entry.file_name().to_string_lossy().starts_with(SCRATCH_PREFIX) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn scratch_dir(parent: &Path) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    parent.join(format!("{SCRATCH_PREFIX}{}-{n}", std::process::id()))
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_body(Some(Duration::from_secs(600)))
        .build()
        .new_agent()
}

/// A network failure as a sentence: what could not be fetched, and what to do about it.
fn net_error(what: &str, e: ureq::Error) -> String {
    match e {
        ureq::Error::StatusCode(403 | 429) => format!("GitHub refused to send {what} for now (rate limit). Try again in a few minutes."),
        ureq::Error::StatusCode(code) => format!("GitHub answered {code} for {what}. Try again later."),
        e => format!("Could not download {what} ({e}). Check the internet connection and try again."),
    }
}

fn download(agent: &ureq::Agent, url: &str, to: &Path, what: &str) -> Result<u64, String> {
    let response = agent.get(url).call().map_err(|e| net_error(what, e))?;
    let mut body = response.into_body().into_with_config().limit(MAX_ARCHIVE).reader();
    let mut file = std::fs::File::create(to).map_err(|e| format!("Could not write {}: {e}", to.display()))?;
    let mut chunk = vec![0u8; 1 << 16];
    let mut done = 0u64;
    loop {
        let n = body.read(&mut chunk).map_err(|e| format!("The download of {what} broke off ({e}). Try again."))?;
        if n == 0 {
            break;
        }
        file.write_all(&chunk[..n]).map_err(|e| format!("Could not write {}: {e}", to.display()))?;
        done += n as u64;
    }
    file.flush().map_err(|e| format!("Could not write {}: {e}", to.display()))?;
    Ok(done)
}

/// Downloads the latest release for `target` and installs it in `dest`. Returns the tag.
pub fn fetch_and_install(dest: &Path, target: &str, exe: &str, say: &dyn Fn(String)) -> Result<String, String> {
    let parent = dest.parent().ok_or(format!("{} has no parent directory.", dest.display()))?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    clear_leftovers(parent);

    say("Looking up the latest mnemo release…".into());
    let agent = agent();
    let json = agent
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| net_error("the latest mnemo release", e))?
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Could not read the latest mnemo release from GitHub ({e}). Try again."))?;
    let release = pick_release(&json, target)?;

    let scratch = scratch_dir(parent);
    std::fs::create_dir_all(&scratch).map_err(|e| format!("Could not create {}: {e}", scratch.display()))?;
    let result = (|| {
        say(format!("Downloading {}…", release.asset));
        let archive = scratch.join(&release.asset);
        let bytes = download(&agent, &release.archive_url, &archive, &release.asset)?;
        say(format!("Downloaded {:.1} MB.", bytes as f64 / 1e6));
        let checksum = scratch.join(format!("{}.sha256", release.asset));
        let checksum = match download(&agent, &release.checksum_url, &checksum, "its checksum") {
            Ok(_) => std::fs::read_to_string(&checksum).ok(),
            Err(e) => {
                say(e);
                None
            }
        };
        install_archive(&archive, checksum.as_deref(), dest, exe, &scratch, say)
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    result?;
    Ok(release.tag)
}

/// Runs `mnemo init --yes` from the home directory, saying each line it prints. `Err` names the
/// exit and the last thing it said.
fn run_init(exe: &Path, say: &(dyn Fn(String) + Sync)) -> Result<(), String> {
    say("Running mnemo init…".into());
    let mut cmd = crate::proc::command(exe);
    cmd.args(["init", "--yes"])
        .env("PATH", crate::mission::login_path())
        // A pipe on Windows gets the ANSI code page, and mnemo prints emoji.
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        cmd.current_dir(home);
    }
    let mut child = cmd.spawn().map_err(|e| format!("mnemo init could not start ({e})."))?;
    let (out, err) = (child.stdout.take(), child.stderr.take());
    let last = std::sync::Mutex::new(String::new());
    let pump = |from: Box<dyn Read + Send>| {
        let mut reader = BufReader::new(from);
        let mut buf = Vec::new();
        while matches!(reader.read_until(b'\n', &mut buf), Ok(n) if n > 0) {
            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
            buf.clear();
            if !line.trim().is_empty() {
                *last.lock().unwrap() = line.clone();
                say(line);
            }
        }
    };
    std::thread::scope(|s| {
        if let Some(o) = out {
            s.spawn(|| pump(Box::new(o)));
        }
        if let Some(e) = err {
            s.spawn(|| pump(Box::new(e)));
        }
    });
    let status = child.wait().map_err(|e| format!("mnemo init did not finish ({e})."))?;
    if status.success() {
        return Ok(());
    }
    let code = status.code().map_or("a signal".to_string(), |c| format!("code {c}"));
    let last = last.into_inner().unwrap();
    Err(if last.is_empty() { format!("mnemo init stopped with {code}.") } else { format!("mnemo init stopped with {code}: {last}") })
}

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Held for the length of one install; a second `claim` meanwhile is refused.
#[derive(Debug)]
struct Running;

impl Running {
    fn claim() -> Result<Running, String> {
        if RUNNING.swap(true, Ordering::SeqCst) {
            return Err("mnemo is already being installed. Wait for that install to finish.".into());
        }
        Ok(Running)
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

/// The whole install: the latest release into `managed_dir("mnemo")`, a PATH refresh, then
/// `mnemo init`. `Ok` is the installed tag.
pub fn install(say: &(dyn Fn(String) + Sync)) -> Result<String, String> {
    let _running = Running::claim()?;
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let target = target(os, arch).ok_or(format!("mnemo has no build for this system ({os} on {arch})."))?;
    let exe = exe_name(os);
    let dest = crate::tools::managed_dir("mnemo");
    let tag = fetch_and_install(&dest, target, exe, say)?;
    crate::tools::refresh();
    say(format!("mnemo {tag} is installed in {}.", dest.display()));
    run_init(&dest.join(exe), say).map_err(|e| format!("mnemo {tag} is installed, but {e}"))?;
    say(format!("mnemo {tag} is ready."));
    Ok(tag)
}

/// Installs the latest mnemo, streaming `tools-install` lines. `Ok` is the installed tag.
#[tauri::command]
pub async fn tools_install_mnemo(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        install(&|message| {
            let _ = app.emit(EVENT, InstallLine { tool: "mnemo".into(), message });
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;

    enum Entry<'a> {
        File(&'a str, &'a [u8]),
        Link(&'a str, &'a str),
    }

    /// A `.tar.gz` of `entries` at `dir/name`, and its `.sha256` text.
    fn archive(dir: &Path, name: &str, entries: &[Entry]) -> (PathBuf, String) {
        let path = dir.join(name);
        let gz = flate2::write::GzEncoder::new(std::fs::File::create(&path).unwrap(), flate2::Compression::fast());
        let mut b = tar::Builder::new(gz);
        for e in entries {
            let mut h = tar::Header::new_gnu();
            match e {
                Entry::File(p, data) => {
                    h.set_size(data.len() as u64);
                    h.set_mode(0o755);
                    h.set_entry_type(tar::EntryType::Regular);
                    b.append_data(&mut h, p, *data).unwrap();
                }
                Entry::Link(p, to) => {
                    h.set_size(0);
                    h.set_mode(0o777);
                    h.set_entry_type(tar::EntryType::Symlink);
                    b.append_link(&mut h, p, to).unwrap();
                }
            }
        }
        b.into_inner().unwrap().finish().unwrap();
        let sum = format!("{}  {name}\n", sha256_file(&path).unwrap());
        (path, sum)
    }

    fn quiet(_: String) {}

    /// An earlier install at `dest`, recognisable by its marker.
    fn earlier_install(dest: &Path) {
        std::fs::create_dir_all(dest.join("_internal")).unwrap();
        std::fs::write(dest.join("mnemo"), b"old").unwrap();
        std::fs::write(dest.join("_internal/marker"), b"old").unwrap();
    }

    fn is_earlier_install(dest: &Path) -> bool {
        std::fs::read(dest.join("mnemo")).ok().as_deref() == Some(&b"old"[..]) && dest.join("_internal/marker").is_file()
    }

    #[test]
    fn the_windows_layout_puts_mnemo_exe_next_to_internal_in_the_managed_dir() {
        let root = temp_dir("mnemo-install-win");
        let (arc, sum) = archive(
            &root,
            "mnemo-v1.6.0-win-x64.tar.gz",
            &[
                Entry::File("mnemo/mnemo.exe", b"MZ"),
                Entry::File("mnemo/_internal/python312.dll", b"dll"),
                Entry::File("mnemo/_internal/base_library.zip", b"zip"),
            ],
        );
        let dest = root.join("tools/mnemo");
        let scratch = root.join("tools/.mnemo-install-t");
        install_archive(&arc, Some(&sum), &dest, exe_name("windows"), &scratch, &quiet).unwrap();
        assert_eq!(std::fs::read(dest.join("mnemo.exe")).unwrap(), b"MZ");
        assert!(dest.join("_internal/python312.dll").is_file());
        assert!(!dest.join("mnemo").exists(), "the archive's top-level mnemo/ is the managed dir itself");
    }

    #[test]
    fn a_missing_checksum_installs_nothing_and_keeps_the_earlier_install() {
        let root = temp_dir("mnemo-install-nosum");
        let (arc, _) = archive(&root, "a.tar.gz", &[Entry::File("mnemo/mnemo", b"new"), Entry::File("mnemo/_internal/x", b"x")]);
        let dest = root.join("tools/mnemo");
        earlier_install(&dest);
        let scratch = root.join("tools/.mnemo-install-t");
        for sum in [None, Some(""), Some("not a digest  a.tar.gz")] {
            let err = install_archive(&arc, sum, &dest, "mnemo", &scratch, &quiet).unwrap_err();
            assert!(err.contains("no checksum"), "{err}");
            assert!(is_earlier_install(&dest));
            assert!(!scratch.join("unpack").exists(), "nothing was unpacked");
        }
    }

    #[test]
    fn a_checksum_mismatch_installs_nothing_and_keeps_the_earlier_install() {
        let root = temp_dir("mnemo-install-badsum");
        let (arc, _) = archive(&root, "a.tar.gz", &[Entry::File("mnemo/mnemo", b"new"), Entry::File("mnemo/_internal/x", b"x")]);
        let dest = root.join("tools/mnemo");
        earlier_install(&dest);
        let scratch = root.join("tools/.mnemo-install-t");
        let wrong = format!("{}  a.tar.gz\n", "0".repeat(64));
        let err = install_archive(&arc, Some(&wrong), &dest, "mnemo", &scratch, &quiet).unwrap_err();
        assert!(err.contains("does not match its checksum"), "{err}");
        assert!(is_earlier_install(&dest));
        assert!(!scratch.join("unpack").exists(), "nothing was unpacked");
    }

    #[test]
    fn a_missing_checksum_asset_is_refused_before_downloading() {
        let json = r#"{"tag_name":"v1.6.0","assets":[
            {"name":"mnemo-v1.6.0-win-x64.tar.gz","browser_download_url":"https://example/a"}]}"#;
        let err = pick_release(json, "win-x64").unwrap_err();
        assert!(err.contains("no checksum"), "{err}");
    }

    #[test]
    fn a_reinstall_replaces_the_earlier_copy_whole() {
        let root = temp_dir("mnemo-install-again");
        let (arc, sum) = archive(&root, "a.tar.gz", &[Entry::File("mnemo/mnemo", b"new"), Entry::File("mnemo/_internal/lib", b"lib")]);
        let dest = root.join("tools/mnemo");
        earlier_install(&dest);
        let scratch = root.join("tools/.mnemo-install-t");
        install_archive(&arc, Some(&sum), &dest, "mnemo", &scratch, &quiet).unwrap();
        assert_eq!(std::fs::read(dest.join("mnemo")).unwrap(), b"new");
        assert!(dest.join("_internal/lib").is_file());
        assert!(!dest.join("_internal/marker").exists(), "no file of the earlier copy is mixed in");
    }

    #[test]
    fn an_archive_without_the_bundle_layout_installs_nothing() {
        let root = temp_dir("mnemo-install-layout");
        // The executable without its `_internal/` cannot run.
        let (arc, sum) = archive(&root, "a.tar.gz", &[Entry::File("mnemo/mnemo", b"new")]);
        let dest = root.join("tools/mnemo");
        earlier_install(&dest);
        let scratch = root.join("tools/.mnemo-install-t");
        let err = install_archive(&arc, Some(&sum), &dest, "mnemo", &scratch, &quiet).unwrap_err();
        assert!(err.contains("_internal"), "{err}");
        assert!(is_earlier_install(&dest));
    }

    #[test]
    fn an_entry_outside_the_archive_root_is_refused() {
        let root = temp_dir("mnemo-install-escape");
        // `tar::Builder` will not write `..` itself, so patch the name in the raw header.
        let (arc, _) = archive(&root, "a.tar.gz", &[Entry::File("mnemo/_internal/x", b"x"), Entry::File("zz/evil", b"evil")]);
        let mut raw = Vec::new();
        flate2::read::GzDecoder::new(std::fs::File::open(&arc).unwrap()).read_to_end(&mut raw).unwrap();
        let at = raw.windows(7).position(|w| w == b"zz/evil").unwrap();
        raw[at..at + 2].copy_from_slice(b"..");
        let header = &mut raw[at - at % 512..at - at % 512 + 512];
        header[148..156].copy_from_slice(b"        ");
        let sum: u32 = header.iter().map(|&b| b as u32).sum();
        header[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        let mut gz = flate2::write::GzEncoder::new(std::fs::File::create(&arc).unwrap(), flate2::Compression::fast());
        gz.write_all(&raw).unwrap();
        gz.finish().unwrap();
        let sum = format!("{}  a.tar.gz\n", sha256_file(&arc).unwrap());

        let dest = root.join("tools/mnemo");
        let scratch = root.join("tools/.mnemo-install-t");
        assert!(install_archive(&arc, Some(&sum), &dest, "mnemo", &scratch, &quiet).is_err());
        assert!(!scratch.join("evil").exists() && !root.join("tools/evil").exists());
        assert!(!dest.exists());
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_in_the_bundle_survive() {
        // The macOS build links `_internal/Python` into its framework.
        let root = temp_dir("mnemo-install-link");
        let (arc, sum) = archive(
            &root,
            "a.tar.gz",
            &[
                Entry::File("mnemo/mnemo", b"new"),
                Entry::File("mnemo/_internal/Python.framework/Versions/3.12/Python", b"py"),
                Entry::Link("mnemo/_internal/Python", "Python.framework/Versions/3.12/Python"),
            ],
        );
        let dest = root.join("tools/mnemo");
        install_archive(&arc, Some(&sum), &dest, "mnemo", &root.join("tools/.mnemo-install-t"), &quiet).unwrap();
        assert!(std::fs::symlink_metadata(dest.join("_internal/Python")).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read(dest.join("_internal/Python")).unwrap(), b"py");
    }

    #[test]
    fn a_failed_swap_puts_the_earlier_install_back() {
        let root = temp_dir("mnemo-install-swap");
        let dest = root.join("mnemo");
        earlier_install(&dest);
        let err = swap_in(&root.join("does-not-exist"), &dest, &root.join("aside")).unwrap_err();
        assert!(err.contains("Could not put mnemo"), "{err}");
        assert!(is_earlier_install(&dest));
        assert!(!root.join("aside").exists());
    }

    #[test]
    fn a_second_install_is_refused_while_one_runs() {
        let first = Running::claim().unwrap();
        assert!(Running::claim().unwrap_err().contains("already being installed"));
        drop(first);
        drop(Running::claim().unwrap());
    }

    #[test]
    fn leftovers_of_an_interrupted_install_are_cleared_and_nothing_else() {
        let root = temp_dir("mnemo-install-leftovers");
        std::fs::create_dir_all(root.join(".mnemo-install-123-0/unpack/mnemo")).unwrap();
        earlier_install(&root.join("mnemo"));
        std::fs::create_dir_all(root.join("gh")).unwrap();
        clear_leftovers(&root);
        assert!(!root.join(".mnemo-install-123-0").exists());
        assert!(is_earlier_install(&root.join("mnemo")));
        assert!(root.join("gh").is_dir());
    }

    #[test]
    fn every_platform_the_release_ships_maps_to_its_build() {
        assert_eq!(target("macos", "aarch64"), Some("darwin-arm64"));
        assert_eq!(target("macos", "x86_64"), Some("darwin-x64"));
        assert_eq!(target("linux", "x86_64"), Some("linux-x64"));
        assert_eq!(target("windows", "x86_64"), Some("win-x64"));
        assert_eq!(target("windows", "aarch64"), Some("win-x64"));
        assert_eq!(target("linux", "aarch64"), None);
        assert_eq!(exe_name("windows"), "mnemo.exe");
        assert_eq!(exe_name("linux"), "mnemo");
        assert!(target(std::env::consts::OS, std::env::consts::ARCH).is_some() || cfg!(all(target_os = "linux", target_arch = "aarch64")));
    }

    #[test]
    fn the_release_names_its_archive_and_checksum_by_tag_and_target() {
        // Trimmed from the real `releases/latest` for v1.6.0.
        let json = r#"{"tag_name":"v1.6.0","assets":[
            {"name":"mnemo-v1.6.0-darwin-arm64.tar.gz","browser_download_url":"https://github.com/xyrlan/mnemo/releases/download/v1.6.0/mnemo-v1.6.0-darwin-arm64.tar.gz"},
            {"name":"mnemo-v1.6.0-darwin-arm64.tar.gz.sha256","browser_download_url":"https://github.com/xyrlan/mnemo/releases/download/v1.6.0/mnemo-v1.6.0-darwin-arm64.tar.gz.sha256"},
            {"name":"mnemo-v1.6.0-win-x64.tar.gz","browser_download_url":"https://github.com/xyrlan/mnemo/releases/download/v1.6.0/mnemo-v1.6.0-win-x64.tar.gz"},
            {"name":"mnemo-v1.6.0-win-x64.tar.gz.sha256","browser_download_url":"https://github.com/xyrlan/mnemo/releases/download/v1.6.0/mnemo-v1.6.0-win-x64.tar.gz.sha256"}]}"#;
        let r = pick_release(json, "win-x64").unwrap();
        assert_eq!(r.tag, "v1.6.0");
        assert_eq!(r.asset, "mnemo-v1.6.0-win-x64.tar.gz");
        assert!(r.archive_url.ends_with("/v1.6.0/mnemo-v1.6.0-win-x64.tar.gz"));
        assert!(r.checksum_url.ends_with("/v1.6.0/mnemo-v1.6.0-win-x64.tar.gz.sha256"));
        assert!(pick_release(json, "linux-x64").unwrap_err().contains("no build for linux-x64"));
    }

    #[test]
    fn a_checksum_file_is_its_first_word_lowercased() {
        let hex = "5249A7455841F11D94DB612F82641C7703FA7CB02B0BD446C7207D83B9600336";
        assert_eq!(parse_checksum(&format!("{hex}  mnemo-v1.6.0-darwin-arm64.tar.gz\n")), Some(hex.to_ascii_lowercase()));
        assert_eq!(parse_checksum(hex), Some(hex.to_ascii_lowercase()));
        assert_eq!(parse_checksum("  \n"), None);
        assert_eq!(parse_checksum(&hex[1..]), None);
    }

    #[cfg(unix)]
    #[test]
    fn init_output_is_said_line_by_line_and_a_failure_names_its_last_line() {
        let root = temp_dir("mnemo-install-init");
        let exe = root.join("mnemo");
        crate::testutil::write_script(&exe, "#!/bin/sh\necho \"args: $*\"\necho 'vault ready'\necho 'settings.json is locked' >&2\nexit 3\n");
        let said = std::sync::Mutex::new(Vec::new());
        let err = run_init(&exe, &|l| said.lock().unwrap().push(l)).unwrap_err();
        let said = said.into_inner().unwrap();
        assert_eq!(said[0], "Running mnemo init…");
        assert!(said.contains(&"args: init --yes".to_string()), "{said:?}");
        assert!(said.contains(&"vault ready".to_string()), "{said:?}");
        assert_eq!(err, "mnemo init stopped with code 3: settings.json is locked");
    }

    #[cfg(unix)]
    #[test]
    fn init_that_succeeds_is_ok() {
        let root = temp_dir("mnemo-install-init-ok");
        let exe = root.join("mnemo");
        crate::testutil::write_script(&exe, "#!/bin/sh\necho done\n");
        assert_eq!(run_init(&exe, &|_| {}), Ok(()));
    }

    /// The real thing, against GitHub: `cargo test -- --ignored the_latest_release_installs`.
    #[test]
    #[ignore = "downloads the latest mnemo release"]
    fn the_latest_release_installs_and_runs() {
        let root = temp_dir("mnemo-install-live");
        let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
        let dest = root.join("tools/mnemo");
        let tag = fetch_and_install(&dest, target(os, arch).unwrap(), exe_name(os), &|l| eprintln!("{l}")).unwrap();
        let out = crate::proc::command(dest.join(exe_name(os))).arg("--version").output().unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains(tag.trim_start_matches('v')), "{out:?}");
        assert_eq!(std::fs::read_dir(root.join("tools")).unwrap().count(), 1, "no scratch left beside the install");
    }
}

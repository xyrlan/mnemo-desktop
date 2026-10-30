//! The files Jarvis's voice downloads: fetched once through dictation's resuming `download`, and
//! checked against their sha256 before first use. A file that passed leaves `<file>.sha256`
//! beside it, so the next launch checks its size and that mark instead of hashing it again.

use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// One file, pinned: where it comes from, how big it is and what it hashes to.
#[derive(Clone, Copy, Debug)]
pub struct Pinned {
    pub file: &'static str,
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

/// `~/.mnemo-desktop/models/`, shared by the debug and release builds, where dictation keeps its
/// model too: a whisper model already there is not fetched again.
pub fn models_dir() -> PathBuf {
    crate::app_dir::shared_dir_in(&crate::app_dir::home()).join("models")
}

fn mark(path: &Path) -> PathBuf {
    let mut m = path.as_os_str().to_owned();
    m.push(".sha256");
    PathBuf::from(m)
}

pub fn sha256_of(path: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("{}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether `path` is the whole file `pin` names, checked already.
fn verified(path: &Path, pin: &Pinned) -> bool {
    std::fs::metadata(path).is_ok_and(|m| m.len() == pin.bytes)
        && std::fs::read_to_string(mark(path)).is_ok_and(|m| m.trim() == pin.sha256)
}

/// `pin`'s file in `dir`: downloaded when it is missing (a partial one resumes), hashed when it
/// has not been yet, and refused, deleted, when its hash is not the pinned one. `progress(done,
/// total)` fires as bytes arrive.
pub fn ensure(dir: &Path, pin: &Pinned, progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let path = dir.join(pin.file);
    if verified(&path, pin) {
        return Ok(path);
    }
    let whole = std::fs::metadata(&path).is_ok_and(|m| m.len() == pin.bytes);
    if !whole {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        crate::voice::download(pin.url, &path, pin.bytes, crate::voice::STALL, progress)
            .map_err(|e| format!("{}: {e}", pin.file))?;
    }
    let got = sha256_of(&path)?;
    if got != pin.sha256 {
        let _ = std::fs::remove_file(&path);
        return Err(format!("{}: its sha256 is {got}, not {}; it was deleted, and the next try downloads it again", pin.file, pin.sha256));
    }
    std::fs::write(mark(&path), pin.sha256).map_err(|e| format!("{}: {e}", mark(&path).display()))?;
    Ok(path)
}

/// One file inside a zip archive, fetched alone: its deflated bytes, at `data_at` in the archive
/// and `packed` long, are asked for with `Range` and inflated. A package of 202 MB that holds the
/// one DLL wanted (DirectML's) costs that DLL's 9 MB this way. The offsets are those of a published
/// package, which never changes, and the file is checked against its sha256 as `ensure` checks one.
#[derive(Clone, Copy, Debug)]
pub struct Entry {
    pub file: &'static str,
    pub url: &'static str,
    pub data_at: u64,
    pub packed: u64,
    pub bytes: u64,
    pub sha256: &'static str,
}

impl Entry {
    fn pin(&self) -> Pinned {
        Pinned { file: self.file, url: self.url, bytes: self.bytes, sha256: self.sha256 }
    }
}

/// `entry`'s file in `dir`, fetched and checked when it has not been yet.
pub fn ensure_entry(dir: &Path, entry: &Entry) -> Result<PathBuf, String> {
    let path = dir.join(entry.file);
    if verified(&path, &entry.pin()) {
        return Ok(path);
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut part = path.as_os_str().to_owned();
    part.push(".part");
    let part = PathBuf::from(part);
    let fetched = fetch_entry(entry, &part);
    let got = fetched.and_then(|()| sha256_of(&part));
    match got {
        Ok(got) if got == entry.sha256 => {}
        Ok(got) => {
            let _ = std::fs::remove_file(&part);
            return Err(format!("{}: its sha256 is {got}, not {}; it was deleted, and the next try fetches it again", entry.file, entry.sha256));
        }
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(format!("{}: {e}", entry.file));
        }
    }
    std::fs::rename(&part, &path).map_err(|e| format!("{}: {e}", path.display()))?;
    std::fs::write(mark(&path), entry.sha256).map_err(|e| format!("{}: {e}", mark(&path).display()))?;
    Ok(path)
}

fn fetch_entry(entry: &Entry, into: &Path) -> Result<(), String> {
    use std::io::Write;
    let agent = ureq::Agent::config_builder()
        .timeout_connect(Some(std::time::Duration::from_secs(15)))
        .timeout_recv_response(Some(crate::voice::STALL))
        .timeout_recv_body(Some(crate::voice::STALL))
        .build()
        .new_agent();
    let last = entry.data_at + entry.packed - 1;
    let response = agent.get(entry.url).header("Range", format!("bytes={}-{last}", entry.data_at)).call().map_err(|e| e.to_string())?;
    if response.status() != 206 {
        return Err(format!("the server sent {} where its bytes {}-{last} were asked for", response.status(), entry.data_at));
    }
    let body = response.into_body().into_with_config().limit(entry.packed + 1).reader();
    let mut inflated = flate2::read::DeflateDecoder::new(body).take(entry.bytes + 1);
    let mut file = std::fs::File::create(into).map_err(|e| format!("{}: {e}", into.display()))?;
    let n = std::io::copy(&mut inflated, &mut file).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| format!("{}: {e}", into.display()))?;
    if n != entry.bytes {
        return Err(format!("expected {} bytes, got {n}", entry.bytes));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, Write};

    /// Serves `body` once per connection, honouring `Range`, and counts the connections.
    fn serve(body: Vec<u8>) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/f", listener.local_addr().unwrap());
        let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = count.clone();
        std::thread::spawn(move || {
            for conn in listener.incoming() {
                let Ok(mut conn) = conn else { return };
                seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut reader = std::io::BufReader::new(conn.try_clone().unwrap());
                let (mut from, mut to) = (0usize, body.len());
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        let (a, b) = v.trim().split_once('-').unwrap();
                        from = a.parse().unwrap();
                        to = b.parse().map_or(body.len(), |b: usize| b + 1);
                    }
                }
                let rest = &body[from..to];
                let status = if from > 0 { "206 Partial Content" } else { "200 OK" };
                let _ = write!(conn, "HTTP/1.1 {status}\r\nContent-Length: {}\r\n\r\n", rest.len());
                let _ = conn.write_all(rest);
            }
        });
        (url, count)
    }

    fn hex(data: &[u8]) -> String {
        Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
    }

    fn leak(s: String) -> &'static str {
        Box::leak(s.into_boxed_str())
    }

    #[test]
    fn a_file_is_fetched_resumed_checked_and_then_trusted_by_its_mark() {
        let data: Vec<u8> = (0..50_000).map(|i| (i % 253) as u8).collect();
        let (url, count) = serve(data.clone());
        let dir = crate::testutil::temp_dir("jarvis-files");
        let pin = Pinned { file: "voice.onnx", url: leak(url), bytes: data.len() as u64, sha256: leak(hex(&data)) };
        // What an earlier try left.
        std::fs::write(dir.join("voice.onnx.part"), &data[..20_000]).unwrap();
        let mut first = None;
        let path = ensure(&dir, &pin, |done, _| {
            first.get_or_insert(done);
        })
        .unwrap();
        assert_eq!(first, Some(20_000), "it went on from what was kept");
        assert_eq!(std::fs::read(&path).unwrap(), data);
        assert_eq!(std::fs::read_to_string(dir.join("voice.onnx.sha256")).unwrap(), pin.sha256);
        ensure(&dir, &pin, |_, _| panic!("nothing to fetch")).unwrap();
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[test]
    fn a_file_whose_hash_is_not_the_pinned_one_is_refused_and_deleted() {
        let data = vec![7u8; 4096];
        let (url, _) = serve(data.clone());
        let dir = crate::testutil::temp_dir("jarvis-files");
        let pin = Pinned { file: "piper.zip", url: leak(url), bytes: 4096, sha256: leak(hex(b"something else")) };
        let err = ensure(&dir, &pin, |_, _| {}).unwrap_err();
        assert!(err.contains("sha256") && err.contains("deleted"), "{err}");
        assert!(!dir.join("piper.zip").exists());
        assert!(!dir.join("piper.zip.sha256").exists());
    }

    #[test]
    fn a_file_inside_an_archive_is_fetched_alone_inflated_and_checked() {
        use flate2::write::DeflateEncoder;
        let data: Vec<u8> = (0..40_000).map(|i| (i % 97) as u8).collect();
        let mut enc = DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&data).unwrap();
        let packed = enc.finish().unwrap();
        // The entry, between what else the archive holds.
        let mut archive = vec![1u8; 5_000];
        archive.extend_from_slice(&packed);
        archive.extend(vec![2u8; 3_000]);
        let (url, count) = serve(archive);
        let dir = crate::testutil::temp_dir("jarvis-files");
        let entry = Entry { file: "DirectML.dll", url: leak(url), data_at: 5_000, packed: packed.len() as u64, bytes: data.len() as u64, sha256: leak(hex(&data)) };
        let path = ensure_entry(&dir, &entry).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), data);
        ensure_entry(&dir, &entry).unwrap();
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 1, "trusted by its mark the second time");

        let wrong = Entry { file: "other.dll", sha256: leak(hex(b"else")), ..entry };
        let err = ensure_entry(&dir, &wrong).unwrap_err();
        assert!(err.contains("sha256"), "{err}");
        assert!(!dir.join("other.dll").exists() && !dir.join("other.dll.part").exists());
    }

    #[test]
    fn a_whole_file_already_on_disk_is_hashed_once_without_a_download() {
        let data = vec![3u8; 1000];
        let dir = crate::testutil::temp_dir("jarvis-files");
        std::fs::write(dir.join("ggml-x.bin"), &data).unwrap();
        // Nothing listens there: a download would fail.
        let pin = Pinned { file: "ggml-x.bin", url: "http://127.0.0.1:9/none", bytes: 1000, sha256: leak(hex(&data)) };
        ensure(&dir, &pin, |_, _| {}).unwrap();
        assert!(verified(&dir.join("ggml-x.bin"), &pin));
    }
}

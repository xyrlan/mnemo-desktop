//! `read_file`, `list_dir`, `search`: a project's files, inside its root and never a secret.

use super::{git::git, paths, MAX_CHARS};
use crate::jarvis::JarvisProject;
use std::io::Read;
use std::path::Path;

/// How much of a file is read: what the model is shown is far less (`MAX_CHARS`).
const READ_MAX_BYTES: u64 = 256 * 1024;

/// Files `search` skips as too big to be source.
const SEARCH_MAX_BYTES: u64 = 1024 * 1024;

/// How many matching lines `search` shows, and how much of each.
const SEARCH_MAX_HITS: usize = 200;
const SEARCH_LINE_CHARS: usize = 200;

/// How many entries `list_dir` shows.
const LIST_MAX: usize = 500;

/// A NUL in the first 8 KB, as git tells a binary file.
fn is_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(8000)].contains(&0)
}

/// The text of a file in the project; a binary file, a folder or a secret is an error.
pub fn read(p: &JarvisProject, path: &str) -> Result<String, String> {
    let real = paths::resolve(Path::new(&p.root), path)?;
    if real.is_dir() {
        return Err(format!("{}: a folder; list_dir lists it", path.trim()));
    }
    let size = std::fs::metadata(&real).map(|m| m.len()).map_err(|e| format!("{}: {e}", path.trim()))?;
    let mut bytes = Vec::new();
    std::fs::File::open(&real).and_then(|f| f.take(READ_MAX_BYTES).read_to_end(&mut bytes)).map_err(|e| format!("{}: {e}", path.trim()))?;
    if is_binary(&bytes) {
        return Err(format!("{}: a binary file ({size} bytes), not read", path.trim()));
    }
    let mut text = String::from_utf8_lossy(&bytes).to_string();
    if size > READ_MAX_BYTES {
        text.push_str(&format!("\n[the file is {size} bytes; only its first {READ_MAX_BYTES} were read]"));
    }
    Ok(text)
}

/// A folder's entries, folders first and marked with `/`, secrets left out.
pub fn list(p: &JarvisProject, path: &str) -> Result<String, String> {
    let real = paths::resolve(Path::new(&p.root), path)?;
    let rd = std::fs::read_dir(&real).map_err(|e| format!("{}: {e}", if path.trim().is_empty() { "the project's root" } else { path.trim() }))?;
    let mut entries: Vec<(bool, String)> = rd
        .filter_map(|e| e.ok())
        .map(|e| (e.path().is_dir(), e.file_name().to_string_lossy().to_string()))
        .filter(|(_, name)| !paths::secret_name(name))
        .collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    if entries.is_empty() {
        return Ok("(empty)".to_string());
    }
    let mut lines: Vec<String> = entries.iter().take(LIST_MAX).map(|(dir, n)| if *dir { format!("{n}/") } else { n.clone() }).collect();
    if entries.len() > LIST_MAX {
        lines.push(format!("({} more entries)", entries.len() - LIST_MAX));
    }
    Ok(lines.join("\n"))
}

/// The lines of the project's files that hold `query`, ignoring case, as `path:line: text`. The
/// files are git's (tracked, and untracked ones git does not ignore); secrets, links, binary and
/// very big files are never opened.
pub fn search(p: &JarvisProject, query: &str) -> Result<String, String> {
    let root = Path::new(&p.root);
    let needle = query.trim().to_lowercase();
    let names = git(root, &["ls-files", "--cached", "--others", "--exclude-standard", "-z"])?;
    let mut files: Vec<&str> = names.split('\0').filter(|n| !n.is_empty() && !paths::is_secret(Path::new(n))).collect();
    files.sort_unstable();
    files.dedup();
    let mut hits: Vec<String> = Vec::new();
    let (mut size, mut more, mut in_files) = (0usize, false, 0usize);
    'files: for name in files {
        let path = root.join(name);
        match std::fs::symlink_metadata(&path) {
            Ok(m) if m.is_file() && m.len() <= SEARCH_MAX_BYTES => {}
            _ => continue,
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        if is_binary(&bytes) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let mut found = false;
        for (i, line) in text.lines().enumerate() {
            if !line.to_lowercase().contains(&needle) {
                continue;
            }
            if hits.len() == SEARCH_MAX_HITS || size > MAX_CHARS {
                more = true;
                break 'files;
            }
            let shown: String = line.trim().chars().take(SEARCH_LINE_CHARS).collect();
            let hit = format!("{name}:{}: {shown}", i + 1);
            size += hit.len() + 1;
            hits.push(hit);
            found = true;
        }
        in_files += found as usize;
    }
    if hits.is_empty() {
        return Ok(format!("no line holds \"{}\"", query.trim()));
    }
    let head = if more { format!("the first {} matching lines:", hits.len()) } else { format!("{} matching lines in {in_files} files:", hits.len()) };
    Ok(format!("{head}\n{}", hits.join("\n")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jarvis_tools::tests::project_at;

    fn tree(tag: &str) -> std::path::PathBuf {
        let dir = crate::testutil::temp_dir(tag);
        git(&dir, &["init", "-q"]).unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::create_dir_all(dir.join("certs")).unwrap();
        std::fs::write(dir.join("src").join("main.rs"), "fn main() {\n    let token = env(\"API_TOKEN\");\n}\n").unwrap();
        std::fs::write(dir.join("README.md"), "The API_TOKEN comes from the environment.\n").unwrap();
        std::fs::write(dir.join(".env"), "API_TOKEN=s3cr3t\n").unwrap();
        std::fs::write(dir.join(".env.local"), "API_TOKEN=s3cr3t\n").unwrap();
        std::fs::write(dir.join("certs").join("server.pem"), "API_TOKEN s3cr3t\n").unwrap();
        std::fs::write(dir.join("logo.bin"), b"API_TOKEN\0\x01").unwrap();
        dir
    }

    #[test]
    fn reading_refuses_secrets_folders_and_binaries() {
        let dir = tree("jarvis-files-read");
        let p = project_at("app", &dir);
        assert!(read(&p, "src/main.rs").unwrap().contains("fn main"));
        for s in [".env", ".env.local", "certs/server.pem", "./certs/../.env"] {
            assert!(read(&p, s).unwrap_err().contains("refused"), "{s}");
        }
        assert!(read(&p, "src").unwrap_err().contains("a folder"));
        assert!(read(&p, "logo.bin").unwrap_err().contains("binary"));
        assert!(read(&p, "nope.txt").unwrap_err().contains("no such file"));
    }

    #[test]
    fn listing_leaves_secrets_out() {
        let dir = tree("jarvis-files-list");
        let p = project_at("app", &dir);
        let root = list(&p, "").unwrap();
        assert_eq!(root.lines().collect::<Vec<_>>(), ["certs/", "src/", "logo.bin", "README.md"], "{root}");
        assert_eq!(list(&p, "certs").unwrap(), "(empty)");
        assert!(list(&p, ".git").unwrap_err().contains("refused"));
        assert!(list(&p, "..").unwrap_err().contains("outside the project"));
    }

    #[test]
    fn search_never_opens_a_secret() {
        let dir = tree("jarvis-files-search");
        let p = project_at("app", &dir);
        let got = search(&p, "api_token").unwrap();
        assert!(got.starts_with("2 matching lines in 2 files:"), "{got}");
        assert!(got.contains("README.md:1: The API_TOKEN") && got.contains("src/main.rs:2: let token"), "{got}");
        assert!(!got.contains("s3cr3t") && !got.contains(".env") && !got.contains("pem"), "{got}");
        assert!(search(&p, "nowhere at all").unwrap().starts_with("no line holds"));
    }
}

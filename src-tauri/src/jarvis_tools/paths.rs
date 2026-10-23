//! Where a read tool may look: inside the project's root, `..` and links that leave it refused,
//! and never at a secret, even inside the project. The one list of secrets serves reading,
//! listing and search results alike.

use std::path::{Component, Path, PathBuf};

/// Folders whose whole content is a secret: keys and the tokens tools keep (`~/.ssh`, `~/.aws`),
/// and `.git`, whose config can carry a token in a remote's URL.
const SECRET_DIRS: &[&str] = &[".ssh", ".aws", ".gnupg", ".kube", ".git"];

/// Files that hold credentials by name.
const SECRET_NAMES: &[&str] = &[
    ".netrc",
    "_netrc",
    ".npmrc",
    ".pypirc",
    ".pgpass",
    ".htpasswd",
    ".git-credentials",
    ".credentials.json",
    "credentials",
    "credentials.json",
    "credentials.yml",
    "credentials.yaml",
    "credentials.toml",
    "credentials.xml",
    "application_default_credentials.json",
    "secrets.json",
    "secrets.yml",
    "secrets.yaml",
    "secrets.toml",
];

/// Key and certificate stores by extension.
const SECRET_EXTENSIONS: &[&str] = &["pem", "key", "p12", "pfx", "jks", "keystore", "ppk"];

/// SSH private keys by the name `ssh-keygen` gives them.
const SSH_KEYS: &[&str] = &["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"];

/// Whether a file or folder called `name` is a secret, or holds only secrets. Without case: a
/// Windows or macOS disk does not tell `.ENV` from `.env`.
pub fn secret_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n.starts_with(".env")
        || SECRET_DIRS.contains(&n.as_str())
        || SECRET_NAMES.contains(&n.as_str())
        || SSH_KEYS.iter().any(|k| n.starts_with(k))
        || Path::new(&n).extension().and_then(|e| e.to_str()).is_some_and(|e| SECRET_EXTENSIONS.contains(&e))
}

/// Whether any part of `path` is a secret.
pub fn is_secret(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::Normal(n) if secret_name(&n.to_string_lossy())))
}

/// `path` (relative to `root`, or absolute) as a path relative to `root`, by its words alone:
/// `.` dropped, `..` taken back, an error when it leaves the root or names a secret.
pub fn relative(root: &Path, path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path.trim());
    let rest = if p.is_absolute() {
        p.strip_prefix(root).map_err(|_| outside(path))?
    } else if p.has_root() {
        // `\x` on Windows: the root of the current drive.
        return Err(outside(path));
    } else {
        p
    };
    let mut out = PathBuf::new();
    for c in rest.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return Err(outside(path));
                }
            }
            Component::Normal(n) => out.push(n),
            Component::RootDir | Component::Prefix(_) => return Err(outside(path)),
        }
    }
    if is_secret(&out) {
        return Err(refused(path));
    }
    Ok(out)
}

/// The file or folder `path` names inside `root`, links followed: an error when it does not
/// exist, leaves the root (through `..` or a link) or is a secret (by its name, or by where a
/// link leads). A secret is refused before anything is read, so the error never says whether
/// it exists.
pub fn resolve(root: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = relative(root, path)?;
    let real_root = root.canonicalize().map_err(|e| format!("the project's root {}: {e}", root.display()))?;
    let real = root.join(&rel).canonicalize().map_err(|_| format!("{}: no such file or folder in the project", shown(path)))?;
    let inside = real.strip_prefix(&real_root).map_err(|_| outside(path))?;
    if is_secret(inside) || is_secret_home(&real) {
        return Err(refused(path));
    }
    Ok(real)
}

/// Inside the home's `.ssh`, `.aws` or `.gnupg`, however the project's root was set.
fn is_secret_home(real: &Path) -> bool {
    let home = crate::app_dir::home();
    let home = home.canonicalize().unwrap_or(home);
    real.strip_prefix(&home).is_ok_and(|rest| rest.components().next().is_some_and(|c| matches!(c, Component::Normal(n) if secret_name(&n.to_string_lossy()))))
}

fn shown(path: &str) -> &str {
    if path.trim().is_empty() {
        "the project's root"
    } else {
        path.trim()
    }
}

fn outside(path: &str) -> String {
    format!("{}: outside the project, refused", shown(path))
}

fn refused(path: &str) -> String {
    format!("{}: a secret (.env*, keys, credentials, .ssh, .git), refused", shown(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_secret_list() {
        for s in [
            ".env",
            ".env.local",
            ".ENV.production",
            ".envrc",
            "server.pem",
            "tls.KEY",
            "store.p12",
            "id_rsa",
            "id_ed25519.pub",
            ".npmrc",
            ".netrc",
            "credentials",
            "credentials.json",
            ".git-credentials",
            "secrets.yaml",
            ".ssh",
            ".git",
        ] {
            assert!(secret_name(s), "{s} is a secret");
        }
        for s in ["README.md", "env.ts", "environment.rs", "keyboard.ts", "monkey.rs", "credentials_form.tsx", "key.rs", "src", ".github", ".gitignore"] {
            assert!(!secret_name(s), "{s} is not a secret");
        }
        assert!(is_secret(Path::new("config/.env.local")));
        assert!(is_secret(Path::new(".ssh/config")));
        assert!(is_secret(Path::new(".git/config")));
        assert!(!is_secret(Path::new("src/env/config.ts")));
    }

    #[test]
    fn a_path_that_leaves_the_root_is_refused() {
        let dir = crate::testutil::temp_dir("jarvis-paths");
        let root = dir.join("app");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("main.rs"), "fn main() {}").unwrap();
        std::fs::write(dir.join("outside.txt"), "no").unwrap();
        assert_eq!(relative(&root, "src/../src/./main.rs").unwrap(), Path::new("src").join("main.rs"));
        assert_eq!(relative(&root, "").unwrap(), PathBuf::new());
        assert!(resolve(&root, "src/main.rs").is_ok());
        for p in ["../outside.txt", "src/../../outside.txt", "..", &dir.join("outside.txt").to_string_lossy()] {
            assert!(resolve(&root, p).unwrap_err().contains("outside the project"), "{p}");
        }
        // An absolute path inside the root is its relative one.
        assert_eq!(relative(&root, &root.join("src").to_string_lossy()).unwrap(), Path::new("src"));
    }

    #[test]
    fn a_secret_is_refused_by_name_before_it_is_looked_for() {
        let dir = crate::testutil::temp_dir("jarvis-paths-secret");
        std::fs::write(dir.join(".env"), "TOKEN=x").unwrap();
        let there = resolve(&dir, ".env").unwrap_err();
        let missing = resolve(&dir, "sub/.env.local").unwrap_err();
        assert!(there.contains("refused") && missing.contains("refused"));
        assert!(!missing.contains("no such file"));
        assert!(resolve(&dir, "certs/../.git/config").unwrap_err().contains("a secret"));
    }

    #[cfg(unix)]
    #[test]
    fn a_link_out_of_the_root_or_to_a_secret_is_refused() {
        let dir = crate::testutil::temp_dir("jarvis-paths-link");
        let root = dir.join("app");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(dir.join("outside.txt"), "no").unwrap();
        std::fs::write(root.join(".env"), "TOKEN=x").unwrap();
        std::os::unix::fs::symlink(dir.join("outside.txt"), root.join("away.txt")).unwrap();
        std::os::unix::fs::symlink(root.join(".env"), root.join("notes.txt")).unwrap();
        assert!(resolve(&root, "away.txt").unwrap_err().contains("outside the project"));
        assert!(resolve(&root, "notes.txt").unwrap_err().contains("a secret"));
    }
}

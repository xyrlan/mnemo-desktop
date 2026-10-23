//! `git_status`, `git_log`, `git_diff`: git in the project's root, read-only, with no secret's
//! name or content in what comes back.

use super::paths;
use crate::jarvis::JarvisProject;
use std::path::Path;

/// How many commits `git_log` shows when the model names no limit, and at most.
const LOG_DEFAULT: u64 = 10;
const LOG_MAX: u64 = 50;

/// How many changed files `git_diff` shows at once: their names go on one command line.
const DIFF_FILES_MAX: usize = 100;

/// `git <args>` in `root`: its output, or the first line of what it said.
pub fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    // No fsmonitor hook, no external diff or textconv program: reading runs nothing but git.
    let out = crate::proc::tool("git", &crate::mission::login_path())
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if out.status.success() {
        return Ok(String::from_utf8_lossy(&out.stdout).to_string());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(err.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("git failed").to_string())
}

/// `git status --short --branch`, a secret's line left out.
pub fn status(p: &JarvisProject) -> Result<String, String> {
    let out = git(Path::new(&p.root), &["status", "--short", "--branch", "--untracked-files=normal"])?;
    let lines: Vec<&str> = out.lines().filter(|l| l.starts_with("##") || !status_names_secret(l)).collect();
    let mut text = lines.join("\n");
    if lines.len() <= 1 {
        text.push_str("\n(no changes)");
    }
    Ok(text)
}

/// Whether a `--short` line (`XY path`, `XY old -> new`) names a secret.
fn status_names_secret(line: &str) -> bool {
    let path = line.get(3..).unwrap_or("");
    path.split(" -> ").any(|p| paths::is_secret(Path::new(p.trim_matches('"'))))
}

/// The last `limit` commits (`LOG_DEFAULT` when None, at most `LOG_MAX`): hash, date, author,
/// subject.
pub fn log(p: &JarvisProject, limit: Option<u64>) -> Result<String, String> {
    let n = limit.unwrap_or(LOG_DEFAULT).clamp(1, LOG_MAX).to_string();
    let out = git(Path::new(&p.root), &["log", "-n", &n, "--date=short", "--format=%h %ad %an: %s"])?;
    Ok(if out.trim().is_empty() { "(no commits yet)".to_string() } else { out })
}

/// Uncommitted changes against `HEAD`, staged or not, of one path or of the whole tree; a
/// secret's changes left out (counted, not shown).
pub fn diff(p: &JarvisProject, path: Option<&str>) -> Result<String, String> {
    let root = Path::new(&p.root);
    let rel = match path.filter(|s| !s.trim().is_empty()) {
        Some(s) => Some(paths::relative(root, s)?.to_string_lossy().replace('\\', "/")),
        None => None,
    };
    // A repository with no commit yet has no HEAD: then the index is what it is compared to.
    let base: &[&str] = if git(root, &["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok() { &["diff", "HEAD"] } else { &["diff", "--cached"] };
    let mut names_args: Vec<&str> = base.to_vec();
    names_args.extend(["--name-only", "-z", "--"]);
    names_args.extend(rel.as_deref());
    let names = git(root, &names_args)?;
    let all: Vec<&str> = names.split('\0').filter(|n| !n.is_empty()).collect();
    let (secret, files): (Vec<&str>, Vec<&str>) = all.iter().partition(|n| paths::is_secret(Path::new(n)));
    if files.is_empty() {
        let what = rel.as_deref().map_or(String::new(), |r| format!(" in {r}"));
        let left = if secret.is_empty() { String::new() } else { format!(" ({} changed secret file(s) not shown)", secret.len()) };
        return Ok(format!("no uncommitted changes{what}{left}"));
    }
    let shown = &files[..files.len().min(DIFF_FILES_MAX)];
    let mut args: Vec<&str> = base.to_vec();
    args.extend(["--no-ext-diff", "--no-textconv", "--stat", "--patch", "--"]);
    args.extend(shown.iter().copied());
    let mut out = git(root, &args)?;
    if files.len() > shown.len() {
        out.push_str(&format!("\n({} more changed files not shown: {})", files.len() - shown.len(), files[shown.len()..].join(", ")));
    }
    if !secret.is_empty() {
        out.push_str(&format!("\n({} changed secret file(s) not shown)", secret.len()));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jarvis_tools::tests::project_at;

    fn repo(tag: &str) -> std::path::PathBuf {
        let dir = crate::testutil::temp_dir(tag);
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "you@example.com"], &["config", "user.name", "You"], &["config", "commit.gpgsign", "false"]] {
            git(&dir, args).unwrap();
        }
        dir
    }

    #[test]
    fn status_log_and_diff_leave_secrets_out() {
        let dir = repo("jarvis-git");
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        std::fs::write(dir.join(".env"), "TOKEN=one\n").unwrap();
        let p = project_at("app", &dir);
        assert!(diff(&p, None).unwrap().starts_with("no uncommitted changes"));
        git(&dir, &["add", "-A"]).unwrap();
        // Staged with no commit yet: compared to the index's base, nothing.
        assert!(diff(&p, None).is_ok());
        git(&dir, &["commit", "-q", "-m", "first"]).unwrap();
        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        std::fs::write(dir.join(".env"), "TOKEN=two\n").unwrap();
        std::fs::write(dir.join("new.txt"), "n\n").unwrap();

        let s = status(&p).unwrap();
        assert!(s.starts_with("## main"), "{s}");
        assert!(s.contains("a.txt") && s.contains("new.txt"), "{s}");
        assert!(!s.contains(".env"), "{s}");

        let l = log(&p, Some(0)).unwrap();
        assert_eq!(l.lines().count(), 1);
        assert!(l.contains("You: first"), "{l}");

        let d = diff(&p, None).unwrap();
        assert!(d.contains("+two") && d.contains("a.txt"), "{d}");
        assert!(!d.contains("TOKEN"), "{d}");
        assert!(d.contains("(1 changed secret file(s) not shown)"), "{d}");
        assert!(diff(&p, Some("a.txt")).unwrap().contains("+two"));
        assert!(diff(&p, Some(".env")).unwrap_err().contains("refused"));
        assert!(diff(&p, Some("../x")).unwrap_err().contains("outside the project"));
    }
}

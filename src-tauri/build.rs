//! Stamps which commit this binary is (#88): a bundle that only says `0.1.0` cannot tell
//! you whether the feature you are missing was never built or merged an hour ago.
//!
//! `MNEMO_BUILD_SHA` from the environment wins (that is how `pnpm run install-app` pins the
//! stamp to the commit it built); otherwise ask git. The rerun keys below are what keeps the
//! stamp itself from going stale: HEAD and the ref it points at, so a commit or a checkout
//! rebuilds, and nothing else does — this crate is expensive to recompile.

use std::path::PathBuf;
use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// HEAD, the loose ref it names, and `packed-refs` — the files git touches when the commit
/// under us changes. `--git-path` resolves them for worktrees too, where `.git` is a file.
/// Only existing paths are emitted: cargo re-runs the script on every build for a missing
/// one, which would relink the crate every time.
fn watch_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut add = |p: Option<String>| {
        if let Some(p) = p.map(PathBuf::from) {
            if p.exists() {
                out.push(p);
            }
        }
    };
    add(git(&["rev-parse", "--git-path", "HEAD"]));
    if let Some(r) = git(&["symbolic-ref", "--quiet", "HEAD"]) {
        add(git(&["rev-parse", "--git-path", &r]));
    }
    add(git(&["rev-parse", "--git-path", "packed-refs"]));
    out
}

fn main() {
    let sha = std::env::var("MNEMO_BUILD_SHA")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| git(&["rev-parse", "--short=7", "HEAD"]))
        .unwrap_or_else(|| "unknown".into());
    let built = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    println!("cargo:rustc-env=MNEMO_BUILD_SHA={sha}");
    println!("cargo:rustc-env=MNEMO_BUILD_EPOCH={built}");
    println!("cargo:rerun-if-env-changed=MNEMO_BUILD_SHA");
    for p in watch_paths() {
        println!("cargo:rerun-if-changed={}", p.display());
    }

    tauri_build::build()
}

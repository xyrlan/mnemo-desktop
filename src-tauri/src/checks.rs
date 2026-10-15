//! Running `gh` (or `git`) for a read that must not hang: with the login shell's PATH, never
//! prompting, killed after `GH_TIMEOUT`. The Nexus feed reads each PR's fate through it
//! (`nexus_feed.rs`).

use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use crate::mission::login_path;

pub const GH_MISSING: &str = "gh not found in PATH (brew install gh)";
const GH_TIMEOUT: Duration = Duration::from_secs(60);

/// Runs `program` in `cwd` with the login PATH, never prompting, killed after `GH_TIMEOUT`.
/// stdout on success; otherwise the first line it said.
pub fn run(program: &str, args: &[&str], cwd: &Path) -> Result<String, String> {
    let mut cmd = crate::proc::tool(program, &login_path());
    cmd.args(args)
        .current_dir(cwd)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| if e.kind() == std::io::ErrorKind::NotFound && program == "gh" { GH_MISSING.to_string() } else { format!("{program}: {e}") })?;
    let drain = |mut r: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = r.read_to_end(&mut buf);
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = drain(Box::new(child.stdout.take().expect("stdout is piped")));
    let err = drain(Box::new(child.stderr.take().expect("stderr is piped")));
    let deadline = Instant::now() + GH_TIMEOUT;
    let status = loop {
        match child.try_wait().map_err(|e| format!("{program}: {e}"))? {
            Some(s) => break s,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} {} gave no answer in {}s and was stopped", args.first().unwrap_or(&""), GH_TIMEOUT.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    let (stdout, stderr) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    if status.success() {
        return Ok(stdout);
    }
    let said = if stderr.trim().is_empty() { &stdout } else { &stderr };
    Err(said.lines().map(|l| unmark(l.trim())).find(|l| !l.is_empty()).unwrap_or("it exited without saying why").to_string())
}

/// `gh`'s refusal without the mark it opens with (`X Pull request … is not mergeable`).
fn unmark(line: &str) -> &str {
    ["X ", "! ", "✗ "].iter().find_map(|m| line.strip_prefix(m)).map(str::trim_start).unwrap_or(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIR: &str = env!("CARGO_MANIFEST_DIR");

    #[test]
    fn gh_marks_go_and_words_that_start_like_them_stay() {
        assert_eq!(unmark("X Pull request #7 is not mergeable"), "Pull request #7 is not mergeable");
        assert_eq!(unmark("✗ nope"), "nope");
        assert_eq!(unmark("XML parse error"), "XML parse error");
    }

    #[test]
    fn run_answers_stdout_or_the_first_line_said_and_knows_a_missing_program() {
        let dir = Path::new(DIR);
        assert_eq!(run("git", &["rev-parse", "--is-inside-work-tree"], dir).map(|s| s.trim().to_string()), Ok("true".into()));
        let err = run("git", &["no-such-subcommand-here"], dir).unwrap_err();
        assert!(err.contains("no-such-subcommand-here"), "{err}");
        assert!(run("mnemo-desktop-no-such-program", &[], dir).unwrap_err().contains("mnemo-desktop-no-such-program"));
    }
}

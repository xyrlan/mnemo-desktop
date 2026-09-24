//! A terminal's screen and scrollback, kept beside its PTY (`host.rs`) so that a pane attaching
//! to a shell that kept running — the page reloaded, or the app quit and the daemon kept the
//! shell — is drawn as it was left, and not as an empty terminal.
//!
//! vt100 does the emulation. This adds what vt100 does not keep and a fresh xterm needs back:
//! the title, the folder the shell last reported (OSC 7), focus reporting and the cursor shape.
//!
//! Shared by the app and the daemon binary, which includes this file by path: it names nothing
//! outside `std` and its crates.

use std::fmt::Write as _;

/// Lines kept above the screen. A cell costs 32 bytes, so a full 120-column scrollback is about
/// 19 MB; xterm keeps 10 000 lines of its own on the page.
pub const SCROLLBACK: usize = 5_000;

/// What the program set that vt100 ignores.
#[derive(Default)]
struct Extras {
    title: Option<Vec<u8>>,
    cwd: Option<String>,
    focus: bool,
    cursor_shape: Option<u16>,
}

impl vt100::Callbacks for Extras {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.title = Some(title.to_vec());
    }

    fn unhandled_osc(&mut self, _: &mut vt100::Screen, params: &[&[u8]]) {
        // vt100 splits on `;`, which a folder may hold.
        if let [b"7", rest @ ..] = params {
            if let Some(path) = parse_osc7(&rest.join(&b';')) {
                self.cwd = Some(path);
            }
        }
    }

    fn unhandled_csi(&mut self, _: &mut vt100::Screen, i1: Option<u8>, _: Option<u8>, params: &[&[u16]], c: char) {
        match (i1, c) {
            (Some(b'?'), 'h' | 'l') if params.iter().any(|p| p.first() == Some(&1004)) => self.focus = c == 'h',
            // DECSCUSR: 0 is the terminal's default shape.
            (Some(b' '), 'q') => self.cursor_shape = params.first().and_then(|p| p.first()).copied().filter(|&n| n != 0),
            _ => {}
        }
    }
}

/// `file://host/path` → the path, percent-decoded; `None` when it is not a file URL or not UTF-8.
/// The same reading as `src/terminal/osc7.ts`.
pub fn parse_osc7(data: &[u8]) -> Option<String> {
    let rest = data.strip_prefix(b"file://")?;
    let path = &rest[rest.iter().position(|&b| b == b'/')?..];
    let mut out = Vec::with_capacity(path.len());
    let mut i = 0;
    while i < path.len() {
        if path[i] == b'%' {
            let hex = std::str::from_utf8(path.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(path[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub struct Screen {
    vt: vt100::Parser<Extras>,
}

impl Screen {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self { vt: vt100::Parser::new_with_callbacks(rows.max(1), cols.max(1), SCROLLBACK, Extras::default()) }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.vt.process(bytes);
        // RIS (`reset`) puts every mode back; vt100 does its own, these are ours.
        if bytes.windows(2).any(|w| w == b"\x1bc") {
            let x = self.vt.callbacks_mut();
            x.focus = false;
            x.cursor_shape = None;
        }
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.vt.screen_mut().set_size(rows.max(1), cols.max(1));
    }

    /// The folder the shell last reported, if it reports one.
    pub fn cwd(&self) -> Option<&str> {
        self.vt.callbacks().cwd.as_deref()
    }

    /// Bytes that draw this terminal again in an empty xterm: `CSI 8 ; rows ; cols t` first, the
    /// size it was drawn at (the pane sizes itself to it, then refits and reflows); the scrollback,
    /// each line in its colours, pushed above the screen; the screen, cursor and input modes
    /// (bracketed paste, application keys, mouse); then focus reporting, cursor shape, title and
    /// folder.
    ///
    /// A program on the alternate screen (vim, less) comes back on it, but the main screen and its
    /// scrollback do not: vt100 keeps them out of reach until the program leaves.
    pub fn snapshot(&mut self) -> Vec<u8> {
        let (rows, cols) = self.vt.screen().size();
        let mut out = format!("\x1b[8;{rows};{cols}t").into_bytes();
        if self.vt.screen().alternate_screen() {
            out.extend_from_slice(b"\x1b[?1049h");
        } else {
            self.write_scrollback(&mut out, rows, cols);
        }
        out.extend(self.vt.screen().state_formatted());
        let x = self.vt.callbacks();
        if x.focus {
            out.extend_from_slice(b"\x1b[?1004h");
        }
        let mut tail = String::new();
        if let Some(n) = x.cursor_shape {
            let _ = write!(tail, "\x1b[{n} q");
        }
        if let Some(title) = &x.title {
            let title: String = String::from_utf8_lossy(title).chars().filter(|c| !c.is_control()).collect();
            let _ = write!(tail, "\x1b]2;{title}\x07");
        }
        if let Some(cwd) = &x.cwd {
            let _ = write!(tail, "\x1b]7;file://{}\x07", percent_encode(cwd));
        }
        out.extend_from_slice(tail.as_bytes());
        out
    }

    /// Every scrollback line, oldest first, then enough line feeds that all of them scroll into
    /// xterm's history before the screen is drawn over the visible rows. A line vt100 wrapped goes
    /// on without a line break, so xterm reflows it as one line when the pane is resized.
    fn write_scrollback(&mut self, out: &mut Vec<u8>, rows: u16, cols: u16) {
        let screen = self.vt.screen_mut();
        screen.set_scrollback(usize::MAX);
        let total = screen.scrollback();
        let mut done = 0;
        while done < total {
            // Scrolled back by `total - done`, the view starts at scrollback line `done`.
            screen.set_scrollback(total - done);
            let take = (total - done).min(usize::from(rows));
            let lines: Vec<Vec<u8>> = screen.rows_formatted(0, cols).take(take).collect();
            for (i, line) in lines.into_iter().enumerate() {
                out.extend(line);
                // Each row is formatted from default attributes.
                out.extend_from_slice(b"\x1b[m");
                let last = done + i + 1 == total;
                if last || !screen.row_wrapped(i as u16) {
                    out.extend_from_slice(b"\r\n");
                }
            }
            done += take;
        }
        screen.set_scrollback(0);
        if total > 0 {
            out.extend(std::iter::repeat(b'\n').take(usize::from(rows) - 1));
        }
    }
}

/// A path as OSC 7 carries it: bytes outside the unreserved set and `/` as `%XX`.
fn percent_encode(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for &b in path.as_bytes() {
        if b.is_ascii_alphanumeric() || b"/-._~".contains(&b) {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What an xterm of the same size shows after the snapshot: a vt100 standing in for it.
    fn replay(snapshot: &[u8], rows: u16, cols: u16) -> vt100::Parser {
        let mut p = vt100::Parser::new(rows, cols, 10_000);
        p.process(snapshot);
        p
    }

    /// Every line of `p`, history first, as text.
    fn all_lines(p: &mut vt100::Parser) -> Vec<String> {
        let screen = p.screen_mut();
        screen.set_scrollback(usize::MAX);
        let back = screen.scrollback();
        let (rows, cols) = screen.size();
        let mut out = Vec::new();
        let mut done = 0;
        while done < back {
            screen.set_scrollback(back - done);
            let take = (back - done).min(usize::from(rows));
            out.extend(screen.rows(0, cols).take(take));
            done += take;
        }
        screen.set_scrollback(0);
        out.extend(screen.rows(0, cols));
        out
    }

    #[test]
    fn the_screen_and_cursor_come_back() {
        let mut s = Screen::new(5, 20);
        s.feed(b"$ echo hi\r\nhi\r\n$ ");
        let snap = s.snapshot();
        assert!(snap.starts_with(b"\x1b[8;5;20t"), "{:?}", String::from_utf8_lossy(&snap));
        let p = replay(&snap, 5, 20);
        assert_eq!(p.screen().contents(), s.vt.screen().contents());
        assert!(p.screen().contents().starts_with("$ echo hi\nhi\n$"));
        assert_eq!(p.screen().cursor_position(), (2, 2));
    }

    #[test]
    fn scrollback_comes_back_above_the_screen_in_order() {
        let mut s = Screen::new(4, 10);
        for n in 1..=30 {
            s.feed(format!("line {n}\r\n").as_bytes());
        }
        let mut p = replay(&s.snapshot(), 4, 10);
        let lines = all_lines(&mut p);
        let text: Vec<&str> = lines.iter().map(|l| l.trim_end()).filter(|l| !l.is_empty()).collect();
        let want: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
        assert_eq!(text, want);
        // The screen is the screen, not history pushed down: the last lines, cursor below them.
        assert_eq!(p.screen().contents(), "line 28\nline 29\nline 30");
        assert_eq!(p.screen().cursor_position(), (3, 0));
    }

    #[test]
    fn colours_in_scrollback_survive() {
        let mut s = Screen::new(3, 20);
        s.feed(b"\x1b[31mred\x1b[m plain\r\n");
        // A line that ends coloured does not colour the next.
        s.feed(b"\x1b[42mgreen to the end\r\n\x1b[mplain\r\n");
        for _ in 0..10 {
            s.feed(b"x\r\n");
        }
        let mut p = replay(&s.snapshot(), 3, 20);
        p.screen_mut().set_scrollback(usize::MAX);
        let top = p.screen().cell(0, 0).expect("a cell");
        assert_eq!(top.contents(), "r");
        assert_eq!(top.fgcolor(), vt100::Color::Idx(1));
        assert_eq!(p.screen().cell(0, 4).unwrap().fgcolor(), vt100::Color::Default);
        assert_eq!(p.screen().cell(1, 0).unwrap().bgcolor(), vt100::Color::Idx(2));
        assert_eq!(p.screen().cell(2, 0).unwrap().contents(), "p");
        assert_eq!(p.screen().cell(2, 0).unwrap().bgcolor(), vt100::Color::Default);
    }

    #[test]
    fn a_wrapped_line_in_scrollback_stays_one_line() {
        let mut s = Screen::new(3, 10);
        s.feed(b"abcdefghijklmnopqrstuvwxy\r\n");
        for _ in 0..6 {
            s.feed(b"-\r\n");
        }
        let snap = s.snapshot();
        let text = String::from_utf8_lossy(&snap);
        // No line break inside it: xterm keeps it as one line and reflows it.
        assert!(text.contains("abcdefghij\x1b[mklmnopqrst\x1b[muvwxy"), "{text:?}");
        let mut p = replay(&snap, 3, 10);
        p.screen_mut().set_scrollback(usize::MAX);
        assert!(p.screen().row_wrapped(0) && p.screen().row_wrapped(1) && !p.screen().row_wrapped(2));
    }

    #[test]
    fn nothing_scrolled_means_no_line_feeds_before_the_screen() {
        let mut s = Screen::new(5, 20);
        s.feed(b"one\r\n");
        let snap = s.snapshot();
        let after_size = &snap[b"\x1b[8;5;20t".len()..];
        assert!(!after_size.starts_with(b"\n"), "{:?}", String::from_utf8_lossy(&snap));
    }

    #[test]
    fn modes_title_and_folder_come_back() {
        let mut s = Screen::new(5, 20);
        s.feed(b"\x1b[?2004h\x1b[?1004h\x1b[5 q\x1b]0;claude\x07\x1b]7;file://mac/Users/me/a%20dir\x07");
        assert_eq!(s.cwd(), Some("/Users/me/a dir"));
        let snap = String::from_utf8_lossy(&s.snapshot()).into_owned();
        for want in ["\x1b[?2004h", "\x1b[?1004h", "\x1b[5 q", "\x1b]2;claude\x07", "\x1b]7;file:///Users/me/a%20dir\x07"] {
            assert!(snap.contains(want), "{want:?} missing from {snap:?}");
        }

        s.feed(b"\x1b[?1004l\x1b[0 q\x1b[?2004l");
        let snap = String::from_utf8_lossy(&s.snapshot()).into_owned();
        assert!(!snap.contains("\x1b[?1004h") && !snap.contains(" q") && !snap.contains("\x1b[?2004h"), "{snap:?}");
    }

    #[test]
    fn reset_turns_our_modes_off() {
        let mut s = Screen::new(5, 20);
        s.feed(b"\x1b[?1004h\x1b[3 q");
        s.feed(b"\x1bc");
        let snap = String::from_utf8_lossy(&s.snapshot()).into_owned();
        assert!(!snap.contains("\x1b[?1004h") && !snap.contains("\x1b[3 q"), "{snap:?}");
    }

    #[test]
    fn the_alternate_screen_comes_back_on_the_alternate_screen() {
        let mut s = Screen::new(4, 20);
        s.feed(b"shell\r\n\x1b[?1049h\x1b[H\x1b[2Jvim here");
        let snap = s.snapshot();
        let p = replay(&snap, 4, 20);
        assert!(p.screen().alternate_screen());
        assert_eq!(p.screen().contents(), "vim here");
    }

    #[test]
    fn a_resize_is_what_the_next_snapshot_says() {
        let mut s = Screen::new(5, 20);
        s.resize(30, 100);
        assert!(s.snapshot().starts_with(b"\x1b[8;30;100t"));
    }

    #[test]
    fn osc7_reads_like_the_front_does() {
        assert_eq!(parse_osc7(b"file://host/a%20b/c").as_deref(), Some("/a%20b/c".replace("%20", " ").as_str()));
        assert_eq!(parse_osc7(b"file:///x").as_deref(), Some("/x"));
        assert_eq!(parse_osc7(b"file://host"), None);
        assert_eq!(parse_osc7(b"http://host/x"), None);
        assert_eq!(parse_osc7(b"file://h/%zz"), None);
        assert_eq!(parse_osc7(b"file://h/%C3%A9"), Some("/é".into()));
        // A folder with `;` in it comes through whole.
        let mut s = Screen::new(2, 10);
        s.feed(b"\x1b]7;file://h/a;b\x07");
        assert_eq!(s.cwd(), Some("/a;b"));
        assert_eq!(percent_encode("/a b;é"), "/a%20b%3B%C3%A9");
    }
}

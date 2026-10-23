//! The window the maintainer was in before this app: its title tells the panel which project a
//! request is about (#505, decision 2). Read through the Windows API, never a screenshot.
//!
//! When another app's window is in front, it is that one. When this app is (the maintainer is
//! typing to Jarvis), it is the first window below it in the z-order that a person could have
//! been using: activating a window brings it to the top, so the one under this app's is the one
//! left last. Hidden, minimized, cloaked (a suspended UWP app), tool, overlay and always-on-top
//! windows, the taskbar and the desktop are passed over.

/// What `pick` needs of a top-level window.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Win {
    pub pid: u32,
    pub title: String,
    pub class: String,
    pub visible: bool,
    pub minimized: bool,
    pub cloaked: bool,
    pub ex_style: u32,
}

/// `WS_EX_TOPMOST`, `WS_EX_TOOLWINDOW`, `WS_EX_NOACTIVATE` (`winuser.h`).
const WS_EX_TOPMOST: u32 = 0x0000_0008;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;

/// The shell's own windows: the taskbars and the desktop.
const SHELL_CLASSES: &[&str] = &["Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW"];

fn titled(w: &Win, me: u32) -> bool {
    w.pid != me && !w.title.trim().is_empty()
}

/// A window someone could have been working in.
fn usable(w: &Win, me: u32) -> bool {
    titled(w, me)
        && w.visible
        && !w.minimized
        && !w.cloaked
        && w.ex_style & (WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) == 0
        && !SHELL_CLASSES.contains(&w.class.as_str())
}

/// The title of the window in front when it is not this process's (`me`), else of the first
/// usable one in `z_order`, top first.
pub fn pick(foreground: Option<Win>, z_order: impl IntoIterator<Item = Win>, me: u32) -> Option<String> {
    if let Some(f) = foreground {
        if titled(&f, me) && !SHELL_CLASSES.contains(&f.class.as_str()) {
            return Some(f.title.trim().to_string());
        }
    }
    z_order.into_iter().find(|w| usable(w, me)).map(|w| w.title.trim().to_string())
}

/// The title of the last window in front that was not this app; None off Windows.
#[cfg(not(windows))]
pub fn focused_window() -> Option<String> {
    None
}

#[cfg(windows)]
pub fn focused_window() -> Option<String> {
    os::focused_window()
}

#[cfg(windows)]
mod os {
    use super::{pick, Win};
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetTopWindow, GetWindow, GetWindowLongW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible,
        GWL_EXSTYLE, GW_HWNDNEXT,
    };

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(hwnd: HWND, attribute: u32, value: *mut core::ffi::c_void, size: u32) -> i32;
    }

    /// `DWMWA_CLOAKED` (`dwmapi.h`).
    const DWMWA_CLOAKED: u32 = 14;

    /// How many windows down the z-order are looked at, at most.
    const Z_MAX: usize = 2000;

    fn text(read: impl Fn(*mut u16, i32) -> i32) -> String {
        let mut buf = [0u16; 512];
        let n = read(buf.as_mut_ptr(), buf.len() as i32).clamp(0, buf.len() as i32) as usize;
        String::from_utf16_lossy(&buf[..n])
    }

    fn win(h: HWND) -> Win {
        // SAFETY: each call takes a window handle and buffers this function owns; a handle that
        // has gone stale since makes them fail, which reads as an empty or hidden window.
        unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            let mut cloaked = 0u32;
            let got = DwmGetWindowAttribute(h, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), std::mem::size_of::<u32>() as u32);
            Win {
                pid,
                title: text(|b, n| GetWindowTextW(h, b, n)),
                class: text(|b, n| GetClassNameW(h, b, n)),
                visible: IsWindowVisible(h) != 0,
                minimized: IsIconic(h) != 0,
                cloaked: got == 0 && cloaked != 0,
                ex_style: GetWindowLongW(h, GWL_EXSTYLE) as u32,
            }
        }
    }

    pub fn focused_window() -> Option<String> {
        let me = std::process::id();
        // SAFETY: no arguments; a null handle is checked before use.
        let front = unsafe { GetForegroundWindow() };
        let foreground = (!front.is_null()).then(|| win(front));
        let mut next = unsafe { GetTopWindow(std::ptr::null_mut()) };
        let z_order = std::iter::from_fn(move || {
            if next.is_null() {
                return None;
            }
            let h = next;
            // SAFETY: `h` is a window handle the previous call returned.
            next = unsafe { GetWindow(h, GW_HWNDNEXT) };
            Some(win(h))
        })
        .take(Z_MAX);
        pick(foreground, z_order, me)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: u32 = 100;

    fn w(pid: u32, title: &str) -> Win {
        Win { pid, title: title.into(), class: "Chrome_WidgetWin_1".into(), visible: true, ..Default::default() }
    }

    #[test]
    fn another_apps_window_in_front_is_the_one() {
        assert_eq!(pick(Some(w(7, "main.rs - app - Visual Studio Code")), vec![w(ME, "mnemo")], ME).as_deref(), Some("main.rs - app - Visual Studio Code"));
    }

    #[test]
    fn with_this_app_in_front_it_is_the_first_usable_one_below() {
        let z = vec![
            Win { ex_style: WS_EX_TOPMOST, ..w(3, "Overlay") },
            w(ME, "mnemo desktop"),
            Win { visible: false, ..w(4, "Hidden") },
            Win { cloaked: true, ..w(5, "Settings") },
            Win { minimized: true, ..w(6, "Minimized") },
            Win { ex_style: WS_EX_TOOLWINDOW, ..w(8, "Tool") },
            w(9, ""),
            Win { class: "Shell_TrayWnd".into(), ..w(10, "Taskbar") },
            w(11, "app — PowerShell"),
            w(12, "Older"),
        ];
        assert_eq!(pick(Some(w(ME, "mnemo desktop")), z.clone(), ME).as_deref(), Some("app — PowerShell"));
        assert_eq!(pick(None, z, ME).as_deref(), Some("app — PowerShell"));
        assert_eq!(pick(Some(Win { class: "Progman".into(), ..w(2, "Program Manager") }), vec![w(12, "Older")], ME).as_deref(), Some("Older"));
        assert_eq!(pick(Some(w(ME, "mnemo")), vec![w(ME, "mnemo")], ME), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn none_off_windows() {
        assert_eq!(focused_window(), None);
    }
}

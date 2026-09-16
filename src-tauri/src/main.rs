#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Answered before Tauri starts, so asking an installed bundle which commit it is
    // costs a print and not a window (#88).
    if std::env::args().skip(1).any(|a| a == "--version" || a == "-V") {
        println!("{}", mnemo_desktop_lib::build_info::version_line());
        return;
    }
    mnemo_desktop_lib::run()
}

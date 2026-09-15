use crate::pty::{Event, PaneId, PtyManager, SpawnOptions};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

pub struct PtyState(pub PtyManager);

#[derive(Serialize, Clone)]
struct ExitPayload {
    code: Option<i32>,
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    on_output: Channel<InvokeResponseBody>,
) -> Result<PaneId, String> {
    // The sink is built before the id exists; the slot is filled right after spawn returns.
    // `Exit` needs the child to have run, so the slot is always set by then.
    let id_slot = Arc::new(Mutex::new(None::<PaneId>));
    let slot = Arc::clone(&id_slot);
    let sink = Box::new(move |e: Event| match e {
        Event::Output(bytes) => {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes));
        }
        Event::Exit(code) => {
            let id = slot.lock().unwrap().unwrap_or(0);
            let _ = app.emit(&format!("pty://exit/{id}"), ExitPayload { code });
        }
    });
    let id = state.0.spawn(
        SpawnOptions { program: None, args: vec![], cwd, cols, rows, login: true },
        sink,
    )?;
    *id_slot.lock().unwrap() = Some(id);
    Ok(id)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: PaneId, data: String) -> Result<(), String> {
    state.0.write(id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
    state.0.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: PaneId) {
    state.0.kill(id)
}

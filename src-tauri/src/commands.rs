use crate::pty::{Event, PaneId, PtyInfo, PtyManager, Sink, SpawnOptions};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody, Response};
use tauri::{AppHandle, Emitter, State};

pub struct PtyState(pub PtyManager);

#[derive(Serialize, Clone)]
struct ExitPayload {
    code: Option<i32>,
}

/// Output to `on_output`, the exit as `pty://exit/<id>`; `id` is read when the exit comes.
fn sink(app: AppHandle, id: Arc<Mutex<Option<PaneId>>>, on_output: Channel<InvokeResponseBody>) -> Sink {
    Box::new(move |e: Event| match e {
        Event::Output(bytes) => {
            let _ = on_output.send(InvokeResponseBody::Raw(bytes));
        }
        Event::Exit(code) => {
            let id = id.lock().unwrap().unwrap_or(0);
            let _ = app.emit(&format!("pty://exit/{id}"), ExitPayload { code });
        }
    })
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
    let id = state.0.spawn(
        SpawnOptions { program: None, args: vec![], cwd, cols, rows, login: true },
        sink(app, Arc::clone(&id_slot), on_output),
    )?;
    *id_slot.lock().unwrap() = Some(id);
    Ok(id)
}

/// Every terminal still held — running, or ended while no pane was attached — so a restored
/// workspace can attach its panes to their shells. Off the main thread, as `pty_attach`: the first
/// call of a launch may start the daemon.
#[tauri::command(async)]
pub fn pty_list(state: State<'_, PtyState>) -> Result<Vec<PtyInfo>, String> {
    state.0.list()
}

/// Sends terminal `id`'s output to `on_output` from now on (a reloaded page, a relaunched app),
/// and answers the bytes that draw it as it is now, to write before that output. Fails when its
/// program has ended: the pane starts a new shell. Off the main thread: a full scrollback is a few
/// MB to draw and send, for each pane of a restored workspace.
#[tauri::command(async)]
pub fn pty_attach(app: AppHandle, state: State<'_, PtyState>, id: PaneId, on_output: Channel<InvokeResponseBody>) -> Result<Response, String> {
    state.0.attach(id, sink(app, Arc::new(Mutex::new(Some(id))), on_output)).map(Response::new)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: PaneId, data: String) -> Result<(), String> {
    state.0.write(id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: PaneId, cols: u16, rows: u16) -> Result<(), String> {
    state.0.resize(id, cols, rows)
}

/// The shell's pid, for walking the process tree under a pane (see `chrome_session`).
#[tauri::command]
pub fn pty_pid(state: State<'_, PtyState>, id: PaneId) -> Option<u32> {
    state.0.pid(id)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: PaneId) {
    state.0.kill(id)
}

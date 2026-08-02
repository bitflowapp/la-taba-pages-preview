mod outbox;
mod printing;

use outbox::LocalCommand;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_notification::NotificationExt;

struct DesktopState {
    database: Mutex<Connection>,
    database_path: String,
    muted: AtomicBool,
    explicit_exit: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    database_path: String,
    log_directory: String,
    muted: bool,
    autostart_enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NotificationPayload {
    title: String,
    body: String,
}

#[tauri::command]
fn initialize_business_runtime(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<RuntimeInfo, String> {
    let log_directory = app
        .path()
        .app_log_dir()
        .map_err(|_| "No se pudo resolver el directorio de logs.".to_string())?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    Ok(RuntimeInfo {
        database_path: state.database_path.clone(),
        log_directory: log_directory.to_string_lossy().into_owned(),
        muted: state.muted.load(Ordering::Relaxed),
        autostart_enabled,
    })
}

#[tauri::command]
fn outbox_put(
    state: State<'_, DesktopState>,
    command: LocalCommand,
) -> Result<LocalCommand, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    outbox::put(&connection, &command)
}

#[tauri::command]
fn outbox_get(
    state: State<'_, DesktopState>,
    command_id: String,
) -> Result<Option<LocalCommand>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    outbox::get(&connection, &command_id)
}

#[tauri::command]
fn outbox_list(state: State<'_, DesktopState>) -> Result<Vec<LocalCommand>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    outbox::list(&connection)
}

#[tauri::command]
fn outbox_find_by_idempotency_key(
    state: State<'_, DesktopState>,
    idempotency_key: String,
) -> Result<Option<LocalCommand>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    outbox::find_by_idempotency_key(&connection, &idempotency_key)
}

#[tauri::command]
fn notify_business_event(
    app: AppHandle,
    state: State<'_, DesktopState>,
    payload: NotificationPayload,
) -> Result<bool, String> {
    if state.muted.load(Ordering::Relaxed) {
        return Ok(false);
    }
    if payload.title.trim().is_empty() || payload.title.len() > 100 || payload.body.len() > 300 {
        return Err("Notificación fuera de rango.".into());
    }
    app.notification()
        .builder()
        .title(payload.title)
        .body(payload.body)
        .show()
        .map_err(|_| "Windows rechazó la notificación.".to_string())?;
    Ok(true)
}

#[tauri::command]
fn set_notifications_muted(state: State<'_, DesktopState>, muted: bool) -> bool {
    state.muted.store(muted, Ordering::Relaxed);
    muted
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|_| "No se pudo actualizar el inicio automático.".to_string())?;
    manager
        .is_enabled()
        .map_err(|_| "No se pudo verificar el inicio automático.".to_string())
}

#[tauri::command]
fn list_printers() -> Result<Vec<printing::PrinterInfo>, String> {
    printing::list_printers()
}

#[tauri::command]
fn print_document(request: printing::PrintRequest) -> Result<bool, String> {
    printing::print(&request)?;
    Ok(true)
}

#[tauri::command]
fn exit_application(app: AppHandle, state: State<'_, DesktopState>) -> bool {
    state.explicit_exit.store(true, Ordering::Relaxed);
    app.exit(0);
    true
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir TABA Negocio", true, None::<&str>)?;
    let mute = MenuItem::with_id(
        app,
        "mute",
        "Silenciar / activar alertas",
        true,
        None::<&str>,
    )?;
    let status = MenuItem::with_id(app, "status", "Estado: iniciado", false, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &mute, &status, &exit])?;
    let icon = app.default_window_icon().cloned();
    let mut tray = TrayIconBuilder::new()
        .tooltip("TABA Negocio")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }
    tray.on_menu_event(|app, event| match event.id.as_ref() {
        "open" => focus_main_window(app),
        "mute" => {
            let state = app.state::<DesktopState>();
            let next = !state.muted.load(Ordering::Relaxed);
            state.muted.store(next, Ordering::Relaxed);
        }
        "exit" => {
            let state = app.state::<DesktopState>();
            state.explicit_exit.store(true, Ordering::Relaxed);
            app.exit(0);
        }
        _ => {}
    })
    .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            focus_main_window(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            focus_main_window(app)
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("taba-negocio".into()),
                    },
                ))
                .max_file_size(2_000_000)
                .build(),
        )
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let database_path = data_dir.join("taba-negocio.sqlite3");
            let database = Connection::open(&database_path)?;
            outbox::migrate(&database).map_err(std::io::Error::other)?;
            app.manage(DesktopState {
                database: Mutex::new(database),
                database_path: database_path.to_string_lossy().into_owned(),
                muted: AtomicBool::new(false),
                explicit_exit: AtomicBool::new(false),
            });
            build_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<DesktopState>();
                if !state.explicit_exit.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            initialize_business_runtime,
            outbox_put,
            outbox_get,
            outbox_list,
            outbox_find_by_idempotency_key,
            notify_business_event,
            set_notifications_muted,
            set_autostart_enabled,
            list_printers,
            print_document,
            exit_application
        ])
        .build(tauri::generate_context!())
        .expect("failed to build TABA Negocio")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<DesktopState>();
                if !state.explicit_exit.load(Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
        });
}

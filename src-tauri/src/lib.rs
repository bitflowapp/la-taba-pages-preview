mod fiscal_printing;
mod outbox;
mod packing_cache;
mod printing;
mod support;
mod updates;

use outbox::LocalCommand;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
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
    fiscal_spool_directory: String,
    backup_directory: PathBuf,
    support_export_directory: PathBuf,
    muted: AtomicBool,
    explicit_exit: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    version: String,
    build: String,
    os: String,
    arch: String,
    muted: bool,
    autostart_enabled: bool,
    database_health: String,
    wal_enabled: bool,
    pending_command_count: i64,
    uncertain_print_count: i64,
    signed_updater_configured: bool,
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
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let health = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Persistencia local ocupada.".to_string())?;
        support::runtime_health(&connection)?
    };
    Ok(RuntimeInfo {
        version: app.package_info().version.to_string(),
        build: option_env!("TABA_BUILD_SHA")
            .unwrap_or("local-unidentified")
            .to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        muted: state.muted.load(Ordering::Relaxed),
        autostart_enabled,
        database_health: health.database_health,
        wal_enabled: health.wal_enabled,
        pending_command_count: health.pending_command_count,
        uncertain_print_count: health.uncertain_print_count,
        signed_updater_configured: updates::is_configured(),
    })
}

#[tauri::command]
fn create_local_backup(
    state: State<'_, DesktopState>,
) -> Result<support::LocalBackupResult, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    support::create_local_backup(&connection, &state.backup_directory)
}

#[tauri::command]
fn verify_local_backup(
    state: State<'_, DesktopState>,
    backup_id: String,
) -> Result<support::LocalBackupResult, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    support::verify_local_backup(&connection, &state.backup_directory, &backup_id)
}

#[tauri::command]
fn export_support_diagnostic(
    state: State<'_, DesktopState>,
    request: support::SupportDiagnosticRequest,
) -> Result<support::SupportExportResult, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    support::export_support_diagnostic(&connection, &state.support_export_directory, &request)
}

#[tauri::command]
fn open_support_export_folder(state: State<'_, DesktopState>) -> Result<bool, String> {
    support::open_private_directory(&state.support_export_directory)
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
fn save_packing_cache(
    state: State<'_, DesktopState>,
    snapshot: packing_cache::PackingCacheSnapshot,
) -> Result<packing_cache::PackingCacheSnapshot, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    packing_cache::save(&mut connection, &snapshot)
}

#[tauri::command]
fn load_packing_cache(
    state: State<'_, DesktopState>,
    business_id: String,
) -> Result<Option<packing_cache::PackingCacheSnapshot>, String> {
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    packing_cache::load(&connection, &business_id)
}

#[tauri::command]
fn delete_packing_cache(
    state: State<'_, DesktopState>,
    business_id: String,
) -> Result<bool, String> {
    let mut connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    packing_cache::delete(&mut connection, &business_id)
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
fn probe_printer(printer_name: String) -> Result<printing::PrinterProbe, String> {
    printing::probe_printer(&printer_name)
}

#[tauri::command]
fn print_document(request: printing::PrintRequest) -> Result<bool, String> {
    printing::print(&request)?;
    Ok(true)
}

#[tauri::command]
fn queue_fiscal_print(
    state: State<'_, DesktopState>,
    request: fiscal_printing::FiscalPrintRequest,
) -> Result<fiscal_printing::FiscalPrintOutcome, String> {
    let spool_directory = state.fiscal_spool_directory.clone();
    let job = {
        let connection = state
            .database
            .lock()
            .map_err(|_| "Persistencia local ocupada.".to_string())?;
        fiscal_printing::enqueue(&connection, Path::new(&spool_directory), &request)?
    };
    let outcome = fiscal_printing::dispatch(Path::new(&spool_directory), &job, &request);
    let connection = state
        .database
        .lock()
        .map_err(|_| "Persistencia local ocupada.".to_string())?;
    fiscal_printing::record_outcome(&connection, &request.print_job_id, &outcome)?;
    Ok(outcome)
}

#[tauri::command]
fn open_fiscal_cache_folder(state: State<'_, DesktopState>) -> Result<bool, String> {
    fiscal_printing::open_spool_directory(Path::new(&state.fiscal_spool_directory))
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            let fiscal_spool_directory = data_dir.join("fiscal-spool");
            let backup_directory = data_dir.join("backups");
            let support_export_directory = data_dir.join("support-exports");
            let database = Connection::open(&database_path)?;
            outbox::migrate(&database).map_err(std::io::Error::other)?;
            packing_cache::migrate(&database).map_err(std::io::Error::other)?;
            fiscal_printing::migrate(&database).map_err(std::io::Error::other)?;
            support::migrate(&database).map_err(std::io::Error::other)?;
            std::fs::create_dir_all(&fiscal_spool_directory)?;
            std::fs::create_dir_all(&backup_directory)?;
            std::fs::create_dir_all(&support_export_directory)?;
            app.manage(DesktopState {
                database: Mutex::new(database),
                fiscal_spool_directory: fiscal_spool_directory.to_string_lossy().into_owned(),
                backup_directory,
                support_export_directory,
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
            create_local_backup,
            verify_local_backup,
            export_support_diagnostic,
            open_support_export_folder,
            updates::check_for_signed_update,
            updates::install_signed_update,
            outbox_put,
            outbox_get,
            outbox_list,
            outbox_find_by_idempotency_key,
            save_packing_cache,
            load_packing_cache,
            delete_packing_cache,
            notify_business_event,
            set_notifications_muted,
            set_autostart_enabled,
            list_printers,
            probe_printer,
            print_document,
            queue_fiscal_print,
            open_fiscal_cache_folder,
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

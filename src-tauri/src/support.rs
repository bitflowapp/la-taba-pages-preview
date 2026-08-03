use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub database_health: String,
    pub wal_enabled: bool,
    pub pending_command_count: i64,
    pub uncertain_print_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBackupResult {
    pub backup_id: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub integrity_verified: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportExportResult {
    pub export_id: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SupportDiagnosticRequest {
    pub network_status: String,
    pub active_view: String,
    #[serde(default)]
    pub correlation_ids: Vec<String>,
}

pub fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS local_backups (
               backup_id TEXT PRIMARY KEY,
               file_name TEXT NOT NULL UNIQUE,
               sha256 TEXT,
               size_bytes INTEGER,
               status TEXT NOT NULL CHECK(status IN ('creating','ready','failed')),
               created_at TEXT NOT NULL,
               verified_at TEXT,
               error_code TEXT
             );
             CREATE INDEX IF NOT EXISTS local_backups_status_idx
               ON local_backups(status, created_at);
             CREATE TABLE IF NOT EXISTS local_support_exports (
               export_id TEXT PRIMARY KEY,
               file_name TEXT NOT NULL UNIQUE,
               sha256 TEXT NOT NULL,
               size_bytes INTEGER NOT NULL,
               created_at TEXT NOT NULL
             );",
        )
        .map_err(db_error)
}

pub fn runtime_health(connection: &Connection) -> Result<RuntimeHealth, String> {
    let database_health = quick_check(connection)?;
    let journal_mode: String = connection
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .map_err(db_error)?;
    let pending_command_count = count_where(
        connection,
        "SELECT count(*) FROM local_commands WHERE state IN ('pending','sending','conflicted','failed')",
    )?;
    let uncertain_print_count = count_where(
        connection,
        "SELECT count(*) FROM local_fiscal_print_jobs WHERE status IN ('queued','sent_to_spooler','failed','unknown')",
    )?;
    Ok(RuntimeHealth {
        database_health,
        wal_enabled: journal_mode.eq_ignore_ascii_case("wal"),
        pending_command_count,
        uncertain_print_count,
    })
}

pub fn create_local_backup(
    connection: &Connection,
    backup_directory: &Path,
) -> Result<LocalBackupResult, String> {
    fs::create_dir_all(backup_directory).map_err(|error| {
        log_io("create backup directory", &error);
        "No se pudo preparar el directorio privado de backups.".to_string()
    })?;
    let backup_id = unique_id("backup");
    let file_name = format!("{backup_id}.sqlite3");
    let backup_path = confined_path(backup_directory, &file_name)?;
    let created_at = unix_millis();

    connection
        .execute(
            "INSERT INTO local_backups(backup_id,file_name,status,created_at)
             VALUES(?1,?2,'creating',?3)",
            params![backup_id, file_name, created_at],
        )
        .map_err(db_error)?;

    let path_text = backup_path
        .to_str()
        .ok_or_else(|| "El directorio de backup no es compatible con SQLite.".to_string())?;
    if let Err(error) = connection.execute("VACUUM INTO ?1", [path_text]) {
        mark_backup_failed(connection, &backup_id, "BACKUP_WRITE_FAILED");
        log_database_error("backup vacuum", &error);
        return Err("No se pudo crear una copia consistente de la base local.".into());
    }

    let size_bytes = file_size(&backup_path)?;
    let sha256 = sha256_file(&backup_path)?;
    if verify_backup_file(&backup_path, &sha256).is_err() {
        mark_backup_failed(connection, &backup_id, "BACKUP_INTEGRITY_FAILED");
        return Err(
            "El backup local fue creado pero no supero la verificacion de integridad.".into(),
        );
    }
    let verified_at = unix_millis();
    connection
        .execute(
            "UPDATE local_backups
                SET sha256=?2,size_bytes=?3,status='ready',verified_at=?4,error_code=NULL
              WHERE backup_id=?1 AND status='creating'",
            params![backup_id, sha256, size_bytes, verified_at],
        )
        .map_err(db_error)?;
    Ok(LocalBackupResult {
        backup_id,
        created_at,
        size_bytes,
        sha256,
        integrity_verified: true,
    })
}

pub fn verify_local_backup(
    connection: &Connection,
    backup_directory: &Path,
    backup_id: &str,
) -> Result<LocalBackupResult, String> {
    if !safe_identifier(backup_id, "backup-") {
        return Err("Identificador de backup local invalido.".into());
    }
    let record = connection
        .query_row(
            "SELECT file_name,sha256,size_bytes,created_at
               FROM local_backups
              WHERE backup_id=?1 AND status='ready'",
            [backup_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "El backup local solicitado no esta disponible.".to_string())?;
    let backup_path = confined_path(backup_directory, &record.0)?;
    let actual_size = file_size(&backup_path)?;
    let actual_hash = sha256_file(&backup_path)?;
    if actual_hash != record.1 || actual_size != u64::try_from(record.2).unwrap_or(u64::MAX) {
        mark_backup_failed(connection, backup_id, "BACKUP_HASH_MISMATCH");
        return Err("El backup local no coincide con su hash registrado.".into());
    }
    verify_backup_file(&backup_path, &record.1).map_err(|_| {
        mark_backup_failed(connection, backup_id, "BACKUP_INTEGRITY_FAILED");
        "El backup local no supero la verificacion de SQLite.".to_string()
    })?;
    connection
        .execute(
            "UPDATE local_backups SET verified_at=?2,error_code=NULL WHERE backup_id=?1",
            params![backup_id, unix_millis()],
        )
        .map_err(db_error)?;
    Ok(LocalBackupResult {
        backup_id: backup_id.to_string(),
        created_at: record.3,
        size_bytes: actual_size,
        sha256: actual_hash,
        integrity_verified: true,
    })
}

pub fn export_support_diagnostic(
    connection: &Connection,
    export_directory: &Path,
    request: &SupportDiagnosticRequest,
) -> Result<SupportExportResult, String> {
    validate_support_request(request)?;
    fs::create_dir_all(export_directory).map_err(|error| {
        log_io("create support export directory", &error);
        "No se pudo preparar el directorio privado de diagnosticos.".to_string()
    })?;
    let export_id = unique_id("diagnostic");
    let file_name = format!("{export_id}.json");
    let final_path = confined_path(export_directory, &file_name)?;
    let temporary_path = confined_path(export_directory, &format!(".{export_id}.tmp"))?;
    let created_at = unix_millis();
    let health = runtime_health(connection)?;
    let command_counts = grouped_counts(
        connection,
        "SELECT state,count(*) FROM local_commands GROUP BY state ORDER BY state",
    )?;
    let print_counts = grouped_counts(
        connection,
        "SELECT status,count(*) FROM local_fiscal_print_jobs GROUP BY status ORDER BY status",
    )?;
    let error_codes = diagnostic_error_codes(connection)?;
    let backup_summary = backup_summary(connection)?;
    let mut correlations = BTreeSet::new();
    correlations.extend(request.correlation_ids.iter().cloned());
    let diagnostic = json!({
        "schemaVersion": 1,
        "exportId": export_id,
        "createdAt": created_at,
        "application": {
            "name": "TABA Negocio",
            "version": env!("CARGO_PKG_VERSION"),
            "build": option_env!("TABA_BUILD_SHA").unwrap_or("local-unidentified")
        },
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH
        },
        "operatorContext": {
            "networkStatus": request.network_status,
            "activeView": request.active_view,
            "correlationIds": correlations
        },
        "localPersistence": {
            "databaseHealth": health.database_health,
            "walEnabled": health.wal_enabled,
            "commandCounts": command_counts,
            "printCounts": print_counts,
            "errorCodes": error_codes,
            "backups": backup_summary
        }
    });
    let bytes = serde_json::to_vec_pretty(&diagnostic)
        .map_err(|_| "No se pudo serializar el diagnostico sanitizado.".to_string())?;
    let sha256 = sha256_bytes(&bytes);
    let size_bytes = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .map_err(|error| {
            log_io("reserve support export", &error);
            "No se pudo reservar el archivo de diagnostico.".to_string()
        })?;
    file.write_all(&bytes).map_err(|error| {
        log_io("write support export", &error);
        "No se pudo escribir el diagnostico sanitizado.".to_string()
    })?;
    file.sync_all().map_err(|error| {
        log_io("sync support export", &error);
        "No se pudo confirmar el diagnostico sanitizado.".to_string()
    })?;
    drop(file);
    fs::rename(&temporary_path, &final_path).map_err(|error| {
        log_io("commit support export", &error);
        "No se pudo confirmar el diagnostico sanitizado.".to_string()
    })?;
    connection
        .execute(
            "INSERT INTO local_support_exports(export_id,file_name,sha256,size_bytes,created_at)
             VALUES(?1,?2,?3,?4,?5)",
            params![export_id, file_name, sha256, size_bytes, created_at],
        )
        .map_err(db_error)?;
    Ok(SupportExportResult {
        export_id,
        created_at,
        size_bytes,
        sha256,
    })
}

pub fn open_private_directory(directory: &Path) -> Result<bool, String> {
    fs::create_dir_all(directory).map_err(|error| {
        log_io("open private directory", &error);
        "No se pudo preparar el directorio privado.".to_string()
    })?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(directory)
            .spawn()
            .map_err(|error| {
                log_io("launch explorer", &error);
                "Windows no pudo abrir el directorio privado.".to_string()
            })?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = directory;
        Err("El directorio privado solo se abre desde Windows.".into())
    }
}

fn validate_support_request(request: &SupportDiagnosticRequest) -> Result<(), String> {
    if !matches!(
        request.network_status.as_str(),
        "online" | "offline" | "degraded" | "unknown"
    ) || request.active_view.is_empty()
        || request.active_view.len() > 64
        || !request
            .active_view
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || request.correlation_ids.len() > 20
        || request.correlation_ids.iter().any(|value| !is_uuid(value))
    {
        return Err("Contexto de diagnostico invalido.".into());
    }
    Ok(())
}

fn diagnostic_error_codes(connection: &Connection) -> Result<Vec<Value>, String> {
    let sql = "SELECT error_code,count(*) FROM (
                 SELECT last_error_code AS error_code FROM local_commands WHERE last_error_code IS NOT NULL
                 UNION ALL
                 SELECT error_code FROM local_fiscal_print_jobs WHERE error_code IS NOT NULL
               ) errors GROUP BY error_code ORDER BY count(*) DESC,error_code LIMIT 20";
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(db_error)?;
    let mut result = Vec::new();
    for row in rows {
        let (code, count) = row.map_err(db_error)?;
        let safe_code = if code.len() <= 64
            && code
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        {
            code
        } else {
            "REDACTED_ERROR_CODE".into()
        };
        result.push(json!({ "code": safe_code, "count": count }));
    }
    Ok(result)
}

fn backup_summary(connection: &Connection) -> Result<Value, String> {
    let (ready, failed, last_created_at): (i64, i64, Option<String>) = connection
        .query_row(
            "SELECT
               count(*) FILTER (WHERE status='ready'),
               count(*) FILTER (WHERE status='failed'),
               max(created_at)
             FROM local_backups",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(db_error)?;
    Ok(json!({
        "readyCount": ready,
        "failedCount": failed,
        "lastCreatedAt": last_created_at
    }))
}

fn grouped_counts(connection: &Connection, sql: &str) -> Result<Value, String> {
    let mut statement = connection.prepare(sql).map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(db_error)?;
    let mut values = Map::new();
    for row in rows {
        let (key, count) = row.map_err(db_error)?;
        values.insert(key, Value::from(count));
    }
    Ok(Value::Object(values))
}

fn count_where(connection: &Connection, sql: &str) -> Result<i64, String> {
    connection
        .query_row(sql, [], |row| row.get(0))
        .map_err(db_error)
}

fn quick_check(connection: &Connection) -> Result<String, String> {
    let result: String = connection
        .query_row("PRAGMA quick_check(1)", [], |row| row.get(0))
        .map_err(db_error)?;
    Ok(if result.eq_ignore_ascii_case("ok") {
        "ok".into()
    } else {
        "corrupt".into()
    })
}

fn verify_backup_file(path: &Path, expected_hash: &str) -> Result<(), String> {
    if sha256_file(path)? != expected_hash {
        return Err("BACKUP_HASH_MISMATCH".into());
    }
    let backup =
        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|error| {
            log_database_error("open backup", &error);
            "BACKUP_OPEN_FAILED".to_string()
        })?;
    if quick_check(&backup)? != "ok" {
        return Err("BACKUP_INTEGRITY_FAILED".into());
    }
    Ok(())
}

fn mark_backup_failed(connection: &Connection, backup_id: &str, code: &str) {
    let _ = connection.execute(
        "UPDATE local_backups SET status='failed',error_code=?2 WHERE backup_id=?1",
        params![backup_id, code],
    );
}

fn confined_path(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name.len() > 180
        || file_name.contains(['/', '\\'])
        || file_name.contains("..")
    {
        return Err("Nombre de archivo privado invalido.".into());
    }
    Ok(directory.join(file_name))
}

fn file_size(path: &Path) -> Result<u64, String> {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|error| {
            log_io("read private file metadata", &error);
            "No se pudo verificar el archivo privado.".to_string()
        })
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| {
        log_io("open private file", &error);
        "No se pudo verificar el archivo privado.".to_string()
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 65_536];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            log_io("hash private file", &error);
            "No se pudo verificar el archivo privado.".to_string()
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn unique_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{nanos:x}-{:x}-{counter:x}", std::process::id())
}

fn unix_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn safe_identifier(value: &str, prefix: &str) -> bool {
    value.starts_with(prefix)
        && value.len() <= 100
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|index| bytes[*index] == b'-')
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| [8, 13, 18, 23].contains(&index) || byte.is_ascii_hexdigit())
}

fn db_error(error: rusqlite::Error) -> String {
    log_database_error("support database", &error);
    "No se pudo actualizar la persistencia local de soporte.".into()
}

fn log_database_error(context: &str, error: &rusqlite::Error) {
    log::warn!(
        "{} failed: {}",
        context,
        error
            .sqlite_error_code()
            .map(|code| format!("{code:?}"))
            .unwrap_or_else(|| "unknown".into())
    );
}

fn log_io(context: &str, error: &std::io::Error) {
    log::warn!("{} failed: {:?}", context, error.kind());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL;
                 CREATE TABLE local_commands (
                   command_id TEXT PRIMARY KEY,state TEXT NOT NULL,last_error_code TEXT
                 );
                 CREATE TABLE local_fiscal_print_jobs (
                   print_job_id TEXT PRIMARY KEY,status TEXT NOT NULL,error_code TEXT
                 );",
            )
            .unwrap();
        migrate(&connection).unwrap();
        connection
    }

    fn temporary_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(unique_id(label));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn backup_is_consistent_hashed_and_reverified() {
        let connection = test_connection();
        connection
            .execute(
                "INSERT INTO local_commands(command_id,state) VALUES('one','pending')",
                [],
            )
            .unwrap();
        let directory = temporary_directory("taba-backup-test");
        let created = create_local_backup(&connection, &directory).unwrap();
        assert!(created.integrity_verified);
        assert_eq!(created.sha256.len(), 64);
        assert!(created.size_bytes > 0);
        let verified = verify_local_backup(&connection, &directory, &created.backup_id).unwrap();
        assert_eq!(verified.sha256, created.sha256);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn support_export_contains_only_bounded_operational_context() {
        let connection = test_connection();
        connection
            .execute(
                "INSERT INTO local_fiscal_print_jobs(print_job_id,status,error_code)
                 VALUES('one','failed','LOCAL_SPOOL_FAILED')",
                [],
            )
            .unwrap();
        let directory = temporary_directory("taba-support-test");
        let request = SupportDiagnosticRequest {
            network_status: "degraded".into(),
            active_view: "operation-center".into(),
            correlation_ids: vec!["11111111-1111-4111-8111-111111111111".into()],
        };
        let exported = export_support_diagnostic(&connection, &directory, &request).unwrap();
        assert_eq!(exported.sha256.len(), 64);
        let file_name: String = connection
            .query_row(
                "SELECT file_name FROM local_support_exports WHERE export_id=?1",
                [&exported.export_id],
                |row| row.get(0),
            )
            .unwrap();
        let content = fs::read_to_string(directory.join(file_name)).unwrap();
        assert!(content.contains("LOCAL_SPOOL_FAILED"));
        assert!(!content.to_ascii_lowercase().contains("service_role"));
        assert!(!content.contains("printer_name"));
        assert!(!content.contains("payload"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn support_request_rejects_unbounded_or_identifying_free_text() {
        let request = SupportDiagnosticRequest {
            network_status: "online; token=secret".into(),
            active_view: "operation center".into(),
            correlation_ids: vec!["not-a-uuid".into()],
        };
        assert!(validate_support_request(&request).is_err());
    }
}

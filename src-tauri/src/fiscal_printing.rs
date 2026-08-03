use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::printing::{self, PrintRequest};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiscalPrintRequest {
    pub print_job_id: String,
    pub fiscal_document_id: String,
    pub artifact_id: String,
    pub printer_name: String,
    pub printer_name_hash: String,
    pub format: String,
    pub copies: u8,
    pub title: String,
    pub pdf_base64: String,
    pub thermal_content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiscalPrintOutcome {
    pub status: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalFiscalPrintJob {
    fiscal_document_id: String,
    artifact_id: String,
    status: String,
    spool_file: String,
}

pub fn migrate(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_fiscal_print_jobs (
           print_job_id TEXT PRIMARY KEY,
           fiscal_document_id TEXT NOT NULL,
           artifact_id TEXT NOT NULL,
           printer_name_hash TEXT NOT NULL,
           format TEXT NOT NULL CHECK(format IN ('a4','thermal')),
           copies INTEGER NOT NULL CHECK(copies BETWEEN 1 AND 5),
           status TEXT NOT NULL CHECK(status IN ('queued','sent_to_spooler','completed_when_verifiable','failed','unknown')),
           spool_file TEXT NOT NULL,
           error_code TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS local_fiscal_print_jobs_status_idx ON local_fiscal_print_jobs(status, updated_at);
         UPDATE local_fiscal_print_jobs
            SET status='unknown', error_code='RESTART_DURING_PRINT', updated_at=CURRENT_TIMESTAMP
          WHERE status='sent_to_spooler';",
    ).map_err(db_error)
}

pub fn enqueue(
    connection: &Connection,
    spool_directory: &Path,
    request: &FiscalPrintRequest,
) -> Result<LocalFiscalPrintJob, String> {
    validate_request(request)?;
    if let Some(existing) = get(connection, &request.print_job_id)? {
        if existing.fiscal_document_id == request.fiscal_document_id
            && existing.artifact_id == request.artifact_id
        {
            return Ok(existing);
        }
        return Err("El identificador de impresión ya pertenece a otro comprobante.".into());
    }
    let pdf = STANDARD
        .decode(&request.pdf_base64)
        .map_err(|_| "El PDF local no tiene codificación válida.".to_string())?;
    if pdf.len() > 16_777_216 || !pdf.starts_with(b"%PDF-") {
        return Err("El PDF fiscal excede el límite o no es válido.".into());
    }
    fs::create_dir_all(spool_directory)
        .map_err(|_| "No se pudo preparar la caché fiscal local.".to_string())?;
    let file_name = format!("{}.pdf", request.print_job_id);
    let spool_path = spool_directory.join(&file_name);
    if spool_path.exists() {
        if !spool_path.is_file() {
            return Err("La caché fiscal contiene una ruta inválida.".into());
        }
        let now = now_marker();
        connection.execute(
            "INSERT INTO local_fiscal_print_jobs(print_job_id,fiscal_document_id,artifact_id,printer_name_hash,format,copies,status,spool_file,error_code,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,'unknown',?7,'ORPHANED_LOCAL_SPOOL',?8,?8)",
            params![request.print_job_id, request.fiscal_document_id, request.artifact_id, request.printer_name_hash, request.format, request.copies, file_name, now],
        ).map_err(db_error)?;
        return get(connection, &request.print_job_id)?
            .ok_or_else(|| "No se pudo reconciliar la caché fiscal local.".into());
    }
    let temporary = spool_directory.join(format!(".{}.tmp", request.print_job_id));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "No se pudo reservar la caché fiscal local.".to_string())?;
    file.write_all(&pdf)
        .map_err(|_| "No se pudo escribir el PDF fiscal local.".to_string())?;
    file.sync_all()
        .map_err(|_| "No se pudo confirmar el PDF fiscal local.".to_string())?;
    drop(file);
    fs::rename(&temporary, &spool_path)
        .map_err(|_| "No se pudo confirmar la caché fiscal local.".to_string())?;
    let now = now_marker();
    connection.execute(
        "INSERT INTO local_fiscal_print_jobs(print_job_id,fiscal_document_id,artifact_id,printer_name_hash,format,copies,status,spool_file,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,'queued',?7,?8,?8)",
        params![request.print_job_id, request.fiscal_document_id, request.artifact_id, request.printer_name_hash, request.format, request.copies, file_name, now],
    ).map_err(db_error)?;
    get(connection, &request.print_job_id)?
        .ok_or_else(|| "No se pudo recuperar la cola local de impresión.".into())
}

pub fn dispatch(
    spool_directory: &Path,
    job: &LocalFiscalPrintJob,
    request: &FiscalPrintRequest,
) -> FiscalPrintOutcome {
    if job.status != "queued" {
        return FiscalPrintOutcome {
            status: job.status.clone(),
            error_code: Some("PRINT_JOB_ALREADY_DISPATCHED".into()),
        };
    }
    let spool_path = spool_directory.join(&job.spool_file);
    let outcome = match request.format.as_str() {
        "a4" => printing::print_pdf(
            &spool_path,
            &request.printer_name,
            &request.title,
            request.copies,
        )
        .map(|_| FiscalPrintOutcome {
            status: "unknown".into(),
            error_code: Some("SPOOLER_RESULT_NOT_VERIFIABLE".into()),
        }),
        "thermal" => {
            let print_request = PrintRequest {
                printer_name: request.printer_name.clone(),
                title: request.title.clone(),
                content: request.thermal_content.clone(),
                format: "raw_text".into(),
            };
            let result = (0..request.copies).try_for_each(|_| printing::print(&print_request));
            result.map(|_| FiscalPrintOutcome {
                status: "sent_to_spooler".into(),
                error_code: None,
            })
        }
        _ => Err("Formato de impresión inválido.".into()),
    };
    outcome.unwrap_or_else(|_| FiscalPrintOutcome {
        status: "failed".into(),
        error_code: Some("LOCAL_SPOOL_FAILED".into()),
    })
}

pub fn record_outcome(
    connection: &Connection,
    print_job_id: &str,
    outcome: &FiscalPrintOutcome,
) -> Result<(), String> {
    connection.execute(
        "UPDATE local_fiscal_print_jobs SET status=?2,error_code=?3,updated_at=?4 WHERE print_job_id=?1",
        params![print_job_id, outcome.status, outcome.error_code, now_marker()],
    ).map_err(db_error)?;
    Ok(())
}

pub fn open_spool_directory(directory: &Path) -> Result<bool, String> {
    fs::create_dir_all(directory)
        .map_err(|_| "No se pudo preparar la caché fiscal local.".to_string())?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(directory)
            .spawn()
            .map_err(|_| "Windows no pudo abrir la caché fiscal local.".to_string())?;
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        let _ = directory;
        Err("La caché fiscal local sólo se abre desde Windows.".into())
    }
}

fn get(connection: &Connection, print_job_id: &str) -> Result<Option<LocalFiscalPrintJob>, String> {
    connection.query_row(
        "SELECT print_job_id,fiscal_document_id,artifact_id,status,spool_file FROM local_fiscal_print_jobs WHERE print_job_id=?1",
        [print_job_id],
        |row| Ok(LocalFiscalPrintJob {
            fiscal_document_id: row.get(1)?,
            artifact_id: row.get(2)?,
            status: row.get(3)?,
            spool_file: row.get(4)?,
        }),
    ).optional().map_err(db_error)
}

fn validate_request(request: &FiscalPrintRequest) -> Result<(), String> {
    if !is_uuid(&request.print_job_id)
        || !is_uuid(&request.fiscal_document_id)
        || !is_uuid(&request.artifact_id)
    {
        return Err("Identificador de impresión fiscal inválido.".into());
    }
    if request.printer_name.trim().is_empty()
        || request.printer_name.len() > 260
        || !is_sha256(&request.printer_name_hash)
    {
        return Err("Impresora fiscal inválida.".into());
    }
    if !matches!(request.format.as_str(), "a4" | "thermal")
        || !(1..=5).contains(&request.copies)
        || request.title.trim().is_empty()
        || request.title.len() > 120
    {
        return Err("Opciones de impresión fiscal inválidas.".into());
    }
    if request.pdf_base64.is_empty()
        || request.pdf_base64.len() > 23_000_000
        || (request.format == "thermal"
            && (request.thermal_content.is_empty() || request.thermal_content.len() > 65_536))
    {
        return Err("Contenido de impresión fiscal inválido.".into());
    }
    Ok(())
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

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn now_marker() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn db_error(error: rusqlite::Error) -> String {
    log::warn!(
        "local fiscal print queue failed: {}",
        error
            .sqlite_error_code()
            .map(|code| format!("{code:?}"))
            .unwrap_or_else(|| "unknown".into())
    );
    "No se pudo actualizar la cola local de impresión fiscal.".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fiscal_print_request_rejects_unbounded_or_sensitive_identifiers() {
        let request = FiscalPrintRequest {
            print_job_id: "not-a-uuid".into(),
            fiscal_document_id: "not-a-uuid".into(),
            artifact_id: "not-a-uuid".into(),
            printer_name: "Office printer".into(),
            printer_name_hash: "a".repeat(64),
            format: "a4".into(),
            copies: 1,
            title: "Fiscal".into(),
            pdf_base64: "JVBERi0=".into(),
            thermal_content: String::new(),
        };
        assert!(validate_request(&request).is_err());
    }

    #[test]
    fn restart_marks_only_spooler_submission_as_unknown() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        connection.execute("INSERT INTO local_fiscal_print_jobs(print_job_id,fiscal_document_id,artifact_id,printer_name_hash,format,copies,status,spool_file,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',?1,'a4',1,'sent_to_spooler','x.pdf','0','0')", ["a".repeat(64)]).unwrap();
        migrate(&connection).unwrap();
        let job = get(&connection, "00000000-0000-4000-8000-000000000001")
            .unwrap()
            .unwrap();
        assert_eq!(job.status, "unknown");
    }
}

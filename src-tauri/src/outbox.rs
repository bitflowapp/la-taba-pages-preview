use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalCommand {
    pub command_id: String,
    pub idempotency_key: String,
    pub business_id: String,
    pub order_id: Option<String>,
    pub command_type: String,
    pub expected_revision: Option<i64>,
    pub payload: Value,
    pub created_at: String,
    pub attempt_count: i64,
    pub next_attempt_at: String,
    pub last_error_code: Option<String>,
    pub last_error_message: Option<String>,
    pub state: String,
    pub sending_started_at: Option<String>,
    pub confirmed_at: Option<String>,
    pub server_revision: Option<i64>,
}

pub fn migrate(connection: &Connection) -> Result<(), String> {
    connection.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;
         CREATE TABLE IF NOT EXISTS local_commands (
           command_id TEXT PRIMARY KEY,
           idempotency_key TEXT NOT NULL UNIQUE,
           business_id TEXT NOT NULL,
           order_id TEXT,
           command_type TEXT NOT NULL,
           expected_revision INTEGER,
           payload_json TEXT NOT NULL,
           created_at TEXT NOT NULL,
           attempt_count INTEGER NOT NULL DEFAULT 0,
           next_attempt_at TEXT NOT NULL,
           last_error_code TEXT,
           last_error_message TEXT,
           state TEXT NOT NULL CHECK(state IN ('pending','sending','confirmed','conflicted','failed','cancelled')),
           sending_started_at TEXT,
           confirmed_at TEXT,
           server_revision INTEGER
         );
         CREATE INDEX IF NOT EXISTS local_commands_due_idx ON local_commands(state,next_attempt_at);
         CREATE TABLE IF NOT EXISTS desktop_settings (
           key TEXT PRIMARY KEY,
           value_json TEXT NOT NULL,
           updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
         );"
    ).map_err(db_error)
}

pub fn put(connection: &Connection, command: &LocalCommand) -> Result<LocalCommand, String> {
    validate(command)?;
    let payload = serde_json::to_string(&command.payload)
        .map_err(|_| "Payload local inválido.".to_string())?;
    connection.execute(
        "INSERT INTO local_commands(command_id,idempotency_key,business_id,order_id,command_type,expected_revision,payload_json,created_at,attempt_count,next_attempt_at,last_error_code,last_error_message,state,sending_started_at,confirmed_at,server_revision)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
         ON CONFLICT(command_id) DO UPDATE SET
           attempt_count=excluded.attempt_count,next_attempt_at=excluded.next_attempt_at,
           last_error_code=excluded.last_error_code,last_error_message=excluded.last_error_message,
           state=excluded.state,sending_started_at=excluded.sending_started_at,
           confirmed_at=excluded.confirmed_at,server_revision=excluded.server_revision",
        params![command.command_id,command.idempotency_key,command.business_id,command.order_id,command.command_type,command.expected_revision,payload,command.created_at,command.attempt_count,command.next_attempt_at,command.last_error_code,command.last_error_message,command.state,command.sending_started_at,command.confirmed_at,command.server_revision],
    ).map_err(db_error)?;
    get(connection, &command.command_id)?
        .ok_or_else(|| "No se pudo recuperar el comando guardado.".into())
}

pub fn get(connection: &Connection, command_id: &str) -> Result<Option<LocalCommand>, String> {
    connection.query_row(
        "SELECT command_id,idempotency_key,business_id,order_id,command_type,expected_revision,payload_json,created_at,attempt_count,next_attempt_at,last_error_code,last_error_message,state,sending_started_at,confirmed_at,server_revision FROM local_commands WHERE command_id=?1",
        [command_id], row_to_command,
    ).optional().map_err(db_error)
}

pub fn find_by_idempotency_key(
    connection: &Connection,
    key: &str,
) -> Result<Option<LocalCommand>, String> {
    connection.query_row(
        "SELECT command_id,idempotency_key,business_id,order_id,command_type,expected_revision,payload_json,created_at,attempt_count,next_attempt_at,last_error_code,last_error_message,state,sending_started_at,confirmed_at,server_revision FROM local_commands WHERE idempotency_key=?1",
        [key], row_to_command,
    ).optional().map_err(db_error)
}

pub fn list(connection: &Connection) -> Result<Vec<LocalCommand>, String> {
    let mut statement = connection.prepare(
        "SELECT command_id,idempotency_key,business_id,order_id,command_type,expected_revision,payload_json,created_at,attempt_count,next_attempt_at,last_error_code,last_error_message,state,sending_started_at,confirmed_at,server_revision FROM local_commands ORDER BY created_at,command_id"
    ).map_err(db_error)?;
    let rows = statement.query_map([], row_to_command).map_err(db_error)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(db_error)
}

fn row_to_command(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalCommand> {
    let payload_json: String = row.get(6)?;
    Ok(LocalCommand {
        command_id: row.get(0)?,
        idempotency_key: row.get(1)?,
        business_id: row.get(2)?,
        order_id: row.get(3)?,
        command_type: row.get(4)?,
        expected_revision: row.get(5)?,
        payload: serde_json::from_str(&payload_json).unwrap_or(Value::Object(Default::default())),
        created_at: row.get(7)?,
        attempt_count: row.get(8)?,
        next_attempt_at: row.get(9)?,
        last_error_code: row.get(10)?,
        last_error_message: row.get(11)?,
        state: row.get(12)?,
        sending_started_at: row.get(13)?,
        confirmed_at: row.get(14)?,
        server_revision: row.get(15)?,
    })
}

fn validate(command: &LocalCommand) -> Result<(), String> {
    if command.command_id.trim().is_empty()
        || command.command_id.len() > 128
        || command.idempotency_key.trim().is_empty()
        || command.idempotency_key.len() > 128
    {
        return Err("Identificador de comando local inválido.".into());
    }
    if !matches!(
        command.state.as_str(),
        "pending" | "sending" | "confirmed" | "conflicted" | "failed" | "cancelled"
    ) {
        return Err("Estado de comando local inválido.".into());
    }
    if command.attempt_count < 0 || command.attempt_count > 100 {
        return Err("Cantidad de intentos inválida.".into());
    }
    let object = command
        .payload
        .as_object()
        .ok_or_else(|| "El payload local debe ser un objeto.".to_string())?;
    let blocked = [
        "password",
        "secret",
        "token",
        "jwt",
        "servicerole",
        "privatekey",
        "deliverycode",
        "certificate",
        "customerphone",
    ];
    if object.keys().any(|key| {
        blocked
            .iter()
            .any(|word| key.to_lowercase().replace(['_', '-'], "").contains(word))
    }) {
        return Err("El payload local contiene un campo sensible.".into());
    }
    if serde_json::to_vec(&command.payload)
        .map_err(|_| "Payload local inválido.".to_string())?
        .len()
        > 32_768
    {
        return Err("El payload local excede el límite.".into());
    }
    Ok(())
}

fn db_error(error: rusqlite::Error) -> String {
    log::warn!(
        "sqlite operation failed: {}",
        error
            .sqlite_error_code()
            .map(|code| format!("{code:?}"))
            .unwrap_or_else(|| "unknown".into())
    );
    "No se pudo actualizar la persistencia local.".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command() -> LocalCommand {
        LocalCommand {
            command_id: "c1".into(),
            idempotency_key: "idem-0001".into(),
            business_id: "b1".into(),
            order_id: Some("o1".into()),
            command_type: "transition_order".into(),
            expected_revision: Some(1),
            payload: serde_json::json!({"newStatus":"preparing"}),
            created_at: "2026-08-02T10:00:00Z".into(),
            attempt_count: 0,
            next_attempt_at: "2026-08-02T10:00:00Z".into(),
            last_error_code: None,
            last_error_message: None,
            state: "pending".into(),
            sending_started_at: None,
            confirmed_at: None,
            server_revision: None,
        }
    }

    #[test]
    fn sqlite_outbox_survives_reopen_and_updates_state() {
        let connection = Connection::open_in_memory().unwrap();
        migrate(&connection).unwrap();
        put(&connection, &command()).unwrap();
        let mut sending = command();
        sending.state = "sending".into();
        sending.attempt_count = 1;
        put(&connection, &sending).unwrap();
        assert_eq!(list(&connection).unwrap()[0].state, "sending");
        assert_eq!(
            find_by_idempotency_key(&connection, "idem-0001")
                .unwrap()
                .unwrap()
                .attempt_count,
            1
        );
    }

    #[test]
    fn sqlite_outbox_rejects_sensitive_payload() {
        let mut value = command();
        value.payload = serde_json::json!({"private_key":"blocked"});
        assert!(validate(&value).is_err());
    }
}
